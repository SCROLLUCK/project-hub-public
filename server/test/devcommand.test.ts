import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectDevCommand, mainCheckout } from "../src/previews";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-dev-"));
  for (const [f, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), content);
  }
  return dir;
}

describe("detectDevCommand", () => {
  it("uses the config command and substitutes the port", () => {
    const dir = repo({});
    const d = detectDevCommand(dir, { devCommand: "npm run dev -- --port {port}", devCwd: "frontend" }, 5555);
    expect(d).toMatchObject({ command: "npm run dev -- --port 5555", cwd: path.join(dir, "frontend"), needsInstall: false, installSkipped: true });
  });

  it("passes vite flags for a vite dev script in the root", () => {
    const dir = repo({ "package.json": JSON.stringify({ scripts: { dev: "vite" } }), "node_modules/.keep": "" });
    const d = detectDevCommand(dir, undefined, 4000);
    expect(d).toEqual({ command: "npm run dev -- --port 4000 --strictPort --host 127.0.0.1", cwd: dir, needsInstall: false });
  });

  it("falls back to frontend/ and plain npm run dev for non-vite", () => {
    const dir = repo({ "frontend/package.json": JSON.stringify({ scripts: { dev: "next dev" } }) });
    const d = detectDevCommand(dir, undefined, 4000);
    expect(d).toMatchObject({ command: "npm run dev", cwd: path.join(dir, "frontend"), needsInstall: true });
  });

  it("detects vite from devDependencies", () => {
    const dir = repo({ "web/package.json": JSON.stringify({ scripts: { dev: "node dev.js" }, devDependencies: { vite: "^6" } }) });
    expect(detectDevCommand(dir, undefined, 1)?.command).toContain("--strictPort");
  });

  it("returns null without a dev script", () => {
    expect(detectDevCommand(repo({ "package.json": JSON.stringify({ scripts: { build: "x" } }) }), undefined, 1)).toBeNull();
    expect(detectDevCommand(repo({}), undefined, 1)).toBeNull();
  });

  it("substitutes {main}/{worktree}/{cwd} in a linked worktree", () => {
    const main = repo({ ".git/worktrees/x/commondir": "../..", ".git/HEAD": "" });
    const wt = repo({ ".git": `gitdir: ${path.join(main, ".git/worktrees/x")}\n` });
    expect(mainCheckout(wt)).toBe(main);
    const d = detectDevCommand(wt, { devCommand: "run {main} {worktree} {cwd} {port}", devCwd: "app" }, 7);
    expect(d).toMatchObject({ command: `run ${main} ${wt} ${path.join(wt, "app")} 7`, needsInstall: false });
  });

  it("resolves a relative gitdir and falls back to gitdir/../.. without commondir", () => {
    const main = repo({ ".git/worktrees/y/HEAD": "" });
    const wt = path.join(main, ".claude", "wt");
    mkdirSync(wt, { recursive: true });
    writeFileSync(path.join(wt, ".git"), "gitdir: ../../.git/worktrees/y\n");
    expect(mainCheckout(wt)).toBe(main);
  });

  it("main checkout is itself when .git is a directory", () => {
    const dir = repo({ ".git/HEAD": "" });
    expect(mainCheckout(dir)).toBe(dir);
  });

  it("does not install an auto-detected command in a linked worktree", () => {
    const main = repo({ ".git/worktrees/x/commondir": "../.." });
    const wt = repo({ ".git": `gitdir: ${path.join(main, ".git/worktrees/x")}`, "package.json": JSON.stringify({ scripts: { dev: "vite" } }) });
    expect(detectDevCommand(wt, undefined, 1)).toMatchObject({ needsInstall: false, installBlocked: true });
  });

  it("still installs in the main checkout", () => {
    const dir = repo({ ".git/HEAD": "", "package.json": JSON.stringify({ scripts: { dev: "vite" } }) });
    const d = detectDevCommand(dir, undefined, 1);
    expect(d?.needsInstall).toBe(true);
    expect(d?.installBlocked).toBeUndefined();
  });
});
