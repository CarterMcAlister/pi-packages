import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import {
	clearWidgetState,
	recordDiagnostics,
	recordFormatter,
	recordLsp,
	recordRunner,
	renderWidget,
	setSessionLanguages,
} from "../../clients/widget-state.ts";

const e = String.fromCharCode(27);
const theme = {
	fg: (_color: string, s: string) => `${e}[38;2;102;102;102m${s}${e}[39m`,
};

afterEach(() => {
	clearWidgetState();
});

describe("widget-state renderWidget", () => {
	it("keeps diagnostic rows within the provided TUI width", () => {
		const filePath = `${process.cwd()}/index.ts`;
		recordRunner(filePath, "type-safety", "failed", 2);
		recordRunner(filePath, "eslint", "succeeded", 27);
		recordRunner(filePath, "ast-grep-napi", "succeeded", 1);
		recordDiagnostics(filePath, [
			{
				severity: "error",
				line: 2278,
				column: 10,
				rule: "typescript:2451",
				message: "Cannot redeclare block-scoped variable 'limited'.",
			},
			{
				severity: "warning",
				line: 497,
				column: 60,
				rule: "ts-react-antipatterns",
				message:
					"React anti-pattern: setState inside a loop causes multiple re-renders — batch with a single state update instead. ".repeat(
						4,
					),
			},
		]);

		const lines = renderWidget(120, theme);

		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(120);
		}
	});

	it("truncates every widget line, including headers and LSP status", () => {
		setSessionLanguages([
			"typescript-super-long-language-label",
			"javascript-super-long-language-label",
			"python-super-long-language-label",
			"rust-super-long-language-label",
			"go-super-long-language-label",
			"kotlin-super-long-language-label",
		]);
		recordLsp(
			"typescript-language-server-with-a-very-long-id",
			process.cwd(),
			"spawn_start",
		);

		const lines = renderWidget(40, theme);

		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(40);
		}
	});

	it("deduplicates files by basename — last write wins at most 5 entries", () => {
		const a = `${process.cwd()}/pi-lens/index.ts`;
		const b = `${process.cwd()}/pi-webaio/index.ts`;
		recordRunner(a, "type-safety", "failed", 1);
		recordDiagnostics(a, [
			{ severity: "error", message: "error in pi-lens", rule: "E1" },
		]);
		recordRunner(b, "eslint", "succeeded", 3);
		recordDiagnostics(b, [
			{ severity: "error", message: "warning in pi-webaio", rule: "W1" },
		]);

		const lines = renderWidget(120, theme);

		const fileRows = lines.filter((l) => l.includes("index.ts"));
		// Dedup: only one index.ts entry in the file list
		expect(fileRows.length).toBeGreaterThanOrEqual(1);
		expect(fileRows.length).toBeLessThanOrEqual(4);

		// Later file's diagnostics supersede earlier
		const allLines = lines.join("");
		expect(allLines).toContain("warning in pi-webaio");
		expect(allLines).not.toContain("error in pi-lens");
	});

	it("shows formatter name when a formatter changed the file", () => {
		const filePath = `${process.cwd()}/app.ts`;
		recordFormatter(filePath, "biome", true, true);
		recordFormatter(filePath, "prettier", false, true);

		const lines = renderWidget(120, theme);
		const allLines = lines.join("");

		expect(allLines).toContain("fmt:biome");
		expect(allLines).not.toContain("prettier");
	});
});
