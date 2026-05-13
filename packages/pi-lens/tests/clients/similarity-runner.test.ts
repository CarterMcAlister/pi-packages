import { describe, expect, it } from "vitest";

describe("similarity runner name overlap filters", () => {
	it("uses stricter similarity guardrail defaults", async () => {
		const similarity = await import(
			"../../clients/dispatch/runners/similarity.js"
		);
		expect(similarity.CONFIG.SIMILARITY_THRESHOLD).toBe(0.98);
		expect(similarity.CONFIG.MIN_TRANSITIONS).toBe(40);
		expect(similarity.CONFIG.MAX_TRANSITION_RATIO).toBe(1.8);
	});

	it("tokenizes camelCase and snake_case names", async () => {
		const similarity = await import(
			"../../clients/dispatch/runners/similarity.js"
		);
		expect(similarity.tokenizeFunctionName("registerHopListener")).toEqual([
			"register",
			"hop",
			"listener",
		]);
		expect(similarity.tokenizeFunctionName("fetch_with_retry")).toEqual([
			"fetch",
			"with",
			"retry",
		]);
	});

	it("keeps matches that share specific domain tokens", async () => {
		const similarity = await import(
			"../../clients/dispatch/runners/similarity.js"
		);
		expect(
			similarity.hasMeaningfulNameOverlap(
				"registerHopListener",
				"setupHopListener",
			),
		).toBe(true);
		expect(
			similarity.hasMeaningfulNameOverlap(
				"createProviderModel",
				"buildProviderClient",
			),
		).toBe(true);
	});

	it("drops noisy matches with only generic overlap", async () => {
		const similarity = await import(
			"../../clients/dispatch/runners/similarity.js"
		);
		expect(
			similarity.hasMeaningfulNameOverlap(
				"registerHopListener",
				"fetchWithRetry",
			),
		).toBe(false);
		expect(
			similarity.hasMeaningfulNameOverlap("createHelper", "buildUtil"),
		).toBe(false);
	});
});
