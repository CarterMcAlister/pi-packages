/**
 * Fallow Client for pi-lens
 *
 * Fallow provides project-graph intelligence for TypeScript/JavaScript:
 * dead code, dependency hygiene, duplication, complexity, architecture
 * boundaries, and PR-time audit verdicts.
 *
 * Docs: https://docs.fallow.tools/
 */

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { safeSpawnAsync } from "./safe-spawn.js";

export interface FallowIssue {
	type: string;
	name: string;
	file?: string;
	line?: number;
	column?: number;
	severity?: "error" | "warning" | "info" | "hint";
	detail?: string;
	actions?: unknown[];
}

export interface FallowDeadCodeResult {
	success: boolean;
	issues: FallowIssue[];
	unusedExports: FallowIssue[];
	unusedFiles: FallowIssue[];
	unusedDeps: FallowIssue[];
	unlistedDeps: FallowIssue[];
	unresolvedImports: FallowIssue[];
	circularDependencies: FallowIssue[];
	boundaryViolations: FallowIssue[];
	totalIssues: number;
	summary: string;
	raw?: unknown;
}

export interface FallowCloneInstance {
	file: string;
	startLine?: number;
	endLine?: number;
}

export interface FallowCloneGroup {
	instances: FallowCloneInstance[];
	lines: number;
	tokens?: number;
}

export interface FallowDupesResult {
	success: boolean;
	clones: FallowCloneGroup[];
	duplicatedLines: number;
	totalLines: number;
	percentage: number;
	summary: string;
	raw?: unknown;
}

export interface FallowHealthFinding {
	file: string;
	name: string;
	line?: number;
	column?: number;
	cyclomatic?: number;
	cognitive?: number;
	lineCount?: number;
	exceeded?: string;
}

export interface FallowHealthTarget {
	file: string;
	priority?: number;
	efficiency?: number;
	category?: string;
	effort?: string;
	confidence?: string;
	recommendation?: string;
}

export interface FallowHealthResult {
	success: boolean;
	findings: FallowHealthFinding[];
	targets: FallowHealthTarget[];
	filesAnalyzed: number;
	functionsAnalyzed: number;
	functionsAboveThreshold: number;
	averageMaintainability?: number;
	summary: string;
	raw?: unknown;
}

export interface FallowAuditResult {
	success: boolean;
	verdict?: "pass" | "warn" | "fail";
	baseRef?: string;
	changedFilesCount: number;
	deadCode: FallowDeadCodeResult;
	duplication: FallowDupesResult;
	health: FallowHealthResult;
	summary: string;
	raw?: unknown;
}

export interface FallowProjectResult {
	deadCode: FallowDeadCodeResult;
	duplication: FallowDupesResult;
	health: FallowHealthResult;
}

type FallowCommand = "dead-code" | "dupes" | "health" | "audit";

type JsonObject = Record<string, unknown>;

const EMPTY_DEAD_CODE: Omit<FallowDeadCodeResult, "summary"> = {
	success: false,
	issues: [],
	unusedExports: [],
	unusedFiles: [],
	unusedDeps: [],
	unlistedDeps: [],
	unresolvedImports: [],
	circularDependencies: [],
	boundaryViolations: [],
	totalIssues: 0,
};

const EMPTY_DUPES: Omit<FallowDupesResult, "summary"> = {
	success: false,
	clones: [],
	duplicatedLines: 0,
	totalLines: 0,
	percentage: 0,
};

const EMPTY_HEALTH: Omit<FallowHealthResult, "summary"> = {
	success: false,
	findings: [],
	targets: [],
	filesAnalyzed: 0,
	functionsAnalyzed: 0,
	functionsAboveThreshold: 0,
};

const ANALYSIS_TIMEOUT_MS = 45_000;
const AUDIT_TIMEOUT_MS = 90_000;

const ROOT_MARKERS = [
	"package.json",
	"pnpm-workspace.yaml",
	"yarn.lock",
	"package-lock.json",
	"bun.lock",
	"bun.lockb",
	"tsconfig.json",
	"jsconfig.json",
	".fallowrc.json",
	".fallowrc.jsonc",
	"fallow.toml",
	".fallow.toml",
];

const SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".vue",
	".svelte",
	".astro",
	".mdx",
]);

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"out",
	"coverage",
	".next",
	".nuxt",
	".svelte-kit",
	".turbo",
	".cache",
	".fallow",
]);

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function arrayValue(value: unknown): JsonObject[] {
	return Array.isArray(value) ? value.filter(isObject) : [];
}

