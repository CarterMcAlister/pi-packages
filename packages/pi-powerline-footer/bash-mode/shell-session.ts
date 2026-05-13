// biome-ignore-all lint/suspicious/noControlCharactersInRegex: Terminal ANSI/control-sequence stripping intentionally matches control characters.
import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn,
} from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import * as pty from "node-pty";
import type { BashTranscriptStore } from "./transcript.ts";
import type { ShellSessionState } from "./types.ts";

const READY_SENTINEL = "__PI_READY__";
const COMMAND_START_SENTINEL = "__PI_CMD_START__";
const COMMAND_DONE_SENTINEL = "__PI_CMD_DONE__";

function stripAnsi(value: string): string {
  return value
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\u0007]*(?:\u0007|\x1b\\)/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function keepSgrAnsi(value: string): string {
  return value
    .replace(/\x1B\[(?![0-9;]*m)[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\u0007]*(?:\u0007|\x1b\\)/g, "")
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g,
      "",
    );
}

function isPtyCommandEcho(line: string): boolean {
  return (
    (line.includes("powerline-bash-mode-") &&
      (line.includes("source ") || line.includes("rm -f "))) ||
    line.includes("set __pi_status") ||
    line.includes(COMMAND_DONE_SENTINEL)
  );
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function parseCommandStartLine(line: string): {
  id: string | undefined;
  cwd: string | undefined;
} {
  const payload = line.slice(COMMAND_START_SENTINEL.length + 1);
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex < 0) return { id: payload || undefined, cwd: undefined };
  return {
    id: payload.slice(0, separatorIndex) || undefined,
    cwd: payload.slice(separatorIndex + 1) || undefined,
  };
}

function parseCommandDoneLine(line: string): {
  id: string | undefined;
  exitCode: number;
  cwd: string | undefined;
} {
  const payload = line.slice(COMMAND_DONE_SENTINEL.length + 1);
  const firstSeparatorIndex = payload.indexOf(":");
  if (firstSeparatorIndex < 0) {
    return { id: payload || undefined, exitCode: 1, cwd: undefined };
  }

  const id = payload.slice(0, firstSeparatorIndex) || undefined;
  const rest = payload.slice(firstSeparatorIndex + 1);
  const secondSeparatorIndex = rest.indexOf(":");
  const exitCodeText =
    secondSeparatorIndex < 0 ? rest : rest.slice(0, secondSeparatorIndex);
  const exitCode = Number.parseInt(exitCodeText || "1", 10);

  return {
    id,
    exitCode: Number.isFinite(exitCode) ? exitCode : 1,
    cwd:
      secondSeparatorIndex < 0
        ? undefined
        : rest.slice(secondSeparatorIndex + 1) || undefined,
  };
}

function getCloseExitCode(
  code: number | null | undefined,
  signal: NodeJS.Signals | string | number | null | undefined,
): number {
  if (typeof code === "number") {
    return code;
  }

  if (signal === "SIGINT" || signal === 2) {
    return 130;
  }

  if (signal === "SIGTERM" || signal === 15) {
    return 143;
  }

  if (signal === "SIGKILL" || signal === 9) {
    return 137;
  }

  return 1;
}

function getFishInitScript(): string {
  return `
stty -echo
function fish_prompt; end
function fish_right_prompt; end
echo "${READY_SENTINEL}:$PWD"
`;
}

function getFishEvalScript(id: string, filePath: string): string {
  return `
echo "${COMMAND_START_SENTINEL}:${id}:$PWD"
source ${quoteShellArg(filePath)}
set __pi_status $status
rm -f ${quoteShellArg(filePath)}
echo "${COMMAND_DONE_SENTINEL}:${id}:$__pi_status:$PWD"
set -e __pi_status
`;
}

