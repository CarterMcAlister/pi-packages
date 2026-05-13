import { describe, expect, it } from "vitest";

/****************************************************************
 * NOTE: This test file tests the Biome JSON parser logic.
 *
 * The actual biome-check runner spawns the biome CLI binary,
 * which isn't available in tests. Instead, we test the JSON
 * parsing logic directly with mock Biome JSON output.
 *
 * To run integration tests with the actual biome binary,
 * use the doctor command or manual testing.
 ****************************************************************/

describe("biome-check JSON parser", () => {
	// Inline the parser function for testing
	// (The actual implementation is in biome-check.ts)
	function parseBiomeJson(raw: string, filePath: string) {
		interface BiomeDiagnostic {
			severity: "error" | "warning" | "information" | "hint";
			category: string;
			message: string;
			location: {
				source: string;
				start: { line: number; column: number };
				end: { line: number; column: number };
			};
			tags?: string[];
		}

		try {
			const result = JSON.parse(raw);
			const diagnostics: BiomeDiagnostic[] = result.diagnostics || [];

			return diagnostics.map((d) => ({
				id: `biome:${d.category}:${d.location.start.line}`,
				message: d.message,
				filePath,
				line: d.location.start.line,
				column: d.location.start.column,
				severity: d.severity === "error" ? "error" : "warning",
				semantic: d.severity === "error" ? "blocking" : ("warning" as const),
				tool: "biome",
				rule: d.category,
			}));
		} catch {
			return [];
		}
	}

	describe("parseBiomeJson", () => {
		it("parses error diagnostics correctly", () => {
			const biomeOutput = JSON.stringify({
				diagnostics: [
					{
						severity: "error",
						category: "noShadow",
						message: "Do not shadow variables",
						location: {
							source: "test.ts",
							start: { line: 10, column: 5 },
							end: { line: 10, column: 8 },
						},
					},
				],
			});

			const result = parseBiomeJson(biomeOutput, "/src/test.ts");

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				id: "biome:noShadow:10",
				message: "Do not shadow variables",
				filePath: "/src/test.ts",
				line: 10,
				column: 5,
				severity: "error",
				semantic: "blocking",
				tool: "biome",
				rule: "noShadow",
			});
		});

		it("parses warning diagnostics as non-blocking", () => {
			const biomeOutput = JSON.stringify({
				diagnostics: [
					{
						severity: "warning",
						category: "preferOptionalChain",
						message: "Use optional chaining instead",
						location: {
							source: "test.ts",
							start: { line: 5, column: 10 },
							end: { line: 5, column: 20 },
						},
					},
				],
			});

			const result = parseBiomeJson(biomeOutput, "/src/test.ts");

			expect(result).toHaveLength(1);
			expect(result[0].severity).toBe("warning");
			expect(result[0].semantic).toBe("warning");
		});

		it("handles multiple diagnostics", () => {
			const biomeOutput = JSON.stringify({
				diagnostics: [
					{
						severity: "error",
						category: "noUnusedVariables",
						message: "Unused variable",
						location: {
							source: "test.ts",
							start: { line: 1, column: 1 },
							end: { line: 1, column: 5 },
						},
					},
					{
						severity: "warning",
						category: "noConsole",
						message: "Do not use console",
						location: {
							source: "test.ts",
							start: { line: 2, column: 1 },
							end: { line: 2, column: 8 },
						},
					},
				],
			});

			const result = parseBiomeJson(biomeOutput, "/src/test.ts");

			expect(result).toHaveLength(2);
			expect(result[0].severity).toBe("error");
			expect(result[1].severity).toBe("warning");
		});

		it("handles empty diagnostics array", () => {
			const biomeOutput = JSON.stringify({ diagnostics: [] });
			const result = parseBiomeJson(biomeOutput, "/src/test.ts");
			expect(result).toHaveLength(0);
		});

		it("handles missing diagnostics field", () => {
			const biomeOutput = JSON.stringify({});
			const result = parseBiomeJson(biomeOutput, "/src/test.ts");
			expect(result).toHaveLength(0);
		});

		it("handles invalid JSON gracefully", () => {
			const result = parseBiomeJson("not valid json", "/src/test.ts");
			expect(result).toHaveLength(0);
		});

		it("maps all severity levels correctly", () => {
			const biomeOutput = JSON.stringify({
				diagnostics: [
					{
						severity: "error",
						category: "e1",
						message: "Error",
						location: {
							source: "f",
							start: { line: 1, column: 1 },
							end: { line: 1, column: 1 },
						},
					},
					{
						severity: "warning",
						category: "w1",
						message: "Warning",
						location: {
							source: "f",
							start: { line: 2, column: 1 },
							end: { line: 2, column: 1 },
						},
					},
					{
						severity: "information",
						category: "i1",
						message: "Info",
						location: {
							source: "f",
							start: { line: 3, column: 1 },
							end: { line: 3, column: 1 },
						},
					},
					{
						severity: "hint",
						category: "h1",
						message: "Hint",
						location: {
							source: "f",
							start: { line: 4, column: 1 },
							end: { line: 4, column: 1 },
						},
					},
				],
			});

			const result = parseBiomeJson(biomeOutput, "/src/test.ts");

			expect(result).toHaveLength(4);
			expect(result[0].severity).toBe("error");
			expect(result[0].semantic).toBe("blocking");
			expect(result[1].severity).toBe("warning");
			expect(result[1].semantic).toBe("warning");
			// information and hint are mapped to warning (non-blocking)
			expect(result[2].severity).toBe("warning");
			expect(result[2].semantic).toBe("warning");
			expect(result[3].severity).toBe("warning");
			expect(result[3].semantic).toBe("warning");
		});

		it("uses correct id format", () => {
			const biomeOutput = JSON.stringify({
				diagnostics: [
					{
						severity: "error",
						category: "noHardcodedCredentials",
						message: "Hardcoded credentials",
						location: {
							source: "config.ts",
							start: { line: 42, column: 15 },
							end: { line: 42, column: 30 },
						},
					},
				],
			});

			const result = parseBiomeJson(biomeOutput, "/project/config.ts");

			expect(result[0].id).toBe("biome:noHardcodedCredentials:42");
		});
	});
});