function firstString(obj: JsonObject, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = stringValue(obj[key]);
		if (value) return value;
	}
	return undefined;
}

function firstNumber(obj: JsonObject, keys: string[]): number | undefined {
	for (const key of keys) {
		const value = numberValue(obj[key]);
		if (value !== undefined) return value;
	}
	return undefined;
}

function normalizeSeverity(value: unknown): FallowIssue["severity"] | undefined {
	const raw = stringValue(value)?.toLowerCase();
	if (raw === "error" || raw === "warning" || raw === "info" || raw === "hint") {
		return raw;
	}
	if (raw === "warn") return "warning";
	return undefined;
}

function relativeDisplay(cwd: string, filePath: string | undefined): string {
	if (!filePath) return "";
	const resolved = nodePath.isAbsolute(filePath) ? filePath : nodePath.resolve(cwd, filePath);
	return nodePath.relative(cwd, resolved).replace(/\\/g, "/") || nodePath.basename(filePath);
}

function lineSuffix(issue: { line?: number; column?: number }): string {
	if (!issue.line) return "";
	return issue.column ? `:${issue.line}:${issue.column}` : `:${issue.line}`;
}

function capText(text: string, maxChars = 5000): string {
	return text.length > maxChars ? `${text.slice(0, maxChars)}\n... (truncated)` : text;
}

function parseJsonOutput(raw: string): unknown | undefined {
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(trimmed.slice(start, end + 1));
			} catch {
				return undefined;
			}
		}
		return undefined;
	}
}

function issueFile(item: JsonObject): string | undefined {
	return firstString(item, [
		"path",
		"file",
		"file_path",
		"source_path",
		"from",
		"importer",
	]);
}

function issueName(item: JsonObject, fallback: string, preferredKeys: string[]): string {
	const direct = firstString(item, [
		...preferredKeys,
		"export_name",
		"type_name",
		"member_name",
		"package_name",
		"dependency",
		"import_path",
		"name",
		"rule",
		"message",
	]);
	if (direct) return direct;

	const cycle = item.cycle ?? item.path;
	if (Array.isArray(cycle) && cycle.every((part) => typeof part === "string")) {
		return cycle.join(" → ");
	}

	return fallback;
}

function toIssue(
	type: string,
	item: JsonObject,
	preferredNameKeys: string[] = [],
): FallowIssue {
	const file = issueFile(item);
	return {
		type,
		name: issueName(item, type, preferredNameKeys),
		...(file ? { file } : {}),
		...(firstNumber(item, ["line", "start_line", "line_start"])
			? { line: firstNumber(item, ["line", "start_line", "line_start"]) }
			: {}),
		...(firstNumber(item, ["col", "column", "start_col"])
			? { column: firstNumber(item, ["col", "column", "start_col"]) }
			: {}),
		...(normalizeSeverity(item.severity) ? { severity: normalizeSeverity(item.severity) } : {}),
		...(stringValue(item.message) ? { detail: stringValue(item.message) } : {}),
		...(Array.isArray(item.actions) ? { actions: item.actions } : {}),
	};
}

function collectIssueArrays(data: unknown, specs: Array<[key: string, type: string, names?: string[]]>): FallowIssue[] {
	if (!isObject(data)) return [];
	const issues: FallowIssue[] = [];
	for (const [key, type, names = []] of specs) {
		for (const item of arrayValue(data[key])) {
			issues.push(toIssue(type, item, names));
		}
	}

	for (const group of arrayValue(data.groups)) {
		issues.push(...collectIssueArrays(group, specs));
	}

	return issues;
}

const DEAD_CODE_SPECS: Array<[key: string, type: string, names?: string[]]> = [
	["unused_exports", "unused-export", ["export_name"]],
	["unused_files", "unused-file", ["path"]],
	["unused_types", "unused-type", ["type_name", "export_name"]],
	["private_type_leaks", "private-type-leak", ["export_name", "type_name"]],
	["unused_dependencies", "unused-dependency", ["package_name"]],
	["unused_deps", "unused-dependency", ["package_name"]],
	["unused_dev_dependencies", "unused-dev-dependency", ["package_name"]],
	["unused_optional_dependencies", "unused-optional-dependency", ["package_name"]],
	["type_only_dependencies", "type-only-dependency", ["package_name"]],
	["unlisted_dependencies", "unlisted-dependency", ["package_name"]],
	["unlisted_deps", "unlisted-dependency", ["package_name"]],
	["unresolved_imports", "unresolved-import", ["import_path", "specifier"]],
	["duplicate_exports", "duplicate-export", ["export_name"]],
	["circular_dependencies", "circular-dependency", ["cycle"]],
	["boundary_violations", "boundary-violation", ["rule", "zone"]],
	["unused_enum_members", "unused-enum-member", ["member_name", "name"]],
	["unused_class_members", "unused-class-member", ["member_name", "name"]],
	["stale_suppressions", "stale-suppression", ["origin"]],
	["unused_catalog_entries", "unused-catalog-entry", ["package_name", "name"]],
	["empty_catalog_groups", "empty-catalog-group", ["name"]],
	["unresolved_catalog_references", "unresolved-catalog-reference", ["package_name", "name"]],
	["unused_dependency_overrides", "unused-dependency-override", ["package_name"]],
	["misconfigured_dependency_overrides", "misconfigured-dependency-override", ["package_name"]],
];