function getShellInitScript(shellName: string): string {
  if (shellName.includes("fish")) {
    return getFishInitScript();
  }

  if (shellName.includes("bash")) {
    return `
__pi_eval() {
  local __pi_id="$1"
  local __pi_file="$2"
  printf '%s:%s:%s\n' '${COMMAND_START_SENTINEL}' "$__pi_id" "$PWD"
  source "$__pi_file"
  local __pi_status=$?
  rm -f "$__pi_file"
  printf '%s:%s:%s:%s\n' '${COMMAND_DONE_SENTINEL}' "$__pi_id" "$__pi_status" "$PWD"
}
printf '%s:%s\n' '${READY_SENTINEL}' "$PWD"
`;
  }

  return `
function __pi_eval() {
  local __pi_id="$1"
  local __pi_file="$2"
  print -r -- "${COMMAND_START_SENTINEL}:$__pi_id:$PWD"
  builtin source "$__pi_file"
  local __pi_status=$?
  rm -f "$__pi_file"
  print -r -- "${COMMAND_DONE_SENTINEL}:$__pi_id:$__pi_status:$PWD"
}
print -r -- "${READY_SENTINEL}:$PWD"
`;
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (platform() !== "darwin" && platform() !== "linux") return;

  try {
    const require = createRequire(import.meta.url);
    const nodePtyEntry = require.resolve("node-pty");
    const packageDir = dirname(dirname(nodePtyEntry));
    const helperPath = join(
      packageDir,
      "prebuilds",
      `${platform()}-${arch()}`,
      "spawn-helper",
    );
    chmodSync(helperPath, 0o755);
  } catch {
    return;
  }
}

export class ManagedShellSession {
  private readonly shellPath: string;
  private readonly transcript: BashTranscriptStore;
  private readonly onStateChange: () => void;
  private readonly onCommandSuccess: (command: string, cwd: string) => void;
  private readonly onCwdChange: ((cwd: string) => void) | undefined;
  private process: ChildProcessWithoutNullStreams | null = null;
  private ptyProcess: pty.IPty | null = null;
  private readonly tempDir = mkdtempSync(
    join(tmpdir(), "powerline-bash-mode-"),
  );
  private buffer = "";
  private outputBuffer = "";
  private commandCounter = 0;
  private currentCommandId: string | null = null;
  private commandOutputActive = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private interruptFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly usePty: boolean;
  readonly state: ShellSessionState;

  constructor(
    shellPath: string,
    cwd: string,
    transcript: BashTranscriptStore,
    onStateChange: () => void,
    onCommandSuccess: (command: string, cwd: string) => void,
    onCwdChange?: (cwd: string) => void,
  ) {
    this.shellPath = shellPath;
    this.transcript = transcript;
    this.onStateChange = onStateChange;
    this.onCommandSuccess = onCommandSuccess;
    this.onCwdChange = onCwdChange;
    const shellName = basename(shellPath).toLowerCase();
    this.usePty = shellName.includes("fish");
    this.state = {
      ready: false,
      running: false,
      shellPath,
      shellName,
      cwd,
      lastExitCode: null,
    };
  }

  async ensureReady(): Promise<void> {
    if (this.state.ready) return;
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    if (this.usePty) {
      this.spawnPtyShell();
    } else {
      this.spawnPipeShell();
    }

    this.sendRaw(`${getShellInitScript(this.state.shellName)}\n`);
    return this.readyPromise;
  }

  async runCommand(command: string): Promise<void> {
    await this.ensureReady();
    if (!this.process && !this.ptyProcess) {
      throw new Error("Shell process not available");
    }
    if (this.state.running) {
      throw new Error("Shell command already running");
    }

    const id = `cmd-${++this.commandCounter}`;
    const extension = this.state.shellName.includes("fish") ? "fish" : "sh";
    const filePath = join(this.tempDir, `${id}.${extension}`);
    writeFileSync(
      filePath,
      command.endsWith("\n") ? command : `${command}\n`,
      "utf8",
    );

    this.currentCommandId = id;
    this.commandOutputActive = false;
    this.state.running = true;
    this.transcript.startCommand(id, command, this.state.cwd);
    this.onStateChange();
    if (this.usePty && this.state.shellName.includes("fish")) {
      this.sendRaw(getFishEvalScript(id, filePath));
      return;
    }

    this.sendRaw(`__pi_eval ${quoteShellArg(id)} ${quoteShellArg(filePath)}\n`);
  }

