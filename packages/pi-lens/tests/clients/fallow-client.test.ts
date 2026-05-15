import { describe, expect, it } from "vitest";
import {
	FallowClient,
	isFallowProjectConfigFile,
	isFallowSourceFile,
	type FallowDeadCodeResult,
} from "../../clients/fallow-client.js";

function deadCodeResult(issues: FallowDeadCodeResult["issues"]): FallowDeadCodeResult {
	return {
		success: true,
		issues,
		unusedExports: issues.filter((issue) => issue.type === "unused-export"),
		unusedFiles: issues.filter((issue) => issue.type === "unused-file"),
		unusedDeps: issues.filter((issue) => issue.type.includes("dependency")),
		unlistedDeps: issues.filter((issue) => issue.type === "unlisted-dependency"),
		unresolvedImports: issues.filter((issue) => issue.type === "unresolved-import"),
		circularDependencies: issues.filter((issue) => issue.type === "circular-dependency"),
		boundaryViolations: issues.filter((issue) => issue.type === "boundary-violation"),
		totalIssues: issues.length,
		summary: `${issues.length} issue(s)`,
	};
}

describe("FallowClient", () => {
	it("classifies Fallow source and project config files", () => {
		expect(isFallowSourceFile("src/component.tsx")).toBe(true);
		expect(isFallowSourceFile("README.md")).toBe(false);
		expect(isFallowProjectConfigFile("package-lock.json")).toBe(true);
		expect(isFallowProjectConfigFile("src/package.ts")).toBe(false);
	});

	it("computes newly introduced dead-code issues by stable issue key", () => {
		const client = new FallowClient();
		const previous = deadCodeResult([
			{
				type: "unused-export",
				name: "oldHelper",
				file: "src/helpers.ts",
				line: 3,
			},
		]);
		const current = deadCodeResult([
			...previous.issues,
			{
				type: "unresolved-import",
				name: "@app/missing",
				file: "src/feature.ts",
				line: 1,
			},
		]);

		expect(client.newIssues(current, previous)).toEqual([
			expect.objectContaining({
				type: "unresolved-import",
				name: "@app/missing",
			}),
		]);
	});

	it("replaces full dead-code baselines with the latest successful full scan", () => {
		const client = new FallowClient();
		const previous = deadCodeResult([
			{
				type: "unused-export",
				name: "oldHelper",
				file: "src/helpers.ts",
				line: 3,
			},
		]);
		const current = deadCodeResult([
			{
				type: "unresolved-import",
				name: "@app/missing",
				file: "src/feature.ts",
				line: 1,
			},
		]);

		const merged = client.mergeDeadCodeBaseline(previous, current);

		expect(merged.issues).toEqual(current.issues);
	});

	it("replaces stale findings only for files covered by scoped dead-code scans", () => {
		const client = new FallowClient();
		const previous = deadCodeResult([
			{
				type: "unused-export",
				name: "oldHelper",
				file: "src/helpers.ts",
				line: 3,
			},
			{
				type: "unused-export",
				name: "otherHelper",
				file: "src/other.ts",
				line: 8,
			},
		]);
		const current = deadCodeResult([
			{
				type: "unresolved-import",
				name: "@app/missing",
				file: "src/helpers.ts",
				line: 1,
			},
		]);

		const merged = client.mergeDeadCodeBaseline(previous, current, {
			root: process.cwd(),
			files: ["src/helpers.ts"],
		});

		expect(merged.issues).toHaveLength(2);
		expect(merged.issues).toEqual([
			expect.objectContaining({ name: "otherHelper" }),
			expect.objectContaining({ name: "@app/missing" }),
		]);
		expect(merged.issues).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ name: "oldHelper" })]),
		);
	});

	it("keeps the previous baseline when a scoped scan fails", () => {
		const client = new FallowClient();
		const previous = deadCodeResult([
			{
				type: "unused-export",
				name: "oldHelper",
				file: "src/helpers.ts",
				line: 3,
			},
		]);
		const failed: FallowDeadCodeResult = {
			...deadCodeResult([]),
			success: false,
			summary: "fallow failed",
		};

		expect(client.mergeDeadCodeBaseline(previous, failed)).toBe(previous);
	});

	it("does not turn non-source scoped requests into full-project scans", async () => {
		const client = new FallowClient();

		const result = await client.deadCode(process.cwd(), { files: ["README.md"] });

		expect(result.success).toBe(true);
		expect(result.issues).toHaveLength(0);
		expect(result.summary).toContain("No supported JS/TS source files");
	});

	it("formats dead-code findings for agent-facing command output", () => {
		const client = new FallowClient();
		const output = client.formatDeadCode(
			deadCodeResult([
				{
					type: "unused-export",
					name: "unusedThing",
					file: "src/file.ts",
					line: 12,
				},
			]),
			process.cwd(),
		);

		expect(output).toContain("[Fallow dead-code]");
		expect(output).toContain("unusedThing");
		expect(output).toContain("src/file.ts:12");
	});
});
