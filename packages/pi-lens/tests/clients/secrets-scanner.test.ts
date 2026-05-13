import { describe, expect, it } from "vitest";
import { scanForSecrets } from "../../clients/secrets-scanner.js";

describe("secrets-scanner", () => {
	it("flags obvious hardcoded secret assignment", () => {
		const content = 'const api_key = "sk-live-abc123xyz789def456ghi000";';
		const findings = scanForSecrets(content, "src/client.ts");
		expect(findings.length).toBeGreaterThan(0);
	});

	it("does not flag User-Agent header literals", () => {
		const content =
			'const headers = { "User-Agent": "Mozilla/5.0 (compatible; pi-lens/1.0; +https://example.com)" };';
		const findings = scanForSecrets(content, "src/http.ts");
		expect(findings).toEqual([]);
	});

	it("does not flag environment variable name references as false positives", () => {
		// These are common false positives - env var names like FIREWORKS_API_KEY
		// being used as string values (placeholders, references, etc.)
		const content = `
			const cfg = { apiKey: "FIREWORKS_API_KEY" };
			const key = "AWS_ACCESS_KEY_ID";
			const token = "GITHUB_TOKEN";
			const secret = "MY_SERVICE_API_KEY";
		`;
		const findings = scanForSecrets(content, "src/config.ts");
		expect(findings).toEqual([]);
	});

	it("correctly flags real secrets while ignoring env var name patterns", () => {
		const content = `
			// These should be flagged (real secrets)
			const api_key = "sk-live-actual-secret-value";
			const secret = "my-real-password-123";
			
			// These should NOT be flagged (env var name references)
			const cfg = { apiKey: "FIREWORKS_API_KEY" };
			const ref = "AWS_ACCESS_KEY_ID";
		`;
		const findings = scanForSecrets(content, "src/mixed.ts");
		// Should find exactly the 2 real secrets, not the env var references
		expect(findings).toHaveLength(2);
		expect(findings[0].line).toBe(3); // First real secret
		expect(findings[1].line).toBe(4); // Second real secret
	});

	it("does not flag when env var is assigned from process.env", () => {
		const content = "const FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY;";
		const findings = scanForSecrets(content, "src/config.ts");
		expect(findings).toEqual([]);
	});
});
