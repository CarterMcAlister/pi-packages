import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TodoScanner } from "../../clients/todo-scanner.js";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("todo-scanner", () => {
	it("returns empty results when a file cannot be read", () => {
		const scanner = new TodoScanner();
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lens-todo-"));
		tempDirs.push(dir);

		expect(scanner.scanFile(dir)).toEqual([]);
	});
});