  interrupt(): void {
    if (!this.state.running) return;
    if (this.ptyProcess) {
      const interruptedCommandId = this.currentCommandId;
      this.ptyProcess.write("\x03");
      this.interruptPtyChildren();
      this.interruptFallbackTimer = setTimeout(() => {
        if (
          interruptedCommandId &&
          this.currentCommandId === interruptedCommandId &&
          this.state.running
        ) {
          this.finishCurrentCommand(interruptedCommandId, 130);
        }
      }, 250);
      return;
    }

    if (!this.process) return;
    const pid = this.process.pid;
    try {
      if (pid === undefined) throw new Error("Shell process pid unavailable");
      process.kill(-pid, "SIGINT");
    } catch {
      this.process.kill("SIGINT");
    }
  }

  dispose(): void {
    this.disposed = true;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    if (this.interruptFallbackTimer) {
      clearTimeout(this.interruptFallbackTimer);
      this.interruptFallbackTimer = null;
    }
    if (this.ptyProcess) {
      this.ptyProcess.kill("SIGKILL");
      this.ptyProcess = null;
    }
    if (!this.process) return;
    const pid = this.process.pid;
    try {
      if (pid === undefined) throw new Error("Shell process pid unavailable");
      process.kill(-pid, "SIGKILL");
    } catch {
      this.process.kill("SIGKILL");
    }
    this.process = null;
  }

  private spawnPtyShell(): void {
    ensureNodePtySpawnHelperExecutable();
    try {
      this.ptyProcess = pty.spawn(this.shellPath, [], {
        cwd: this.state.cwd,
        env: {
          ...process.env,
          DISABLE_AUTO_UPDATE: "true",
          DISABLE_UPDATE_PROMPT: "true",
          fish_greeting: "",
          TERM: "dumb",
          COLORTERM: process.env.COLORTERM || "truecolor",
          CLICOLOR_FORCE: process.env.CLICOLOR_FORCE || "1",
          FORCE_COLOR: process.env.FORCE_COLOR || "1",
        },
        cols: 120,
        rows: 30,
        name: "dumb",
      });
    } catch (error) {
      this.readyReject?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      this.resetProcessState();
      return;
    }

    this.ptyProcess.onData((chunk) => this.handleChunk(String(chunk)));
    this.ptyProcess.onExit(({ exitCode, signal }) => {
      const code = getCloseExitCode(exitCode, signal);
      this.handleShellClose(code);
    });
  }

