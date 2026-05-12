import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";

const PATCHED = Symbol.for("pi-utils.macKeyDisplayPatched");
const HOTKEY_MARKERS = ["**Navigation**", "**Editing**", "**Other**"];
const MAC_MODIFIER_LABELS = new Map([
	["alt", "Option"],
	["option", "Option"],
	["ctrl", "Control"],
	["control", "Control"],
	["super", "Command"],
	["cmd", "Command"],
	["command", "Command"],
	["shift", "Shift"],
]);

function titleCaseKeyPart(part: string): string {
	if (!part) return part;
	return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
}

export function formatMacKeyDisplay(key: string): string {
	return key
		.split("/")
		.map((alternative) =>
			alternative
				.split("+")
				.map((part) => {
					const trimmed = part.trim();
					return (
						MAC_MODIFIER_LABELS.get(trimmed.toLowerCase()) ??
						titleCaseKeyPart(trimmed)
					);
				})
				.join("+"),
		)
		.join("/");
}

export function rewriteMacKeyDisplays(text: string): string {
	return text.replace(/`([^`]+)`/g, (_match, key: string) => {
		const rewritten = formatMacKeyDisplay(key);
		return `\`${rewritten}\``;
	});
}

function isHotkeysMarkdown(text: string): boolean {
	return HOTKEY_MARKERS.every((marker) => text.includes(marker));
}

function patchHotkeysMarkdown(child: unknown): void {
	if (!child || typeof child !== "object") return;
	const text = Reflect.get(child, "text");
	if (typeof text !== "string" || !isHotkeysMarkdown(text)) return;

	const rewritten = rewriteMacKeyDisplays(text);
	const setText = Reflect.get(child, "setText");
	if (typeof setText === "function") {
		setText.call(child, rewritten);
		return;
	}

	Reflect.set(child, "text", rewritten);
	const invalidate = Reflect.get(child, "invalidate");
	if (typeof invalidate === "function") {
		invalidate.call(child);
	}
}

export function installMacKeyDisplayPatch(): boolean {
	if (process.platform !== "darwin") return false;

	const prototype = InteractiveMode.prototype as unknown as Record<
		PropertyKey,
		unknown
	>;
	if (prototype[PATCHED]) return false;

	const original = prototype.handleHotkeysCommand;
	if (typeof original !== "function") return false;

	prototype.handleHotkeysCommand = function handleHotkeysCommandWithMacKeys(
		this: unknown,
		...args: unknown[]
	) {
		const chatContainer = Reflect.get(this as object, "chatContainer");
		const children =
			chatContainer && typeof chatContainer === "object"
				? Reflect.get(chatContainer, "children")
				: undefined;
		const startIndex = Array.isArray(children) ? children.length : 0;

		const result = original.apply(this, args);

		if (Array.isArray(children)) {
			for (const child of children.slice(startIndex)) {
				patchHotkeysMarkdown(child);
			}
		}

		return result;
	};
	prototype[PATCHED] = true;
	return true;
}

export default function macKeyDisplayExtension(_pi: ExtensionAPI): void {
	installMacKeyDisplayPatch();
}
