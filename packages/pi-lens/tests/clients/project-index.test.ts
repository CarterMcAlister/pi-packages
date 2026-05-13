import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildProjectIndex,
	findSimilarFunctions,
	loadIndex,
	type ProjectIndex,
	saveIndex,
} from "../../clients/project-index.js";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("project-index", () => {
	describe("index persistence regression", () => {
		it("preserves line numbers through save/load roundtrip", async () => {
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lens-persist-"));
			dirs.push(tmp);

			// Create a complex function to index
			const code = `function complexFunction(x: number): number {
	if (x > 0) {
		if (x > 10) return x * 2;
		if (x > 5) return x + 10;
		return x;
	}
	for (let i = 0; i < 10; i++) {
		if (i % 2 === 0) continue;
		console.log(i);
	}
	return 0;
}`;
			const filePath = path.join(tmp, "test.ts");
			fs.writeFileSync(filePath, code);

			// Build and save index
			const originalIndex = await buildProjectIndex(tmp, [filePath]);
			const originalEntries = Array.from(originalIndex.entries.values());
			expect(originalEntries.length).toBe(1);
			expect(originalEntries[0]!.line).toBe(1);

			await saveIndex(originalIndex, tmp);

			// Load index and verify line numbers preserved
			const loadedIndex = await loadIndex(tmp);
			expect(loadedIndex).not.toBeNull();

			const loadedEntries = Array.from(loadedIndex!.entries.values());
			expect(loadedEntries.length).toBe(1);
			expect(loadedEntries[0]!.line).toBe(1);
			expect(loadedEntries[0]!.functionName).toBe("complexFunction");
		});

		it("preserves line numbers for functions not on line 1", async () => {
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lens-persist-"));
			dirs.push(tmp);

			// Function on line 3 with some comments before it
			const code = `// Header comment
// Another comment
function lineThreeFunction(): void {
	const a = 1;
	const b = 2;
	if (a > 0 && b > 0) {
		console.log("positive");
		if (a > 10) {
			console.log("big");
		}
	}
	for (let i = 0; i < 5; i++) {
		console.log(i);
	}
}
`;
			const filePath = path.join(tmp, "test.ts");
			fs.writeFileSync(filePath, code);

			const originalIndex = await buildProjectIndex(tmp, [filePath]);
			const originalEntry = Array.from(originalIndex.entries.values())[0]!;
			expect(originalEntry.line).toBe(3);

			await saveIndex(originalIndex, tmp);
			const loadedIndex = await loadIndex(tmp);
			const loadedEntry = Array.from(loadedIndex!.entries.values())[0]!;

			// Critical regression test: line number must survive serialization
			expect(loadedEntry.line).toBe(3);
			expect(loadedEntry.line).not.toBeUndefined();
			expect(loadedEntry.line).not.toBeNull();
		});
	});

	describe("line number capture", () => {
		it("captures correct line numbers for complex functions", async () => {
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lens-index-"));
			dirs.push(tmp);

			// Create a function with enough complexity (>=20 transitions) to be indexed
			// Line 3: function starts
			const code = `
// Comment line

function complexFunction(a: string, b: number): boolean {
	const x = a.length;
	const y = b * 2;
	if (x > 0 && y > 0) {
		if (x > 10) {
			console.log("big");
		} else if (x > 5) {
			console.log("medium");
		} else {
			console.log("small");
		}
		return true;
	}
	for (let i = 0; i < 3; i++) {
		if (i % 2 === 0) continue;
		console.log(i);
	}
	return false;
}
`;
			const filePath = path.join(tmp, "test.ts");
			fs.writeFileSync(filePath, code);

			const index = await buildProjectIndex(tmp, [filePath]);

			const entries = Array.from(index.entries.values());
			expect(entries.length).toBe(1);

			const testFn = entries[0]!;
			expect(testFn.functionName).toBe("complexFunction");
			expect(testFn.line).toBe(4); // 1-indexed, function starts on line 4
			expect(testFn.transitionCount).toBeGreaterThanOrEqual(20);
		});

		it("stores line numbers as 1-indexed integers", async () => {
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lens-index-"));
			dirs.push(tmp);

			// Function on first line with enough complexity
			const code = `function firstLineFn(x: number): number {
	if (x > 0) {
		if (x > 10) {
			return x * 2;
		} else if (x > 5) {
			return x + 10;
		} else {
			return x;
		}
	}
	for (let i = 0; i < 5; i++) {
		if (i % 2 === 0) continue;
		console.log(i);
	}
	return 0;
}`;
			const filePath = path.join(tmp, "first.ts");
			fs.writeFileSync(filePath, code);

			const index = await buildProjectIndex(tmp, [filePath]);
			const entries = Array.from(index.entries.values());

			expect(entries.length).toBe(1);
			expect(entries[0]!.line).toBe(1);
			expect(Number.isInteger(entries[0]!.line)).toBe(true);
		});
	});

	describe("findSimilarFunctions", () => {
		it("returns correct line numbers in targetLocation", () => {
			const mockMatrix = Array(57)
				.fill(0)
				.map(() =>
					Array(72)
						.fill(0)
						.map(() => Math.random()),
				);

			const index: ProjectIndex = {
				version: "1.0",
				createdAt: new Date().toISOString(),
				entries: new Map([
					[
						"utils.ts:formatDate",
						{
							id: "utils.ts:formatDate",
							filePath: "utils.ts",
							functionName: "formatDate",
							signature: "(date: Date) => string",
							matrix: mockMatrix,
							transitionCount: 50,
							lastModified: Date.now(),
							exports: ["formatDate"],
							line: 42,
						},
					],
				]),
			};

			const matches = findSimilarFunctions(mockMatrix, index, 0.75, 3);

			expect(matches.length).toBe(1);
			expect(matches[0]!.targetLocation).toBe("utils.ts:42");
			expect(matches[0]!.targetLocation).not.toBe("utils.ts:1");
		});

		it("does not use hardcoded :1 for line numbers", () => {
			// This test verifies the fix for the TODO: "get actual line"
			const mockMatrix = Array(57)
				.fill(0)
				.map(() =>
					Array(72)
						.fill(0)
						.map(() => Math.random()),
				);

			const index: ProjectIndex = {
				version: "1.0",
				createdAt: new Date().toISOString(),
				entries: new Map([
					[
						"main.ts:processData",
						{
							id: "main.ts:processData",
							filePath: "main.ts",
							functionName: "processData",
							signature: "(data: string[]) => void",
							matrix: mockMatrix,
							transitionCount: 100,
							lastModified: Date.now(),
							exports: ["processData"],
							line: 150,
						},
					],
				]),
			};

			const matches = findSimilarFunctions(mockMatrix, index, 0.75, 3);

			expect(matches.length).toBe(1);
			// Before the fix, this would always be "main.ts:1" (hardcoded)
			// After the fix, it should be "main.ts:150" (actual line)
			expect(matches[0]!.targetLocation).toBe("main.ts:150");
			expect(matches[0]!.targetLocation).not.toMatch(/:1$/);
		});

		it("handles line 1 correctly", () => {
			const mockMatrix = Array(57)
				.fill(0)
				.map(() =>
					Array(72)
						.fill(0)
						.map(() => Math.random()),
				);

			const index: ProjectIndex = {
				version: "1.0",
				createdAt: new Date().toISOString(),
				entries: new Map([
					[
						"utils.ts:helper",
						{
							id: "utils.ts:helper",
							filePath: "utils.ts",
							functionName: "helper",
							signature: "() => void",
							matrix: mockMatrix,
							transitionCount: 25,
							lastModified: Date.now(),
							exports: ["helper"],
							line: 1, // Function actually on line 1
						},
					],
				]),
			};

			const matches = findSimilarFunctions(mockMatrix, index, 0.75, 3);

			expect(matches.length).toBe(1);
			// Line 1 should now be legitimate (actual location), not hardcoded
			expect(matches[0]!.targetLocation).toBe("utils.ts:1");
		});
	});
});