  private spawnPipeShell(): void {
    this.process = spawn(this.shellPath, [], {
      cwd: this.state.cwd,
      env: {
        ...process.env,
        DISABLE_AUTO_UPDATE: "true",
        DISABLE_UPDATE_PROMPT: "true",
      },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => this.handleChunk(String(chunk)));
    this.process.stderr.on("data", (chunk) => this.handleChunk(String(chunk)));
    this.process.on("error", (error) => {
      if (!this.state.ready) {
        this.readyReject?.(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
    this.process.on("close", (code, signal) => {
      this.handleShellClose(getCloseExitCode(code, signal));
    });
  }

  private handleShellClose(exitCode: number): void {
    if (!this.disposed && !this.state.ready) {
      this.readyReject?.(new Error(`Shell failed to start (exit ${exitCode})`));
    }

    if (this.currentCommandId) {
      this.transcript.finishCommand(this.currentCommandId, exitCode);
      this.state.lastExitCode = exitCode;
      this.currentCommandId = null;
      this.commandOutputActive = false;
    }

    this.resetProcessState();
    this.onStateChange();
  }

  private resetProcessState(): void {
    this.process = null;
    this.ptyProcess = null;
    this.buffer = "";
    this.outputBuffer = "";
    this.commandOutputActive = false;
    if (this.interruptFallbackTimer) {
      clearTimeout(this.interruptFallbackTimer);
      this.interruptFallbackTimer = null;
    }
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.state.ready = false;
    this.state.running = false;
  }

  private sendRaw(text: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(text.replace(/\n/g, "\r"));
      return;
    }
    if (!this.process) return;
    this.process.stdin.write(text);
  }

  private interruptPtyChildren(): void {
    if (!this.ptyProcess) return;
    for (const pid of this.collectChildPids(this.ptyProcess.pid)) {
      try {
        process.kill(pid, "SIGINT");
      } catch {}
    }
  }

  private collectChildPids(parentPid: number): number[] {
    let childPids: number[] = [];
    try {
      childPids = execFileSync("pgrep", ["-P", String(parentPid)], {
        encoding: "utf8",
      })
        .split(/\s+/)
        .map((pid) => Number.parseInt(pid, 10))
        .filter((pid) => Number.isFinite(pid));
    } catch {
      return [];
    }

    return childPids.flatMap((pid) => [pid, ...this.collectChildPids(pid)]);
  }

  private updateCwd(cwd: string | undefined): void {
    if (!cwd || cwd === this.state.cwd) return;
    this.state.cwd = cwd;
    this.onCwdChange?.(cwd);
  }

  private handleChunk(chunk: string): void {
    const sanitized = stripAnsi(chunk).replace(/\r/g, "");
    const styled = keepSgrAnsi(chunk).replace(/\r/g, "");
    if (!sanitized && !styled) return;

    this.buffer += sanitized;
    this.outputBuffer += styled;
    const parts = this.buffer.split("\n");
    const outputParts = this.outputBuffer.split("\n");
    this.buffer = parts.pop() ?? "";
    this.outputBuffer = outputParts.pop() ?? "";

    for (let index = 0; index < parts.length; index++) {
      const line = (parts[index] ?? "").trimEnd();
      const outputLine = (outputParts[index] ?? "").trimEnd();
      if (!this.state.ready) {
        if (line.startsWith(`${READY_SENTINEL}:`)) {
          this.state.ready = true;
          this.updateCwd(line.slice(READY_SENTINEL.length + 1));
          this.readyResolve?.();
          this.readyResolve = null;
          this.readyReject = null;
          this.onStateChange();
        }
        continue;
      }

      if (line.startsWith(`${COMMAND_START_SENTINEL}:`)) {
        const { id, cwd } = parseCommandStartLine(line);
        this.updateCwd(cwd);
        this.currentCommandId = id ?? this.currentCommandId;
        this.commandOutputActive = true;
        this.onStateChange();
        continue;
      }

      if (line === "^C" && this.currentCommandId && this.commandOutputActive) {
        this.finishCurrentCommand(this.currentCommandId, 130);
        continue;
      }

      if (line.startsWith(`${COMMAND_DONE_SENTINEL}:`)) {
        const { id, exitCode, cwd } = parseCommandDoneLine(line);
        this.finishCurrentCommand(id ?? this.currentCommandId, exitCode, cwd);
        continue;
      }

      if (!this.currentCommandId || !this.commandOutputActive) continue;
      if (line.trim() === "") continue;
      if (line.startsWith("__pi_eval ")) continue;
      if (isPtyCommandEcho(line)) continue;
      this.transcript.appendOutput(this.currentCommandId, outputLine || line);
      this.onStateChange();
    }
  }

  private finishCurrentCommand(
    id: string | null,
    exitCode: number,
    cwd?: string,
  ): void {
    if (this.interruptFallbackTimer) {
      clearTimeout(this.interruptFallbackTimer);
      this.interruptFallbackTimer = null;
    }
    this.state.running = false;
    this.state.lastExitCode = exitCode;
    this.updateCwd(cwd);
    if (id) {
      this.transcript.finishCommand(id, exitCode);
      const snapshot = this.transcript.getSnapshot();
      const command = snapshot.commands.find((entry) => entry.id === id);
      if (command && exitCode === 0) {
        this.onCommandSuccess(command.command, this.state.cwd);
      }
    }
    this.currentCommandId = null;
    this.commandOutputActive = false;
    this.onStateChange();
  }
}
