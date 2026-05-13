import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function setupTestEnvironment(prefix = "pi-lens-test-"): {
	tmpDir: string;
	cleanup: () => void;
} {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	return {
		tmpDir,
		cleanup: () => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		},
	};
}

export function createTempFile(
	baseDir: string,
	relativePath: string,
	content: string,
): string {
	const filePath = path.join(baseDir, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
	return filePath;
}
