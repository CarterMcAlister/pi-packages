import { describe, expect, it } from "vitest";
import { parseImportedOpenAICodexAuth } from "./auth";

describe("parseImportedOpenAICodexAuth", () => {
	it("prefers the email embedded in the access token profile", () => {
		const header = Buffer.from(
			JSON.stringify({ alg: "none", typ: "JWT" }),
		).toString("base64url");
		const payload = Buffer.from(
			JSON.stringify({
				"https://api.openai.com/profile": {
					email: "victor.araujo105@gmail.com",
				},
			}),
		).toString("base64url");
		const accessToken = `${header}.${payload}.sig`;
		const parsed = parseImportedOpenAICodexAuth({
			"openai-codex": {
				type: "oauth",
				access: accessToken,
				refresh: "refresh-token",
				expires: 123,
				accountId: "acct-1234567890",
			},
		});

		expect(parsed).toEqual({
			identifier: "victor.araujo105@gmail.com",
			fingerprint: JSON.stringify({
				access: accessToken,
				refresh: "refresh-token",
				expires: 123,
				accountId: "acct-1234567890",
			}),
			credentials: {
				access: accessToken,
				refresh: "refresh-token",
				expires: 123,
				accountId: "acct-1234567890",
			},
		});
	});

	it("falls back to the account-id label when email cannot be derived", () => {
		const parsed = parseImportedOpenAICodexAuth({
			"openai-codex": {
				type: "oauth",
				access: "access-token",
				refresh: "refresh-token",
				expires: 123,
				accountId: "acct-1234567890",
			},
		});

		expect(parsed).toEqual({
			identifier: "OpenAI Codex acct-123",
			fingerprint: JSON.stringify({
				access: "access-token",
				refresh: "refresh-token",
				expires: 123,
				accountId: "acct-1234567890",
			}),
			credentials: {
				access: "access-token",
				refresh: "refresh-token",
				expires: 123,
				accountId: "acct-1234567890",
			},
		});
	});

	it("returns undefined for missing or invalid oauth data", () => {
		expect(parseImportedOpenAICodexAuth({})).toBeUndefined();
		expect(
			parseImportedOpenAICodexAuth({
				"openai-codex": { type: "oauth", access: "", refresh: "x", expires: 1 },
			}),
		).toBeUndefined();
		expect(
			parseImportedOpenAICodexAuth({
				"openai-codex": {
					type: "api-key",
					access: "x",
					refresh: "y",
					expires: 1,
				},
			}),
		).toBeUndefined();
	});
});