function summarizeDeadCode(result: FallowDeadCodeResult): string {
	if (!result.success) return result.summary;
	if (result.totalIssues === 0) return "No Fallow dead-code issues found";
	const parts = [
		`${result.totalIssues} issue(s)`,
		result.unusedExports.length ? `${result.unusedExports.length} unused export(s)` : "",
		result.unusedFiles.length ? `${result.unusedFiles.length} unused file(s)` : "",
		result.unusedDeps.length ? `${result.unusedDeps.length} unused dep(s)` : "",
		result.unlistedDeps.length ? `${result.unlistedDeps.length} unlisted dep(s)` : "",
		result.unresolvedImports.length ? `${result.unresolvedImports.length} unresolved import(s)` : "",
		result.circularDependencies.length ? `${result.circularDependencies.length} cycle(s)` : "",
	]
		.filter(Boolean)
		.join(" — ");
	return parts;
}

function parseDeadCode(data: unknown, fallbackSummary: string, success: boolean): FallowDeadCodeResult {
	if (!isObject(data)) {
		return { ...EMPTY_DEAD_CODE, success: false, summary: fallbackSummary };
	}

	const issues = collectIssueArrays(data, DEAD_CODE_SPECS);
	const summaryObj = isObject(data.summary) ? data.summary : undefined;
	const totalIssues =
		numberValue(data.total_issues) ??
		numberValue(summaryObj?.total_issues) ??
		numberValue(summaryObj?.dead_code_issues) ??
		issues.length;

	const result: FallowDeadCodeResult = {
		success,
		issues,
		unusedExports: issues.filter((i) => i.type === "unused-export"),
		unusedFiles: issues.filter((i) => i.type === "unused-file"),
		unusedDeps: issues.filter((i) => i.type.includes("unused") && i.type.includes("dependency")),
		unlistedDeps: issues.filter((i) => i.type === "unlisted-dependency"),
		unresolvedImports: issues.filter((i) => i.type === "unresolved-import"),
		circularDependencies: issues.filter((i) => i.type === "circular-dependency"),
		boundaryViolations: issues.filter((i) => i.type === "boundary-violation"),
		totalIssues,
		summary: "",
		raw: data,
	};
	result.summary = summarizeDeadCode(result);
	return result;
}

function instanceFrom(value: unknown): FallowCloneInstance | undefined {
	if (!isObject(value)) return undefined;
	const file = firstString(value, ["path", "file", "file_path"]);
	if (!file) return undefined;
	return {
		file,
		...(firstNumber(value, ["start_line", "start", "line"])
			? { startLine: firstNumber(value, ["start_line", "start", "line"]) }
			: {}),
		...(firstNumber(value, ["end_line", "end"])
			? { endLine: firstNumber(value, ["end_line", "end"]) }
			: {}),
	};
}

function firstObjectValue(obj: JsonObject, keys: string[]): unknown {
	for (const key of keys) {
		if (obj[key] !== undefined) return obj[key];
	}
	return undefined;
}

function collectCloneGroups(data: unknown): FallowCloneGroup[] {
	if (!isObject(data)) return [];
	const groups: FallowCloneGroup[] = [];
	const cloneGroups = [
		...arrayValue(data.clone_groups),
		...arrayValue(data.cloneGroups),
		...arrayValue(data.clones),
		...arrayValue(data.duplicates),
	];
	for (const item of cloneGroups) {
		const rawInstances = Array.isArray(item.instances)
			? item.instances
			: Array.isArray(item.locations)
				? item.locations
				: [];
		const instances = rawInstances
			.map(instanceFrom)
			.filter((entry): entry is FallowCloneInstance => entry !== undefined);
		groups.push({
			instances,
			lines: firstNumber(item, ["line_count", "lines", "total_lines"]) ?? 0,
			...(firstNumber(item, ["token_count", "tokens"]) ? { tokens: firstNumber(item, ["token_count", "tokens"]) } : {}),
		});
	}
	for (const group of arrayValue(data.groups)) {
		groups.push(...collectCloneGroups(group));
	}
	return groups;
}

