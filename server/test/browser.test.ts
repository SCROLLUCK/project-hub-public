import { mkdtempSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { killAllPreviews, listPreviews, startPreview, stopPreview } from "../src/previews";
import { registerRoutes } from "../src/routes";

const SERVE = `node -e "require('net').createServer().listen({port},'127.0.0.1')"`;
const CDP = "http://127.0.0.1:9555";

let dir: string;
let server: net.Server;
let requests: Array<Record<string, unknown>>;
let reply: Record<string, unknown>;

/** Fake host helper: records each request line and answers with `reply`. */
function fakeHelper(sock: string): Promise<void> {
  server = net.createServer((c) => {
    let buf = "";
    c.on("data", (d) => {
      buf += d.toString();
      if (!buf.includes("\n")) return;
      requests.push(JSON.parse(buf) as Record<string, unknown>);
      c.end(JSON.stringify(reply) + "\n");
    });
  });
  return new Promise((r) => server.listen(sock, r));
}

async function runningPreview(projectId: string) {
  const info = await startPreview(projectId, dir, { devCommand: SERVE });
  if ("error" in info) throw new Error(info.error);
  for (let i = 0; i < 100 && info.status !== "running"; i++) await new Promise((r) => setTimeout(r, 100));
  expect(info.status).toBe("running");
  return info;
}

const app = Fastify();
registerRoutes(app);

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "hub-browser-"));
  requests = [];
  reply = { ok: true, cdpUrl: CDP, reused: false };
  process.env.PROJECT_HUB_BROWSER_SOCK = path.join(dir, "browser.sock");
});

afterEach(async () => {
  killAllPreviews();
  for (const p of listPreviews()) await stopPreview(p.id);
  await new Promise((r) => (server?.listening ? server.close(r) : r(null)));
});

describe("preview browser", () => {
  it("opens the project browser on the preview url", async () => {
    await fakeHelper(process.env.PROJECT_HUB_BROWSER_SOCK!);
    const pv = await runningPreview("p1");
    const res = await app.inject({ method: "POST", url: `/api/previews/${pv.id}/browser` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cdpUrl: CDP, reused: false });
    expect(requests).toEqual([{ op: "launch", projectId: "p1", url: pv.url }]);
    const got = await app.inject({ url: `/api/previews/${pv.id}` });
    expect(got.json().browser).toEqual({ status: "open", cdpUrl: CDP });
  });

  it("503 when the helper socket is absent", async () => {
    const pv = await runningPreview("p1");
    const res = await app.inject({ method: "POST", url: `/api/previews/${pv.id}/browser` });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "browser_helper_unavailable" });
  });

  it("404 unknown preview, 409 not running, 502 helper error", async () => {
    await fakeHelper(process.env.PROJECT_HUB_BROWSER_SOCK!);
    expect((await app.inject({ method: "POST", url: "/api/previews/nope/browser" })).statusCode).toBe(404);
    const slow = await startPreview("p1", dir, { devCommand: "sleep 30" });
    if ("error" in slow) throw new Error(slow.error);
    const res = await app.inject({ method: "POST", url: `/api/previews/${slow.id}/browser` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "preview_not_running" });
    const pv = await runningPreview("p1");
    reply = { ok: false, error: "chrome_failed" };
    const bad = await app.inject({ method: "POST", url: `/api/previews/${pv.id}/browser` });
    expect(bad.statusCode).toBe(502);
    expect(bad.json()).toEqual({ error: "chrome_failed" });
  });

  it("DELETE closes the browser for every preview of the project; not_owned is 409", async () => {
    await fakeHelper(process.env.PROJECT_HUB_BROWSER_SOCK!);
    const a = await runningPreview("p1");
    const b = await runningPreview("p1");
    await app.inject({ method: "POST", url: `/api/previews/${a.id}/browser` });
    await app.inject({ method: "POST", url: `/api/previews/${b.id}/browser` });
    const res = await app.inject({ method: "DELETE", url: `/api/previews/${a.id}/browser` });
    expect(res.json()).toEqual({ ok: true });
    expect(requests.at(-1)).toEqual({ op: "close", projectId: "p1" });
    expect(a.browser.status).toBe("none");
    expect(b.browser).toEqual({ status: "none", cdpUrl: null });
    reply = { ok: false, error: "not_owned" };
    const own = await app.inject({ method: "DELETE", url: `/api/previews/${a.id}/browser` });
    expect(own.statusCode).toBe(409);
    expect(own.json()).toEqual({ error: "browser_not_owned" });
  });

  it("stopping a preview closes the browser only when no other running preview of the project keeps it open", async () => {
    await fakeHelper(process.env.PROJECT_HUB_BROWSER_SOCK!);
    const a = await runningPreview("p1");
    const b = await runningPreview("p1");
    const other = await runningPreview("p2");
    for (const p of [a, b, other]) await app.inject({ method: "POST", url: `/api/previews/${p.id}/browser` });
    requests = [];
    await stopPreview(a.id);
    expect(requests).toEqual([]);
    expect(b.browser.status).toBe("open");
    await stopPreview(b.id);
    expect(requests).toEqual([{ op: "close", projectId: "p1" }]);
    expect(other.browser.status).toBe("open");
  });

  it("stopping ignores helper errors", async () => {
    await fakeHelper(process.env.PROJECT_HUB_BROWSER_SOCK!);
    const a = await runningPreview("p1");
    await app.inject({ method: "POST", url: `/api/previews/${a.id}/browser` });
    await new Promise((r) => server.close(r));
    await expect(stopPreview(a.id)).resolves.toBe(true);
  });
});
