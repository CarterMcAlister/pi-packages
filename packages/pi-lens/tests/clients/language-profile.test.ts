import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDispatchContext } from "../../clients/dispatch/dispatcher.js";
import { FactStore } from "../../clients/dispatch/fact-store.js";
import { resolveLanguageRootForFile } from "../../clients/language-profile.js";
import { normalizeMapKey } from "../../clients/path-utils.js";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("language-profile roots", () => {
	it("resolves python file root to nearest pyproject in monorepo", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lens-lang-root-"));
		dirs.push(tmp);

		const workspace = path.join(tmp, "repo");
		const pkg = path.join(workspace, "apps", "talos");
		const file = path.join(pkg, "core", "orchestrator.py");

		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(path.join(pkg, "pyproject.toml"), "[tool.ruff]\n");
		fs.writeFileSync(file, "print('ok')\n");

		const root = resolveLanguageRootForFile(file, workspace);
		expect(root).toBe(pkg);
	});

	it("falls back to workspace root for files outside workspace", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lens-lang-root-"));
		dirs.push(tmp);

		const workspace = path.join(tmp, "repo");
		const external = path.join(tmp, "external", "main.go");

		fs.mkdirSync(path.dirname(external), { recursive: true });
		fs.writeFileSync(external, "package main\n");

		const root = resolveLanguageRootForFile(external, workspace);
		expect(root).toBe(workspace);
	});

	it("keeps dispatch file paths absolute when a language root is nested under the workspace", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lens-lang-root-"));
		dirs.push(tmp);

		const workspace = path.join(tmp, "repo");
		const projectRoot = path.join(workspace, "cases", "kotlin");
		const file = path.join(projectRoot, "src", "main", "kotlin", "main.kt");

		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(path.join(projectRoot, "build.gradle.kts"), "plugins {}\n");
		fs.writeFileSync(file, "fun main() = greet(123)\n");

		const ctx = createDispatchContext(
			path.relative(workspace, file),
			workspace,
			{ getFlag: () => false },
			new FactStore(),
		);

		expect(normalizeMapKey(ctx.cwd)).toBe(normalizeMapKey(projectRoot));
		expect(normalizeMapKey(ctx.filePath)).toBe(normalizeMapKey(file));
		expect(ctx.filePath.includes("cases/kotlin/cases/kotlin")).toBe(false);
	});

	it("resolves workspace-relative files correctly even when dispatch cwd is already nested", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lens-lang-root-"));
		dirs.push(tmp);

		const workspace = path.join(tmp, "repo");
		const projectRoot = path.join(workspace, "ts-service");
		const file = path.join(projectRoot, "src", "index.ts");

		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(path.join(projectRoot, "package.json"), "{}\n");
		fs.writeFileSync(file, "export const ok = true;\n");

		const ctx = createDispatchContext(
			"ts-service/src/index.ts",
			projectRoot,
			{ getFlag: () => false },
			new FactStore(),
		);

		expect(normalizeMapKey(ctx.cwd)).toBe(normalizeMapKey(projectRoot));
		expect(normalizeMapKey(ctx.filePath)).toBe(normalizeMapKey(file));
		expect(ctx.filePath.includes("ts-service/ts-service")).toBe(false);
	});
});
