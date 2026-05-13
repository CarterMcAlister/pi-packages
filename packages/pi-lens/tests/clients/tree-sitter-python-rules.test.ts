import { afterAll, describe, expect, it } from "vitest";
import { TreeSitterClient } from "../../clients/tree-sitter-client.js";
import { TreeSitterQueryLoader } from "../../clients/tree-sitter-query-loader.js";
import { createTempFile, setupTestEnvironment } from "./test-utils.js";

const cleanups: Array<() => void> = [];

function writeTempFile(contents: string): string {
	const env = setupTestEnvironment("pi-lens-python-rules-");
	cleanups.push(env.cleanup);
	return createTempFile(env.tmpDir, "sample.py", contents);
}

async function getQuery(id: string) {
	const loader = new TreeSitterQueryLoader();
	const queries = await loader.loadQueries(process.cwd());
	for (const langQueries of queries.values()) {
		const found = langQueries.find((q) => q.id === id);
		if (found) return found;
	}
	throw new Error(`missing query ${id}`);
}

afterAll(() => {
	for (const cleanup of cleanups) cleanup();
});

describe("python tree-sitter rules", () => {
	describe("return-in-generator", () => {
		it("flags valued return in a synchronous generator", async () => {
			const client = new TreeSitterClient();
			const query = await getQuery("return-in-generator");
			const filePath = writeTempFile(
				`def gen():\n    yield 1\n    return 42\n`,
			);

			const matches = await client.runQueryOnFile(query, filePath, "python");

			expect(matches).toHaveLength(1);
		});

		it("does not flag normal coroutine return values", async () => {
			const client = new TreeSitterClient();
			const query = await getQuery("return-in-generator");
			const filePath = writeTempFile(
				`async def get_details(request):\n    await load(request)\n    return TemplateResponse('page.html', {'request': request})\n`,
			);

			const matches = await client.runQueryOnFile(query, filePath, "python");

			expect(matches).toHaveLength(0);
		});

		it("does not flag non-generator functions", async () => {
			const client = new TreeSitterClient();
			const query = await getQuery("return-in-generator");
			const filePath = writeTempFile(`def compute():\n    return 42\n`);

			const matches = await client.runQueryOnFile(query, filePath, "python");

			expect(matches).toHaveLength(0);
		});
	});
});
