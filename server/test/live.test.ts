import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCodexText, parseWindow, parseClaude, parseClaudeLive, readClaudeLive, newLiveCache } from "../src/quota";
import { isEmbeddable, probePreview, matchProject, parseDocker, parseSs } from "../src/running";
import { cleanTitle, dirBelongsTo, encodeCwd, extractModel, extractTitle } from "../src/sessions";
import { findVaultRoot, readNote, resolveWikilink, safeNotePath } from "../src/vault";

describe("session dir encoding", () => {
  it("replaces slashes and dots", () => {
    expect(encodeCwd("/home/user/code/group/my-app")).toBe("-home-user-code-group-my-app");
    expect(encodeCwd("/home/user/code/my-app/.claude/worktrees/x")).toBe("-home-user-code-my-app--claude-worktrees-x");
  });
  it("matches worktree dirs but not siblings", () => {
    const p = "/home/user/code/group/my-app";
    expect(dirBelongsTo("-home-user-code-group-my-app--claude-worktrees-a", p)).toBe(true);
    expect(dirBelongsTo("-home-user-code-group-my-app", p)).toBe(true);
    expect(dirBelongsTo("-home-user-code-group-my-app2", p)).toBe(false);
  });
  it("extracts title skipping wrappers and model from tail", () => {
    const head = [
      JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "<system-reminder>x</system-reminder>" }] } }),
      JSON.stringify({ type: "user", message: { content: "  fix   the\nbug " } }),
    ].join("\n");
    expect(extractTitle(head)).toBe("fix the bug");
    expect(extractTitle(JSON.stringify({ type: "user", message: { content: "a".repeat(300) } })).length).toBe(120);
    const tail = ['{"partial', JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5" } })].join("\n");
    expect(extractModel(tail)).toBe("claude-opus-5-5");
  });
});

describe("cwd to project matching", () => {
  const projects = [
    { id: "a", path: "/r/a" },
    { id: "ab", path: "/r/a/b" },
  ];
  it("picks the longest prefix", () => {
    expect(matchProject("/r/a/b/web", projects)?.projectId).toBe("ab");
    expect(matchProject("/r/a/web", projects)?.projectId).toBe("a");
  });
  it("does not match a sibling that shares a prefix", () => {
    expect(matchProject("/r/ax", projects)).toBeNull();
  });
  it("resolves worktree path", () => {
    expect(matchProject("/r/a/.claude/worktrees/feat/web", projects)).toEqual({ projectId: "a", worktreePath: "/r/a/.claude/worktrees/feat" });
  });
  it("parses ss and docker output", () => {
    const ss = [
      'LISTEN 0 511 127.0.0.1:4310 0.0.0.0:* users:(("node",pid=12,fd=19))',
      'LISTEN 0 511 [::]:5173 [::]:* users:(("node",pid=13,fd=20))',
      "LISTEN 0 4096 127.0.0.54:53 0.0.0.0:*",
      'LISTEN 0 4096 192.168.1.5:80 0.0.0.0:* users:(("x",pid=1,fd=1))',
    ].join("\n");
    expect(parseSs(ss)).toEqual([
      { port: 4310, pid: 12, name: "node" },
      { port: 5173, pid: 13, name: "node" },
    ]);
    const d = JSON.stringify({ Names: "web", Ports: "0.0.0.0:8080->80/tcp, :::8080->80/tcp, 5432/tcp", Labels: "a=b,com.docker.compose.project.working_dir=/r/a,c=d" });
    expect(parseDocker(d)).toEqual([{ name: "web", service: null, workingDir: "/r/a", ports: [8080] }]);
  });
});

describe("quota parsing", () => {
  const now = 1_000_000;
  it("reads a live window", () => {
    expect(parseWindow(12.34, now + 100, now)).toMatchObject({ pct: 12.3, reset: false });
  });
  it("counts an expired window as 0% reset", () => {
    expect(parseWindow(88, now - 1, now)).toMatchObject({ pct: 0, reset: true });
  });
  it("rejects non-numeric usage", () => {
    expect(parseWindow(undefined, now, now)).toBeNull();
  });
  it("parses claude latest.json", () => {
    const q = parseClaude({ updated_at: now, rate_limits: { five_hour: { used_percentage: 10, resets_at: now + 5 }, seven_day: { used_percentage: 50, resets_at: now - 5 } } }, now);
    expect(q.fiveHour?.pct).toBe(10);
    expect(q.sevenDay).toMatchObject({ pct: 0, reset: true });
  });
  it("finds the codex limit nested in a line, newest first", () => {
    const old = JSON.stringify({ payload: { rate_limits: { limit_id: "codex", primary: { used_percent: 1, resets_at: now + 1 } } } });
    const cur = JSON.stringify({ payload: { info: { rate_limits: { limit_id: "codex", plan_type: "plus", primary: { used_percent: 30, resets_at: now + 9 }, secondary: { used_percent: 60, resets_at: now - 9 } } } } });
    const q = parseCodexText([old, '{"x":1}', cur, ""].join("\n"), 5000, now);
    expect(q?.fiveHour?.pct).toBe(30);
    expect(q?.sevenDay).toMatchObject({ pct: 0, reset: true });
    expect(q?.plan).toBe("plus");
  });
});