function parseDupes(data: unknown, fallbackSummary: string, success: boolean): FallowDupesResult {
	if (!isObject(data)) {
		return { ...EMPTY_DUPES, success: false, summary: fallbackSummary };
	}
	const stats = isObject(data.stats) ? data.stats : undefined;
	const summaryObj = isObject(data.summary) ? data.summary : undefined;
	const clones = collectCloneGroups(data);
	const duplicatedLines =
		numberValue(stats?.duplicated_lines) ??
		numberValue(stats?.duplicatedLines) ??
		numberValue(summaryObj?.duplicated_lines) ??
		0;
	const totalLines =
		numberValue(stats?.total_lines) ??
		numberValue(stats?.totalLines) ??
		numberValue(summaryObj?.total_lines) ??
		0;
	const percentage =
		numberValue(stats?.duplication_percentage) ??
		numberValue(stats?.percentage) ??
		numberValue(summaryObj?.duplication_percentage) ??
		0;
	const result: FallowDupesResult = {
		success,
		clones,
		duplicatedLines,
		totalLines,
		percentage,
		summary: "",
		raw: data,
	};
	result.summary = !result.success
		? fallbackSummary
		: clones.length === 0
			? "No Fallow duplicate blocks found"
			: `${clones.length} clone group(s) — ${percentage.toFixed(1)}% duplicated (${duplicatedLines}/${totalLines} lines)`;
	return result;
}

function parseHealth(data: unknown, fallbackSummary: string, success: boolean): FallowHealthResult {
	if (!isObject(data)) {
		return { ...EMPTY_HEALTH, success: false, summary: fallbackSummary };
	}
	const summaryObj = isObject(data.summary) ? data.summary : undefined;
	const findingItems = [
		...arrayValue(data.findings),
		...arrayValue(data.complexity_findings),
		...arrayValue(data.complexityFindings),
	];
	const targetItems = [
		...arrayValue(data.targets),
		...arrayValue(data.refactor_targets),
		...arrayValue(data.refactorTargets),
	];
	const findings: FallowHealthFinding[] = findingItems.map((item) => ({
		file: firstString(item, ["path", "file"]) ?? "(unknown)",
		name: firstString(item, ["name", "function", "symbol"]) ?? "(anonymous)",
		...(firstNumber(item, ["line", "start_line"]) ? { line: firstNumber(item, ["line", "start_line"]) } : {}),
		...(firstNumber(item, ["col", "column"]) ? { column: firstNumber(item, ["col", "column"]) } : {}),
		...(firstNumber(item, ["cyclomatic"]) ? { cyclomatic: firstNumber(item, ["cyclomatic"]) } : {}),
		...(firstNumber(item, ["cognitive"]) ? { cognitive: firstNumber(item, ["cognitive"]) } : {}),
		...(firstNumber(item, ["line_count", "lines"]) ? { lineCount: firstNumber(item, ["line_count", "lines"]) } : {}),
		...(firstString(item, ["exceeded"]) ? { exceeded: firstString(item, ["exceeded"]) } : {}),
	}));
	const targets: FallowHealthTarget[] = targetItems.map((item) => ({
		file: firstString(item, ["path", "file"]) ?? "(unknown)",
		...(firstNumber(item, ["priority"]) ? { priority: firstNumber(item, ["priority"]) } : {}),
		...(firstNumber(item, ["efficiency"]) ? { efficiency: firstNumber(item, ["efficiency"]) } : {}),
		...(firstString(item, ["category"]) ? { category: firstString(item, ["category"]) } : {}),
		...(firstString(item, ["effort"]) ? { effort: firstString(item, ["effort"]) } : {}),
		...(firstString(item, ["confidence"]) ? { confidence: firstString(item, ["confidence"]) } : {}),
		...(firstString(item, ["recommendation"]) ? { recommendation: firstString(item, ["recommendation"]) } : {}),
	}));
	const result: FallowHealthResult = {
		success,
		findings,
		targets,
		filesAnalyzed: numberValue(summaryObj?.files_analyzed) ?? 0,
		functionsAnalyzed: numberValue(summaryObj?.functions_analyzed) ?? 0,
		functionsAboveThreshold: numberValue(summaryObj?.functions_above_threshold) ?? findings.length,
		...(numberValue(summaryObj?.average_maintainability) !== undefined
			? { averageMaintainability: numberValue(summaryObj?.average_maintainability) }
			: {}),
		summary: "",
		raw: data,
	};
	result.summary = !result.success
		? fallbackSummary
		: findings.length === 0 && targets.length === 0
			? "No Fallow health findings"
			: `${findings.length} complexity finding(s), ${targets.length} refactor target(s)`;
	return result;
}

