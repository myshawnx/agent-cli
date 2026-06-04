import { describe, expect, it } from "vitest";
import {
	bashTouchesProtectedPath,
	outsideRepoRoot,
	pathConfirmWrite,
	pathDenied,
	targetPath,
} from "../../src/policy/path-guard.ts";

const pathCfg = {
	deny: [".env", ".git/**", "**/*.pem", "~/.ssh/**", "**/credentials*"] as string[],
	confirmWrite: ["package.json", "**/*lock*", ".github/**"] as string[],
};

describe("path guard", () => {
	describe("pathDenied", () => {
		it("matches exact file", () => expect(pathDenied(".env", pathCfg)).toBe(true));
		it("matches glob in subdir", () => expect(pathDenied("subdir/.env", pathCfg)).toBe(true));
		it("matches glob **", () => expect(pathDenied("deeply/nested/file.pem", pathCfg)).toBe(true));
		it("matches .git contents", () => expect(pathDenied(".git/config", pathCfg)).toBe(true));
		it("does not match unrelated paths", () => expect(pathDenied("src/index.ts", pathCfg)).toBe(false));
	});

	describe("pathConfirmWrite", () => {
		it("matches package.json", () => expect(pathConfirmWrite("package.json", pathCfg)).toBe(true));
		it("matches lock files", () => expect(pathConfirmWrite("pnpm-lock.yaml", pathCfg)).toBe(true));
		it("matches .github workflows", () => expect(pathConfirmWrite(".github/workflows/ci.yml", pathCfg)).toBe(true));
		it("does not match source files", () => expect(pathConfirmWrite("src/main.ts", pathCfg)).toBe(false));
	});

	describe("outsideRepoRoot", () => {
		const root = "/home/user/project";
		it("allows a child path", () => expect(outsideRepoRoot("src/file.ts", root)).toBe(false));
		it("detects ../ escape", () => expect(outsideRepoRoot("../etc/passwd", root)).toBe(true));
		it("detects tilde home", () => expect(outsideRepoRoot("~/.ssh/id_rsa", root)).toBe(true));
		it("handles empty string", () => expect(outsideRepoRoot("", root)).toBe(false));
	});

	describe("targetPath", () => {
		it("extracts path from write/read-like input", () => {
			expect(targetPath({ path: "src/index.ts" })).toBe("src/index.ts");
		});
		it("falls back to file field", () => {
			expect(targetPath({ file: "config.json" })).toBe("config.json");
		});
		it("returns undefined for empty input", () => {
			expect(targetPath({})).toBeUndefined();
			expect(targetPath(undefined)).toBeUndefined();
			expect(targetPath(null)).toBeUndefined();
		});
	});

	describe("bashTouchesProtectedPath", () => {
		it("detects > redirect to .env", () => expect(bashTouchesProtectedPath("echo x > .env", pathCfg)).toBe(true));
		it("detects >> append to .env", () => expect(bashTouchesProtectedPath("echo x >> .env", pathCfg)).toBe(true));
		it("detects tee to protected path", () =>
			expect(bashTouchesProtectedPath("cat secret | tee .env", pathCfg)).toBe(true));
		it("detects cp to .git", () => expect(bashTouchesProtectedPath("cp secret .git/config", pathCfg)).toBe(true));
		it("detects cat of ssh key", () => expect(bashTouchesProtectedPath("cat ~/.ssh/id_rsa", pathCfg)).toBe(true));
		it("detects grep on credentials", () =>
			expect(bashTouchesProtectedPath("grep password credentials.txt", pathCfg)).toBe(true));
		it("does not flag safe commands", () => expect(bashTouchesProtectedPath("ls -la", pathCfg)).toBe(false));
		it("does not flag build/test commands", () => expect(bashTouchesProtectedPath("pnpm test", pathCfg)).toBe(false));
	});
});
