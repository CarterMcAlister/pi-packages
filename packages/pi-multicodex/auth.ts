import { promises as fs } from "node:fs";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import { getAgentAuthPath } from "pi-provider-utils/agent-paths";

const AUTH_FILE = getAgentAuthPath();
const IMPORTED_ACCOUNT_PREFIX = "OpenAI Codex";

interface AuthEntry {
	type?: string;
	access?: string | null;
	refresh?: string | null;
	expires?: number | null;
	accountId?: string | null;
	account_id?: string | null;
}

export interface ImportedOpenAICodexAuth {
	identifier: string;
	fingerprint: string;
	credentials: OAuthCredentials;
}

function asAuthEntry(value: unknown): AuthEntry | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return value as AuthEntry;
}

function getAccountId(entry: AuthEntry): string | undefined {
	const accountId = entry.accountId ?? entry.account_id;
	return typeof accountId === "string" && accountId.trim()
		? accountId.trim()
		: undefined;
}

function getRequiredString(
	value: string | null | undefined,
): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	if (parts.length !== 3) return undefined;
	const payload = parts[1];
	if (!payload) return undefined;
	try {
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(
			normalized.length + ((4 - (normalized.length % 4)) % 4),
			"=",
		);
		const decoded = Buffer.from(padded, "base64").toString("utf8");
		const parsed = JSON.parse(decoded) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return undefined;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function getProfileEmail(accessToken: string): string | undefined {
	const payload = decodeJwtPayload(accessToken);
	const profile = payload?.["https://api.openai.com/profile"];
	if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
		return undefined;
	}
	const email = (profile as Record<string, unknown>).email;
	return typeof email === "string" && email.trim() ? email.trim() : undefined;
}

function createImportedIdentifier(
	accessToken: string,
	accountId: string,
): string {
	const email = getProfileEmail(accessToken);
	if (email) return email;
	return `${IMPORTED_ACCOUNT_PREFIX} ${accountId.slice(0, 8)}`;
}

function createFingerprint(entry: {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
}): string {
	return JSON.stringify({
		access: entry.access,
		refresh: entry.refresh,
		expires: entry.expires,
		accountId: entry.accountId ?? null,
	});
}

export function parseImportedOpenAICodexAuth(
	auth: Record<string, unknown>,
): ImportedOpenAICodexAuth | undefined {
	const entry = asAuthEntry(auth["openai-codex"]);
	if (entry?.type !== "oauth") return undefined;

	const access = getRequiredString(entry.access);
	const refresh = getRequiredString(entry.refresh);
	const accountId = getAccountId(entry);
	const expires = entry.expires;
	if (!access || !refresh || typeof expires !== "number") {
		return undefined;
	}

	const credentials: OAuthCredentials = {
		access,
		refresh,
		expires,
		accountId,
	};
	return {
		identifier: createImportedIdentifier(access, accountId ?? "default"),
		fingerprint: createFingerprint({ access, refresh, expires, accountId }),
		credentials,
	};
}

export async function loadImportedOpenAICodexAuth(): Promise<
	ImportedOpenAICodexAuth | undefined
> {
	try {
		const raw = await fs.readFile(AUTH_FILE, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return undefined;
		}
		return parseImportedOpenAICodexAuth(parsed as Record<string, unknown>);
	} catch {
		// File missing, corrupt, or unreadable — treat as no imported auth.
		return undefined;
	}
}