function issueKey(issue: FallowIssue): string {
	return [issue.type, issue.file ?? "", issue.name, issue.line ?? 0, issue.column ?? 0].join(":");
}

function normalizedPathKey(root: string, filePath: string): string {
	const resolved = nodePath.isAbsolute(filePath)
		? nodePath.resolve(filePath)
		: nodePath.resolve(root, filePath);
	return resolved.replace(/\\/g, "/");
}

export function isFallowSourceFile(filePath: string): boolean {
	return SOURCE_EXTENSIONS.has(nodePath.extname(filePath).toLowerCase());
}

export function isFallowProjectConfigFile(filePath: string): boolean {
	return ROOT_MARKERS.includes(nodePath.basename(filePath));
}

export class FallowClient {
	private available: boolean | null = null;
	private commandPath: string | null = null;
	private ensureInFlight: Promise<boolean> | null = null;
	private inFlight = new Map<string, Promise<unknown>>();
	private log: (msg: string) => void;

	constructor(verbose = false) {
		this.log = verbose ? (msg: string) => console.error(`[fallow] ${msg}`) : () => {};
	}

	resolveProjectRoot(startDir: string): string | null {
		let current = nodePath.resolve(startDir);
		try {
			if (nodeFs.existsSync(current) && nodeFs.statSync(current).isFile()) {
				current = nodePath.dirname(current);
			}
		} catch {
			return null;
		}

		for (let depth = 0; depth < 64; depth++) {
			if (ROOT_MARKERS.some((marker) => nodeFs.existsSync(nodePath.join(current, marker)))) {
				return current;
			}
			const parent = nodePath.dirname(current);
			if (parent === current) return null;
			current = parent;
		}
		return null;
	}

