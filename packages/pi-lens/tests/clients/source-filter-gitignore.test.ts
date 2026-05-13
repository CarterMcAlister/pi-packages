import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readGitignoreDirs } from "../../clients/file-utils.js";
import { collectSourceFiles } from "../../clients/source-filter.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lens-gitignore-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("readGitignoreDirs", () => {
	it("returns empty array when no .gitignore exists", () => {
		expect(readGitignoreDirs(tmpDir)).toEqual([]);
	});

	it("extracts simple directory names with trailing slash", () => {
		fs.writeFileSync(
			path.join(tmpDir, ".gitignore"),
			"third_party/\nvendor/\nbuild/\n",
		);
		const dirs = readGitignoreDirs(tmpDir);
		expect(dirs).toContain("third_party");
		expect(dirs).toContain("vendor");
		expect(dirs).toContain("build");
	});

	it("extracts bare names without trailing slash", () => {
		fs.writeFileSync(path.join(tmpDir, ".gitignore"), "dist\n.venv\n");
		const dirs = readGitignoreDirs(tmpDir);
		expect(dirs).toContain("dist");
		expect(dirs).toContain(".venv");
	});

	it("skips comments and blank lines", () => {
		fs.writeFileSync(
			path.join(tmpDir, ".gitignore"),
			"# ignore vendor\nvendor/\n\n# also this\n",
		);
		const dirs = readGitignoreDirs(tmpDir);
		expect(dirs).toEqual(["vendor"]);
	});

	it("skips negation patterns", () => {
		fs.writeFileSync(path.join(tmpDir, ".gitignore"), "!keep/\nvendor/\n");
		const dirs = readGitignoreDirs(tmpDir);
		expect(dirs).toEqual(["vendor"]);
	});

	it("skips wildcard patterns", () => {
		fs.writeFileSync(
			path.join(tmpDir, ".gitignore"),
			"*.log\n**/*.tmp\nvendor/\n",
		);
		const dirs = readGitignoreDirs(tmpDir);
		expect(dirs).toEqual(["vendor"]);
	});

	it("skips entries with internal path separators", () => {
		fs.writeFileSync(
			path.join(tmpDir, ".gitignore"),
			"third_party/sherpa-onnx\nvendor/\n",
		);
		const dirs = readGitignoreDirs(tmpDir);
		// third_party/sherpa-onnx has an internal slash — skipped
		expect(dirs).not.toContain("third_party/sherpa-onnx");
		expect(dirs).toContain("vendor");
	});
});

describe("collectSourceFiles — gitignore exclusion", () => {
	it("excludes directories named in root .gitignore", () => {
		fs.writeFileSync(path.join(tmpDir, ".gitignore"), "third_party/\n");

		// Source file in the root
		fs.writeFileSync(path.join(tmpDir, "main.ts"), "export const x = 1;\n");

		// Vendored file that should be excluded
		const thirdParty = path.join(tmpDir, "third_party");
		fs.mkdirSync(thirdParty);
		fs.writeFileSync(path.join(thirdParty, "upstream.ts"), "export const y = 2;\n");

		const files = collectSourceFiles(tmpDir, { extensions: [".ts"] });
		const names = files.map((f) => path.basename(f));

		expect(names).toContain("main.ts");
		expect(names).not.toContain("upstream.ts");
	});

	it("still excludes EXCLUDED_DIRS entries even without .gitignore", () => {
		// vendor is now in EXCLUDED_DIRS directly
		fs.writeFileSync(path.join(tmpDir, "app.ts"), "const a = 1;\n");
		const vendor = path.join(tmpDir, "vendor");
		fs.mkdirSync(vendor);
		fs.writeFileSync(path.join(vendor, "dep.ts"), "const b = 2;\n");

		const files = collectSourceFiles(tmpDir, { extensions: [".ts"] });
		const names = files.map((f) => path.basename(f));

		expect(names).toContain("app.ts");
		expect(names).not.toContain("dep.ts");
	});
});
