import { describe, expect, it } from "vitest";
import {
	formatRulesForPrompt,
	type RuleScanResult,
} from "../../clients/rules-scanner.js";

function makeResult(count: number): RuleScanResult {
	return {
		hasCustomRules: count > 0,
		rules: Array.from({ length: count }, (_, i) => ({
			source: i % 2 === 0 ? ".claude/rules" : ".agents/rules",
			name: `rule-${i}.md`,
			filePath: `/tmp/rule-${i}.md`,
			relativePath: `${i % 2 === 0 ? ".claude/rules" : ".agents/rules"}/rule-${i}.md`,
		})),
	};
}

describe("rules-scanner prompt formatting", () => {
	it("caps listed rules and includes omitted count", () => {
		const result = makeResult(30);
		const text = formatRulesForPrompt(result);

		expect(text).toContain("additional rule file(s) not listed");
		expect((text.match(/^- `.*`/gm) ?? []).length).toBeLessThanOrEqual(12);
	});

	it("caps total prompt size", () => {
		const result = makeResult(50);
		const text = formatRulesForPrompt(result);

		expect(text.length).toBeLessThanOrEqual(920);
	});
});
