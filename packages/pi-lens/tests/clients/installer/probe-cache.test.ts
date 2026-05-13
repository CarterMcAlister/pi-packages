import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("../../../clients/installer/index.ts");

const mockFsReadFile = vi.hoisted(() => vi.fn());
const mockFsAccess = vi.hoisted(() => vi.fn());
const mockFsStat = vi.hoisted(() => vi.fn());
const mockFsWriteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFsMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFsAppendFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("node:fs/promises", () => ({
	default: {
		readFile: mockFsReadFile,
		access: mockFsAccess,
		stat: mockFsStat,
		writeFile: mockFsWriteFile,
		mkdir: mockFsMkdir,
		appendFile: mockFsAppendFile,
	},
	readFile: mockFsReadFile,
	access: mockFsAccess,
	stat: mockFsStat,
	writeFile: mockFsWriteFile,
	mkdir: mockFsMkdir,
	appendFile: mockFsAppendFile,
}));

import {
	checkProbeCache,
	resetProbeCacheStateForTesting,
	updateProbeCache,
} from "../../../clients/installer/index.ts";

const TOOL_ID = "typescript-language-server";
const TOOL_PATH = "/home/user/.pi-lens/tools/node_modules/.bin/typescript-language-server";
const MTIME_MS = 1_700_000_000_000;

function makeCacheJson(overrides: Partial<{ cachedAt: number; mtimeMs: number }> = {}) {
	return JSON.stringify({
		[TOOL_ID]: {
			path: TOOL_PATH,
			mtimeMs: overrides.mtimeMs ?? MTIME_MS,
			cachedAt: overrides.cachedAt ?? Date.now(),
		},
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	resetProbeCacheStateForTesting();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("checkProbeCache", () => {
	it("returns undefined when no entry exists for the tool", async () => {
		mockFsReadFile.mockResolvedValue(JSON.stringify({}));

		const result = await checkProbeCache(TOOL_ID);

		expect(result).toBeUndefined();
	});

	it("returns undefined and evicts when TTL has expired", async () => {
		const expiredAt = Date.now() - 25 * 60 * 60 * 1000; // 25h ago
		mockFsReadFile.mockResolvedValue(makeCacheJson({ cachedAt: expiredAt }));

		const result = await checkProbeCache(TOOL_ID);

		expect(result).toBeUndefined();
		// Entry should be gone from the in-memory cache
		const second = await checkProbeCache(TOOL_ID);
		expect(second).toBeUndefined();
		expect(mockFsAccess).not.toHaveBeenCalled();
	});

	it("returns undefined and evicts when the binary is gone", async () => {
		mockFsReadFile.mockResolvedValue(makeCacheJson());
		mockFsAccess.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

		const result = await checkProbeCache(TOOL_ID);

		expect(result).toBeUndefined();
		expect(mockFsAccess).toHaveBeenCalledWith(TOOL_PATH);
	});

	it("returns undefined and evicts when the binary mtime has changed", async () => {
		mockFsReadFile.mockResolvedValue(makeCacheJson({ mtimeMs: MTIME_MS }));
		mockFsAccess.mockResolvedValue(undefined);
		mockFsStat.mockResolvedValue({ mtimeMs: MTIME_MS + 1 }); // different mtime

		const result = await checkProbeCache(TOOL_ID);

		expect(result).toBeUndefined();
		expect(mockFsStat).toHaveBeenCalledWith(TOOL_PATH);
	});

	it("returns the cached path when entry is valid", async () => {
		mockFsReadFile.mockResolvedValue(makeCacheJson({ mtimeMs: MTIME_MS }));
		mockFsAccess.mockResolvedValue(undefined);
		mockFsStat.mockResolvedValue({ mtimeMs: MTIME_MS });

		const result = await checkProbeCache(TOOL_ID);

		expect(result).toBe(TOOL_PATH);
	});

	it("skips readFile on the second call (uses in-memory cache)", async () => {
		mockFsReadFile.mockResolvedValue(makeCacheJson({ mtimeMs: MTIME_MS }));
		mockFsAccess.mockResolvedValue(undefined);
		mockFsStat.mockResolvedValue({ mtimeMs: MTIME_MS });

		await checkProbeCache(TOOL_ID);
		await checkProbeCache(TOOL_ID);

		expect(mockFsReadFile).toHaveBeenCalledTimes(1);
	});
});

describe("updateProbeCache", () => {
	it("populates the in-memory cache so a subsequent checkProbeCache hits without I/O", async () => {
		// No disk cache
		mockFsReadFile.mockRejectedValue(new Error("ENOENT"));
		// stat for updateProbeCache
		mockFsStat.mockResolvedValue({ mtimeMs: MTIME_MS });
		// access + stat for the subsequent checkProbeCache
		mockFsAccess.mockResolvedValue(undefined);

		await updateProbeCache(TOOL_ID, TOOL_PATH);

		const result = await checkProbeCache(TOOL_ID);
		expect(result).toBe(TOOL_PATH);
	});

	it("silently ignores a stat failure", async () => {
		mockFsStat.mockRejectedValue(new Error("ENOENT"));

		await expect(updateProbeCache(TOOL_ID, TOOL_PATH)).resolves.toBeUndefined();
	});

	it("schedules a flush to disk", async () => {
		vi.useFakeTimers();
		mockFsReadFile.mockRejectedValue(new Error("ENOENT"));
		mockFsStat.mockResolvedValue({ mtimeMs: MTIME_MS });

		await updateProbeCache(TOOL_ID, TOOL_PATH);
		vi.advanceTimersByTime(400);

		expect(mockFsWriteFile).toHaveBeenCalledOnce();
		const [, content] = mockFsWriteFile.mock.calls[0] as [string, string];
		const written = JSON.parse(content) as Record<string, unknown>;
		expect(written[TOOL_ID]).toMatchObject({ path: TOOL_PATH, mtimeMs: MTIME_MS });
	});
});