	hasSupportedSource(rootDir: string): boolean {
		const stack = [rootDir];
		let visited = 0;
		while (stack.length > 0 && visited < 6000) {
			const dir = stack.pop();
			if (!dir) continue;
			let entries: nodeFs.Dirent[];
			try {
				entries = nodeFs.readdirSync(dir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const entry of entries) {
				visited += 1;
				if (entry.isSymbolicLink()) continue;
				if (entry.isDirectory()) {
					if (!SKIP_DIRS.has(entry.name)) stack.push(nodePath.join(dir, entry.name));
					continue;
				}
				if (entry.isFile() && isFallowSourceFile(entry.name)) return true;
			}
		}
		return false;
	}

	async getStatus(): Promise<{
		available: boolean;
		command?: string;
		version?: string;
		source: "path" | "managed" | "missing";
	}> {
		const pathResult = await safeSpawnAsync("fallow", ["--version"], { timeout: 5000 });
		if (!pathResult.error && pathResult.status === 0) {
			return {
				available: true,
				command: "fallow",
				version: (pathResult.stdout || pathResult.stderr).trim().split(/\r?\n/)[0],
				source: "path",
			};
		}

		const { getToolPath } = await import("./installer/index.js");
		const managedPath = await getToolPath("fallow");
		if (managedPath) {
			const version = await safeSpawnAsync(managedPath, ["--version"], { timeout: 5000 });
			return {
				available: true,
				command: managedPath,
				version: (version.stdout || version.stderr).trim().split(/\r?\n/)[0],
				source: "managed",
			};
		}

		return { available: false, source: "missing" };
	}

	async ensureAvailable(): Promise<boolean> {
		if (this.available === true) return true;
		if (this.ensureInFlight) return this.ensureInFlight;
		this.ensureInFlight = this.doEnsureAvailable();
		try {
			return await this.ensureInFlight;
		} finally {
			this.ensureInFlight = null;
		}
	}

	private async doEnsureAvailable(): Promise<boolean> {
		const status = await this.getStatus();
		if (status.available && status.command) {
			this.available = true;
			this.commandPath = status.command;
			this.log(`Fallow found via ${status.source}: ${status.command}`);
			return true;
		}

		this.log("Fallow not found, attempting auto-install...");
		const { ensureTool } = await import("./installer/index.js");
		const installedPath = await ensureTool("fallow");
		if (installedPath) {
			this.available = true;
			this.commandPath = installedPath;
			return true;
		}

		return false;
	}

	async analyzeProject(cwd?: string): Promise<FallowProjectResult> {
		const root = this.resolveProjectRoot(cwd || process.cwd());
		if (!root) {
			const summary = "No JS/TS project root found; Fallow skipped";
			return {
				deadCode: { ...EMPTY_DEAD_CODE, success: true, summary },
				duplication: { ...EMPTY_DUPES, success: true, summary },
				health: { ...EMPTY_HEALTH, success: true, summary },
			};
		}
		const key = `project:${root}`;
		return this.dedupe(key, async () => ({
			deadCode: await this.deadCode(root),
			duplication: await this.dupes(root),
			health: await this.health(root),
		})) as Promise<FallowProjectResult>;
	}

	async deadCode(cwd?: string, options: { files?: string[] } = {}): Promise<FallowDeadCodeResult> {
		const root = this.resolveProjectRoot(cwd || process.cwd());
		if (!root) {
			return {
				...EMPTY_DEAD_CODE,
				success: true,
				summary: "No JS/TS project root found; Fallow dead-code skipped",
			};
		}
		if (!this.hasSupportedSource(root)) {
			return {
				...EMPTY_DEAD_CODE,
				success: true,
				summary: "No supported JS/TS source files found; Fallow dead-code skipped",
			};
		}
		const requestedFiles =
			options.files && options.files.length > 0 ? options.files : undefined;
		const relFiles = [
			...new Set(
				(requestedFiles ?? [])
					.filter((file) => isFallowSourceFile(file))
					.map((file) => relativeDisplay(root, file)),
			),
		];
		if (requestedFiles && relFiles.length === 0) {
			return {
				...EMPTY_DEAD_CODE,
				success: true,
				summary: "No supported JS/TS source files in scoped Fallow dead-code request",
			};
		}
		const key = `dead-code:${root}:${relFiles.slice().sort().join("|")}`;
		return this.dedupe(key, async () => {
			const args = ["dead-code", "--format", "json", "--quiet", "--summary"];
			for (const file of relFiles) args.push("--file", file);
			const run = await this.runFallow("dead-code", args, root, ANALYSIS_TIMEOUT_MS);
			return parseDeadCode(run.data, run.summary, run.ok);
		}) as Promise<FallowDeadCodeResult>;
	}

	async dupes(cwd?: string): Promise<FallowDupesResult> {
		const root = this.resolveProjectRoot(cwd || process.cwd());
		if (!root) {
			return { ...EMPTY_DUPES, success: true, summary: "No JS/TS project root found; Fallow dupes skipped" };
		}
		if (!this.hasSupportedSource(root)) {
			return { ...EMPTY_DUPES, success: true, summary: "No supported JS/TS source files found; Fallow dupes skipped" };
		}
		return this.dedupe(`dupes:${root}`, async () => {
			const run = await this.runFallow(
				"dupes",
				["dupes", "--format", "json", "--quiet", "--summary", "--top", "20"],
				root,
				ANALYSIS_TIMEOUT_MS,
			);
			return parseDupes(run.data, run.summary, run.ok);
		}) as Promise<FallowDupesResult>;
	}

	async health(cwd?: string): Promise<FallowHealthResult> {
		const root = this.resolveProjectRoot(cwd || process.cwd());
		if (!root) {
			return { ...EMPTY_HEALTH, success: true, summary: "No JS/TS project root found; Fallow health skipped" };
		}
		if (!this.hasSupportedSource(root)) {
			return { ...EMPTY_HEALTH, success: true, summary: "No supported JS/TS source files found; Fallow health skipped" };
		}
		return this.dedupe(`health:${root}`, async () => {
			const run = await this.runFallow(
				"health",
				["health", "--format", "json", "--quiet", "--top", "20", "--targets"],
				root,
				ANALYSIS_TIMEOUT_MS,
			);
			return parseHealth(run.data, run.summary, run.ok);
		}) as Promise<FallowHealthResult>;
	}

	async audit(cwd?: string, options: { base?: string; gate?: "new-only" | "all" } = {}): Promise<FallowAuditResult> {
		const root = this.resolveProjectRoot(cwd || process.cwd());
		if (!root) {
			const deadCode = { ...EMPTY_DEAD_CODE, success: true, summary: "No JS/TS project root found; Fallow audit skipped" };
			return {
				success: true,
				changedFilesCount: 0,
				deadCode,
				duplication: { ...EMPTY_DUPES, success: true, summary: deadCode.summary },
				health: { ...EMPTY_HEALTH, success: true, summary: deadCode.summary },
				summary: deadCode.summary,
			};
		}
		const args = ["audit", "--format", "json", "--quiet"];
		if (options.base) args.push("--base", options.base);
		if (options.gate) args.push("--gate", options.gate);
		const run = await this.runFallow("audit", args, root, AUDIT_TIMEOUT_MS, [0, 1]);
		const data = isObject(run.data) ? run.data : {};
		const deadCode = parseDeadCode(
			firstObjectValue(data, ["dead_code", "deadCode", "deadcode"]),
			run.summary,
			run.ok,
		);
		const duplication = parseDupes(
			firstObjectValue(data, ["duplication", "dupes", "duplicates"]),
			run.summary,
			run.ok,
		);
		const health = parseHealth(
			firstObjectValue(data, ["complexity", "health"]),
			run.summary,
			run.ok,
		);
		const verdict = stringValue(data.verdict);
		const baseRef = firstString(data, ["base_ref", "baseRef", "base"]);
		const summary = run.ok
			? `Fallow audit ${verdict ?? "completed"}: dead code ${deadCode.totalIssues}, complexity ${health.findings.length}, duplication ${duplication.clones.length}`
			: run.summary;
		return {
			success: run.ok,
			...(verdict === "pass" || verdict === "warn" || verdict === "fail" ? { verdict } : {}),
			...(baseRef ? { baseRef } : {}),
			changedFilesCount: firstNumber(data, ["changed_files_count", "changedFilesCount"]) ?? 0,
			deadCode,
			duplication,
			health,
			summary,
			raw: run.data,
		};
	}

	formatDeadCode(result: FallowDeadCodeResult, cwd = process.cwd(), maxItems = 12): string {
		if (!result.success) return `[Fallow] ${result.summary}`;
		if (result.issues.length === 0) return "";
		let output = `[Fallow dead-code] ${result.summary}:\n`;
		for (const issue of result.issues.slice(0, maxItems)) {
			const file = relativeDisplay(cwd, issue.file);
			const loc = file ? ` (${file}${lineSuffix(issue)})` : "";
			output += `  - ${issue.type}: ${issue.name}${loc}\n`;
		}
		if (result.issues.length > maxItems) {
			output += `  ... and ${result.issues.length - maxItems} more\n`;
		}
		return output;
	}

	formatDupes(result: FallowDupesResult, cwd = process.cwd(), maxGroups = 8): string {
		if (!result.success) return `[Fallow dupes] ${result.summary}`;
		if (result.clones.length === 0) return "";
		let output = `[Fallow dupes] ${result.summary}:\n`;
		for (const clone of result.clones.slice(0, maxGroups)) {
			const locations = clone.instances
				.slice(0, 3)
				.map((instance) => {
					const file = relativeDisplay(cwd, instance.file);
					const start = instance.startLine ? `:${instance.startLine}` : "";
					const end = instance.endLine ? `-${instance.endLine}` : "";
					return `${file}${start}${end}`;
				})
				.join(" ↔ ");
			output += `  - ${clone.lines} lines across ${clone.instances.length} instance(s): ${locations}\n`;
		}
		if (result.clones.length > maxGroups) {
			output += `  ... and ${result.clones.length - maxGroups} more clone group(s)\n`;
		}
		return output;
	}

	formatHealth(result: FallowHealthResult, cwd = process.cwd(), maxItems = 10): string {
		if (!result.success) return `[Fallow health] ${result.summary}`;
		if (result.findings.length === 0 && result.targets.length === 0) return "";
		let output = `[Fallow health] ${result.summary}:\n`;
		for (const finding of result.findings.slice(0, maxItems)) {
			const file = relativeDisplay(cwd, finding.file);
			const loc = `${file}${finding.line ? `:${finding.line}` : ""}`;
			const metrics = [
				finding.cyclomatic !== undefined ? `${finding.cyclomatic} cyclomatic` : "",
				finding.cognitive !== undefined ? `${finding.cognitive} cognitive` : "",
			]
				.filter(Boolean)
				.join(", ");
			output += `  - ${loc} ${finding.name}${metrics ? ` (${metrics})` : ""}\n`;
		}
		for (const target of result.targets.slice(0, Math.max(0, maxItems - result.findings.length))) {
			const file = relativeDisplay(cwd, target.file);
			output += `  - target ${file}: ${target.recommendation ?? target.category ?? "refactor target"}\n`;
		}
		return output;
	}

	formatAudit(result: FallowAuditResult, cwd = process.cwd()): string {
		if (!result.success) return `[Fallow audit] ${result.summary}`;
		const lines = [
			`[Fallow audit] ${result.verdict ?? "completed"}${result.baseRef ? ` vs ${result.baseRef}` : ""} (${result.changedFilesCount} changed file(s))`,
			`  dead code: ${result.deadCode.totalIssues}`,
			`  complexity: ${result.health.findings.length}`,
			`  duplication: ${result.duplication.clones.length}`,
		];
		const detail = [
			this.formatDeadCode(result.deadCode, cwd, 5),
			this.formatHealth(result.health, cwd, 5),
			this.formatDupes(result.duplication, cwd, 5),
		]
			.filter(Boolean)
			.join("\n");
		return capText(`${lines.join("\n")}\n${detail}`.trim());
	}

	formatProjectResult(result: FallowProjectResult, cwd = process.cwd()): string {
		return capText(
			[
				this.formatDeadCode(result.deadCode, cwd),
				this.formatDupes(result.duplication, cwd),
				this.formatHealth(result.health, cwd),
			]
				.filter(Boolean)
				.join("\n"),
		);
	}

	newIssues(current: FallowDeadCodeResult, previous: FallowDeadCodeResult | undefined): FallowIssue[] {
		if (!current.success) return [];
		const previousKeys = new Set((previous?.issues ?? []).map(issueKey));
		return current.issues.filter((issue) => !previousKeys.has(issueKey(issue)));
	}

	mergeDeadCodeBaseline(
		previous: FallowDeadCodeResult | undefined,
		current: FallowDeadCodeResult,
		options: { root: string; files: string[] } | undefined = undefined,
	): FallowDeadCodeResult {
		if (!current.success) return previous ?? current;
		if (!previous || !options || options.files.length === 0) return current;

		const scannedFiles = new Set(
			options.files.map((file) => normalizedPathKey(options.root, file)),
		);
		const mergedIssues = previous.issues.filter((issue) => {
			if (!issue.file) return true;
			return !scannedFiles.has(normalizedPathKey(options.root, issue.file));
		});
		const seen = new Set(mergedIssues.map(issueKey));
		for (const issue of current.issues) {
			const key = issueKey(issue);
			if (!seen.has(key)) {
				seen.add(key);
				mergedIssues.push(issue);
			}
		}
		const merged: FallowDeadCodeResult = {
			...current,
			issues: mergedIssues,
			unusedExports: mergedIssues.filter((issue) => issue.type === "unused-export"),
			unusedFiles: mergedIssues.filter((issue) => issue.type === "unused-file"),
			unusedDeps: mergedIssues.filter((issue) => issue.type.includes("unused") && issue.type.includes("dependency")),
			unlistedDeps: mergedIssues.filter((issue) => issue.type === "unlisted-dependency"),
			unresolvedImports: mergedIssues.filter((issue) => issue.type === "unresolved-import"),
			circularDependencies: mergedIssues.filter((issue) => issue.type === "circular-dependency"),
			boundaryViolations: mergedIssues.filter((issue) => issue.type === "boundary-violation"),
			totalIssues: mergedIssues.length,
			raw: current.raw ?? previous.raw,
		};
		merged.summary = summarizeDeadCode(merged);
		return merged;
	}

	private async dedupe<T>(key: string, task: () => Promise<T>): Promise<T> {
		const existing = this.inFlight.get(key) as Promise<T> | undefined;
		if (existing) return existing;
		const promise = task().finally(() => this.inFlight.delete(key));
		this.inFlight.set(key, promise);
		return promise;
	}

	private async runFallow(
		command: FallowCommand,
		args: string[],
		cwd: string,
		timeout: number,
		okStatuses = [0],
	): Promise<{ ok: boolean; data?: unknown; summary: string }> {
		if (!(await this.ensureAvailable())) {
			return {
				ok: false,
				summary: "Fallow not available. Install with: npm install -g fallow",
			};
		}
		const cmd = this.commandPath ?? "fallow";
		const result = await safeSpawnAsync(cmd, args, { cwd, timeout });
		const data = parseJsonOutput(result.stdout);
		const parsedError = isObject(data) && data.error === true;
		const ok = !result.error && !parsedError && result.status !== null && okStatuses.includes(result.status);
		let summary = "";
		if (result.error) summary = result.error.message;
		else if (parsedError) summary = stringValue((data as JsonObject).message) ?? `fallow ${command} failed`;
		else if (!ok) summary = (result.stderr || result.stdout || `fallow ${command} exited ${result.status}`).trim();
		else summary = `fallow ${command} completed`;
		return { ok, data, summary: capText(summary, 1200) };
	}
}
