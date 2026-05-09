import { describe, expect, test } from "bun:test";

import contextExtension from "../src/context.ts";
import filesExtension from "../src/files.ts";
import loopExtension from "../src/loop.ts";
import notifyExtension from "../src/notify.ts";
import reviewLoopExtension from "../src/pi-review-loop/index.ts";
import whimsicalExtension from "../src/whimsical.ts";

describe("pi-utils extension entry points", () => {
	test("each extension exposes a default function", () => {
		const extensions = {
			context: contextExtension,
			files: filesExtension,
			loop: loopExtension,
			notify: notifyExtension,
			whimsical: whimsicalExtension,
			"pi-review-loop": reviewLoopExtension,
		};

		for (const [name, ext] of Object.entries(extensions)) {
			expect(typeof ext, `${name} default export`).toBe("function");
		}
	});
});