describe("claude live usage", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const body = { five_hour: { utilization: 41.2, resets_at: "2026-01-01T02:00:00Z" }, seven_day: null };
  it("maps the API response", () => {
    const q = parseClaudeLive(body, now);
    expect(q).toMatchObject({ source: "live", sevenDay: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(q?.fiveHour).toMatchObject({ pct: 41.2, resetsAt: "2026-01-01T02:00:00.000Z", reset: false });
    expect(parseClaudeLive({}, now)).toBeNull();
  });
  it("caches for 5 min, shares in-flight, falls back to null on failure", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "hub-quota-"));
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(path.join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "t0k" } }));
    let calls = 0;
    const fetcher = async (token: string) => {
      calls++;
      expect(token).toBe("t0k");
      return body;
    };
    const cache = newLiveCache();
    const [a, b] = await Promise.all([readClaudeLive(home, now, fetcher, cache), readClaudeLive(home, now, fetcher, cache)]);
    expect(a?.fiveHour?.pct).toBe(41.2);
    expect(b).toBe(a);
    await readClaudeLive(home, now + 299_000, fetcher, cache);
    expect(calls).toBe(1);
    await readClaudeLive(home, now + 301_000, fetcher, cache);
    expect(calls).toBe(2);
    const bad = await readClaudeLive(home, now, async () => { throw new Error("x"); }, newLiveCache());
    expect(bad).toBeNull();
    expect(await readClaudeLive(path.join(home, "nope"), now, fetcher, newLiveCache())).toBeNull();
  });
});

describe("vault", () => {
  const root = "/v";
  it("rejects traversal, absolute, non-md and dot paths", () => {
    expect(safeNotePath(root, "../etc/passwd.md")).toBeNull();
    expect(safeNotePath(root, "a/../../x.md")).toBeNull();
    expect(safeNotePath(root, "/etc/x.md")).toBeNull();
    expect(safeNotePath(root, "a.txt")).toBeNull();
    expect(safeNotePath(root, ".obsidian/x.md")).toBeNull();
    expect(safeNotePath(root, "a/b.md")).toBe("/v/a/b.md");
  });
  it("resolves wikilinks by basename and alias", () => {
    const notes = ["index.md", "flows/search.md", "architecture/search.md", "ops/deploy.md"];
    expect(resolveWikilink("deploy", notes)).toBe("ops/deploy.md");
    expect(resolveWikilink("Deploy|how to ship", notes)).toBe("ops/deploy.md");
    expect(resolveWikilink("flows/search#intro", notes)).toBe("flows/search.md");
    expect(resolveWikilink("nope", notes)).toBeNull();
  });
  it("picks the deepest vault and blocks symlink escape", async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), "hub-vault-"));
    const proj = path.join(home, "proj");
    mkdirSync(path.join(proj, "docs", ".obsidian"), { recursive: true });
    mkdirSync(path.join(proj, ".obsidian"));
    writeFileSync(path.join(proj, "docs", "index.md"), "# Hi");
    writeFileSync(path.join(home, "secret.md"), "secret");
    const { symlinkSync } = await import("node:fs");
    symlinkSync(path.join(home, "secret.md"), path.join(proj, "docs", "link.md"));
    expect(await findVaultRoot(proj, home)).toBe(path.join(proj, "docs"));
    expect(await readNote(proj, "index.md", home)).toBe("# Hi");
    expect(await readNote(proj, "link.md", home)).toBeNull();
    expect(await readNote(proj, "../secret.md", home)).toBeNull();
  });
});

describe("preview candidate decision", () => {
  const ok = (extra = {}) => async () => ({ status: 200, contentType: "text/html; charset=utf-8", ...extra });
  it("keeps 2xx/3xx HTML responders", async () => {
    expect(await probePreview("node", "http://x", ok())).toEqual({ embeddable: true });
    expect(await probePreview("node", "http://x", async () => ({ status: 302, contentType: "text/html" }))).toEqual({ embeddable: true });
  });
  it("drops 404, JSON, silent ports and editor processes", async () => {
    expect(await probePreview("python", "http://x", ok({ status: 404 }))).toBeNull();
    expect(await probePreview("python", "http://x", ok({ status: 500 }))).toBeNull();
    expect(await probePreview("python", "http://x", ok({ contentType: "application/json" }))).toBeNull();
    expect(await probePreview(null, "http://x", ok({ contentType: null }))).toBeNull();
    expect(await probePreview(null, "http://x", async () => null)).toBeNull();
    expect(await probePreview("code", "http://x", ok())).toBeNull();
  });
  it("flags non-embeddable pages", async () => {
    expect(await probePreview(null, "http://x", ok({ xFrameOptions: "DENY" }))).toEqual({ embeddable: false });
    expect(await probePreview(null, "http://x", ok({ csp: "default-src 'self'; frame-ancestors 'none'" }))).toEqual({ embeddable: false });
    expect(isEmbeddable({ status: 200, contentType: "text/html", csp: "frame-ancestors *" })).toBe(true);
    expect(isEmbeddable({ status: 200, contentType: "text/html", csp: "default-src 'self'" })).toBe(true);
  });
});

describe("cleanTitle", () => {
  it("replaces pasted blocks, strips tags, collapses whitespace", () => {
    expect(cleanTitle('pode continuar: <pasted_content id="a1">lots\nof text</pasted_content>  now <b>go</b>')).toBe("pode continuar: [pasted] now go");
  });
});

describe("docker service label", () => {
  it("reads the compose service", () => {
    const line = JSON.stringify({ Names: "my-app-rabbitmq-1", Ports: "0.0.0.0:15672->15672/tcp", Labels: "com.docker.compose.service=rabbitmq,com.docker.compose.project.working_dir=/a" });
    expect(parseDocker(line)[0]?.service).toBe("rabbitmq");
  });
});
