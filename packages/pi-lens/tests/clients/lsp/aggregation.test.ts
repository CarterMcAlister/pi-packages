/**
 * Unit tests for raceToCompletion aggregation utility.
 * Verifies core racing logic independent of the LSP service layer.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { raceToCompletion } from "../../../clients/lsp/aggregation.js";

describe("raceToCompletion", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves immediately when first result satisfies shouldComplete and graceMs=0", async () => {
		const fast = new Promise<{ id: string; count: number }>((resolve) =>
			setTimeout(() => resolve({ id: "a", count: 1 }), 50),
		);
		const slow = new Promise<{ id: string; count: number }>(() => {});

		const resultPromise = raceToCompletion(
			[fast, slow],
			(results) => results.some((r) => r.count > 0),
			{ timeoutMs: 1500, graceMs: 0 },
		);

		await vi.advanceTimersByTimeAsync(50);
		await vi.advanceTimersByTimeAsync(1);

		const result = await resultPromise;
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("a");
	});

	it("collects both results when second finishes before grace window expires", async () => {
		const fast = new Promise<{ id: string; count: number }>((resolve) =>
			setTimeout(() => resolve({ id: "a", count: 1 }), 50),
		);
		const slow = new Promise<{ id: string; count: number }>((resolve) =>
			setTimeout(() => resolve({ id: "b", count: 1 }), 200),
		);

		const resultPromise = raceToCompletion(
			[fast, slow],
			(results) => results.some((r) => r.count > 0),
			{ timeoutMs: 1500, graceMs: 400 },
		);

		// Fast resolves at 50ms, starts grace (400ms). Slow resolves at 200ms,
		// before grace expires → remaining=0 → finalize immediately at 200ms.
		await vi.advanceTimersByTimeAsync(200);
		await vi.advanceTimersByTimeAsync(1);

		const result = await resultPromise;
		expect(result).toHaveLength(2);
	});

	it("does NOT finalize when first result is empty", async () => {
		const empty = new Promise<{ id: string; count: number }>((resolve) =>
			setTimeout(() => resolve({ id: "a", count: 0 }), 50),
		);
		const real = new Promise<{ id: string; count: number }>((resolve) =>
			setTimeout(() => resolve({ id: "b", count: 3 }), 300),
		);

		const resultPromise = raceToCompletion(
			[empty, real],
			(results) => results.some((r) => r.count > 0),
			{ timeoutMs: 1500, graceMs: 0 },
		);

		// Empty resolves at 50ms — shouldComplete=false → keep waiting.
		await vi.advanceTimersByTimeAsync(50);
		await vi.advanceTimersByTimeAsync(1);

		let resolved = false;
		resultPromise.then(() => {
			resolved = true;
		});
		await vi.advanceTimersByTimeAsync(1);
		expect(resolved).toBe(false);

		// Real resolves at 300ms.
		await vi.advanceTimersByTimeAsync(250);
		await vi.advanceTimersByTimeAsync(1);

		const result = await resultPromise;
		expect(result).toHaveLength(2);
		expect(result.map((r) => r.count)).toContain(3);
	});

	it("resolves via timeout when no results arrive", async () => {
		const hung = new Promise<{ id: string }>(() => {});

		const resultPromise = raceToCompletion(
			[hung, hung],
			(results) => results.length > 0,
			{ timeoutMs: 1500, graceMs: 0 },
		);

		await vi.advanceTimersByTimeAsync(1600);

		const result = await resultPromise;
		expect(result).toHaveLength(0);
	});
});
