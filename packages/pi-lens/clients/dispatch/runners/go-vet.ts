/**
 * Go vet runner for dispatch system
 *
 * Runs `go vet` for Go files to catch common mistakes.
 */

import { safeSpawnAsync } from "../../safe-spawn.js";
import { stripAnsi } from "../../sanitize.js";
import { parseGoVetOutput } from "./utils/diagnostic-parsers.js";
import type {
	DispatchContext,
	RunnerDefinition,
	RunnerResult,
} from "../types.js";
import { PRIORITY } from "../priorities.js";

const goVetRunner: RunnerDefinition = {
	id: "go-vet",
	appliesTo: ["go"],
	priority: PRIORITY.SPECIALIZED_ANALYSIS,
	enabledByDefault: true,

	async run(ctx: DispatchContext): Promise<RunnerResult> {
		// Check if go is available
		const check = await safeSpawnAsync("go", ["version"], {
			timeout: 5000,
		});

		if (check.error || check.status !== 0) {
			return { status: "skipped", diagnostics: [], semantic: "none" };
		}

		// Run go vet on the file
		const result = await safeSpawnAsync("go", ["vet", ctx.filePath], {
			timeout: 30000,
		});

		const raw = stripAnsi(result.stdout + result.stderr);

		if (result.status === 0 && !raw.trim()) {
			return { status: "succeeded", diagnostics: [], semantic: "none" };
		}

		// Parse output
		const diagnostics = parseGoVetOutput(raw, ctx.filePath);

		if (diagnostics.length === 0) {
			// go vet returned non-zero but no parseable output
			return {
				status: "failed",
				diagnostics: [],
				semantic: "warning",
				rawOutput: raw,
			};
		}

		return {
			status: "failed",
			diagnostics,
			semantic: "warning",
		};
	},
};

export default goVetRunner;
