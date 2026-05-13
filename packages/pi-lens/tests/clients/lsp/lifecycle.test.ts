/**
 * LSP Lifecycle Tests
 *
 * Tests basic LSP server spawn, initialization timeout, and exit detection.
 * These are smoke tests — full protocol testing requires a real language server.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { launchLSP, stopLSP } from "../../../clients/lsp/launch.js";

describe("LSP Launch", () => {
	it("throws when binary is not found", async () => {
		await expect(
			launchLSP("definitely-not-a-real-binary-12345", ["--stdio"]),
		).rejects.toThrow();
	});

	it("spawns a real Node.js process and returns LSPProcess handle", async () => {
		// Write a temp script that keeps running (avoids shell escaping issues)
		const scriptPath = path.join(os.tmpdir(), `pi-lens-test-${Date.now()}.js`);
		fs.writeFileSync(scriptPath, "setInterval(() => {}, 60000);");

		const proc = await launchLSP(process.execPath, [scriptPath]);

		expect(proc.pid).toBeGreaterThan(0);
		expect(proc.process).toBeDefined();
		expect(proc.stdin).toBeDefined();
		expect(proc.stdout).toBeDefined();
		expect(proc.stderr).toBeDefined();

		// Clean up
		await stopLSP(proc);
		fs.unlinkSync(scriptPath);
	});

	it("detects immediate exit of a bad binary", async () => {
		const scriptPath = path.join(os.tmpdir(), `pi-lens-test-${Date.now()}.js`);
		fs.writeFileSync(scriptPath, "process.exit(1);");

		await expect(
			launchLSP(process.execPath, [scriptPath], {
				startupFailureWindowMs: 500,
			}),
		).rejects.toThrow(/exited immediately/);

		fs.unlinkSync(scriptPath);
	});

	it("stopLSP kills the process", async () => {
		const scriptPath = path.join(os.tmpdir(), `pi-lens-test-${Date.now()}.js`);
		fs.writeFileSync(scriptPath, "setInterval(() => {}, 60000);");

		const proc = await launchLSP(process.execPath, [scriptPath]);

		expect(proc.process.killed).toBe(false);
		await stopLSP(proc);
		expect(
			proc.process.killed ||
				proc.process.exitCode !== null ||
				proc.process.signalCode !== null,
		).toBe(true);

		fs.unlinkSync(scriptPath);
	});

	it("stopLSP returns when the process already exited", async () => {
		const scriptPath = path.join(os.tmpdir(), `pi-lens-test-${Date.now()}.js`);
		fs.writeFileSync(scriptPath, "setTimeout(() => process.exit(0), 250);");

		const proc = await launchLSP(process.execPath, [scriptPath], {
			startupFailureWindowMs: 10,
		});
		await new Promise<void>((resolve) =>
			proc.process.once("exit", () => resolve()),
		);

		await expect(stopLSP(proc)).resolves.toBeUndefined();

		fs.unlinkSync(scriptPath);
	});
});
