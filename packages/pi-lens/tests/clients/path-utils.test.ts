import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	isExternalOrVendorFile,
	pathToUri,
	uriToPath,
} from "../../clients/path-utils.js";
import { setupTestEnvironment } from "./test-utils.js";

describe("path-utils", () => {
	it("uriToPath decodes URL-encoded file URIs", () => {
		const uri = "file:///C:/Users/Test%20User/project/file.ts";
		const resolved = uriToPath(uri);

		expect(resolved.includes("%20")).toBe(false);
		expect(resolved.toLowerCase()).toContain("test user");
	});

	it("pathToUri + uriToPath round-trips an existing file", () => {
		const { tmpDir, cleanup } = setupTestEnvironment("pi-lens-path-");
		try {
			const filePath = path.join(tmpDir, "src", "main.ts");
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, "export const x = 1;\n");

			const uri = pathToUri(filePath);
			const back = uriToPath(uri);

			expect(back.endsWith("/src/main.ts")).toBe(true);
		} finally {
			cleanup();
		}
	});
});

describe("isExternalOrVendorFile", () => {
	const root = "/home/user/project";

	it("returns false for a normal source file", () => {
		expect(isExternalOrVendorFile(`${root}/src/main.ts`, root)).toBe(false);
	});

	it("returns true for a file outside the project root", () => {
		expect(isExternalOrVendorFile("/home/user/other-project/foo.ts", root)).toBe(true);
	});

	it("returns true for node_modules", () => {
		expect(isExternalOrVendorFile(`${root}/node_modules/lodash/index.js`, root)).toBe(true);
	});

	it("returns true for vendor/", () => {
		expect(isExternalOrVendorFile(`${root}/vendor/dep/file.go`, root)).toBe(true);
	});

	it("returns true for vendors/", () => {
		expect(isExternalOrVendorFile(`${root}/vendors/lib.py`, root)).toBe(true);
	});

	it("returns true for third_party/", () => {
		expect(isExternalOrVendorFile(`${root}/third_party/sherpa/api.h`, root)).toBe(true);
	});

	it("returns true for third-party/", () => {
		expect(isExternalOrVendorFile(`${root}/third-party/lib/src.cpp`, root)).toBe(true);
	});

	it("returns false for a dir that merely contains 'vendor' as a substring", () => {
		expect(isExternalOrVendorFile(`${root}/src/vendor_utils/helper.ts`, root)).toBe(false);
	});
});
