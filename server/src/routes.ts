import { FastifyInstance, FastifyReply } from "fastify";
import {
  BacklogMismatch,
  TEMPLATE,
  addItem,
  readBacklog,
  toggleItem,
  writeBacklog,
} from "./backlog";
import { Config, applySettings, readConfig, settingsView, updateConfig, writeConfig } from "./config";
import { editorUrl, OpenError } from "./open";
import { getPipelines } from "./pipelines";
import { BrowserError } from "./browser";
import { closeBrowser, getPreview, listPreviews, openBrowser, startPreview, stopPreview } from "./previews";
import { readQuota } from "./quota";
import { listRunning } from "./running";
import { listShowcase } from "./showcase";
import { listSessions } from "./sessions";
import { readNote, readVault } from "./vault";
import { allProjects, findProject, projectInfo, remoteOf } from "./projects";
import { listRawWorktrees, listWorktrees, worktreeDiff } from "./worktrees";

type Body = Record<string, unknown>;

function bad(reply: FastifyReply, message: string, code = 400) {
  return reply.code(code).send({ error: message });
}

export function registerRoutes(app: FastifyInstance): void {
  const project = async (id: string, reply: FastifyReply) => {
    const p = await findProject(id);
    if (!p) bad(reply, "project_not_found", 404);
    return p;
  };

  app.get<{ Querystring: { all?: string } }>("/api/projects", async (req) => {
    const cfg = await readConfig();
    return allProjects(cfg, req.query.all === "1");
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const f = await project(req.params.id, reply);
    if (!f) return;
    const cfg = await readConfig();
    const [info, worktrees] = await Promise.all([projectInfo(f, cfg), listWorktrees(f.path)]);
    return { ...info, worktrees };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/worktrees", async (req, reply) => {
    const f = await project(req.params.id, reply);
    if (!f) return;
    return listWorktrees(f.path);
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>("/api/projects/:id/worktrees/diff", async (req, reply) => {
    const f = await project(req.params.id, reply);
    if (!f) return;
    const wt = (await listRawWorktrees(f.path)).find((w) => w.path === req.query.path);
    if (!wt) return bad(reply, "worktree_not_found", 404);
    return worktreeDiff(f.path, wt.path);
  });

  // previews
  app.post<{ Body: { projectId?: string; worktreePath?: string } }>("/api/previews", async (req, reply) => {
    const { projectId, worktreePath } = req.body ?? {};
    if (!projectId || !worktreePath) return bad(reply, "projectId and worktreePath required");
    const f = await project(projectId, reply);
    if (!f) return;
    const wt = (await listRawWorktrees(f.path)).find((w) => w.path === worktreePath);
    if (!wt) return bad(reply, "worktree_not_found", 404);
    const cfg = await readConfig();
    const res = await startPreview(projectId, wt.path, cfg.projects[projectId]);
    if ("error" in res) return reply.code(422).send({ error: res.error, hint: `set projects["${projectId}"].devCommand in the config` });
    return res;
  });

  app.get("/api/previews", async () => listPreviews());

  app.get<{ Params: { id: string } }>("/api/previews/:id", (req, reply) => {
    const p = getPreview(req.params.id);
    return p ? p.info : bad(reply, "preview_not_found", 404);
  });

  const browserFail = (reply: FastifyReply, e: unknown) => {
    if (!(e instanceof BrowserError)) throw e;
    const status = { preview_not_found: 404, preview_not_running: 409, not_owned: 409, browser_helper_unavailable: 503 }[e.code] ?? 502;
    return bad(reply, e.code === "not_owned" ? "browser_not_owned" : e.code, status);
  };

  app.post<{ Params: { id: string } }>("/api/previews/:id/browser", async (req, reply) => {
    try {
      return await openBrowser(req.params.id);
    } catch (e) {
      return browserFail(reply, e);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/previews/:id/browser", async (req, reply) => {
    try {
      await closeBrowser(req.params.id);
      return { ok: true };
    } catch (e) {
      return browserFail(reply, e);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/previews/:id", async (req, reply) => {
    if (!(await stopPreview(req.params.id))) return bad(reply, "preview_not_found", 404);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/previews/:id/logs", (req, reply) => {
    const p = getPreview(req.params.id);
    if (!p) return bad(reply, "preview_not_found", 404);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const l of p.logs) send("log", l);
    send("status", p.info.status);
    send("issues", p.info.issues);
    const onIssues = (i: string[]) => send("issues", i);
    p.on("issues", onIssues);
    const onLog = (l: string) => send("log", l);
    const onStatus = (s: string) => send("status", s);
    p.on("log", onLog);
    p.on("status", onStatus);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.raw.on("close", () => {
      clearInterval(ping);
      p.off("log", onLog);
      p.off("status", onStatus);
      p.off("issues", onIssues);
    });
  });

  // running servers, quota, sessions, vault
  app.get("/api/running", async () => listRunning());

  app.get("/api/showcase", async () => listShowcase(await readConfig()));

  app.get("/api/quota", async () => readQuota(undefined, undefined, undefined, undefined, (await readConfig()).quotaHidden));

  app.get<{ Params: { id: string } }>("/api/projects/:id/sessions", async (req, reply) => {
    const f = await project(req.params.id, reply);
    if (!f) return;
    return listSessions(f.path);
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/vault", async (req, reply) => {
    const f = await project(req.params.id, reply);
    if (!f) return;
    return readVault(f.path);
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>("/api/projects/:id/vault/note", async (req, reply) => {
    const f = await project(req.params.id, reply);
    if (!f) return;
    const rel = req.query.path;
    if (typeof rel !== "string" || !rel) return bad(reply, "path required");
    const md = await readNote(f.path, rel);
    if (md === null) return bad(reply, "note_not_found", 404);
    return reply.type("text/markdown; charset=utf-8").send(md);
  });

  // open in VS Code
  app.post<{ Body: { path?: string; file?: string; line?: number } }>("/api/open", async (req, reply) => {
    const { path: target, file, line } = req.body ?? {};
    if (typeof target !== "string" || !target) return bad(reply, "path required");
    try {
      return { ok: true, url: await editorUrl(target, file, line) };
    } catch (e) {
      if (e instanceof OpenError) return bad(reply, e.message);
      throw e;
    }
  });

  // pipelines
  app.get<{ Params: { id: string } }>("/api/projects/:id/pipelines", async (req, reply) => {
    const f = await project(req.params.id, reply);
    if (!f) return;
    const [{ remote }, cfg] = await Promise.all([remoteOf(f.path), readConfig()]);
    return getPipelines(f.id, remote, cfg);
  });

  // backlog
  app.get<{ Params: { id: string } }>("/api/projects/:id/backlog", async (req, reply) => {
    const f = await project(req.params.id, reply);
    if (!f) return;
    return readBacklog(f.path);
  });

  app.patch<{ Params: { id: string }; Body: { line?: number; done?: boolean; expectedText?: string } }>("/api/projects/:id/backlog", async (req, reply) => {
    const f = await project(req.params.id, reply);
    if (!f) return;
    const { line, done, expectedText } = req.body ?? {};
    if (!Number.isInteger(line) || typeof done !== "boolean" || typeof expectedText !== "string") return bad(reply, "line, done and expectedText required");
    const state = await readBacklog(f.path);
    if (!state.exists) return bad(reply, "backlog_not_found", 404);
    try {
      await writeBacklog(f.path, toggleItem(state.raw, line as number, done, expectedText));
    } catch (e) {
      if (e instanceof BacklogMismatch) return reply.code(409).send({ error: "mismatch", message: e.message });
      throw e;
    }
    return readBacklog(f.path);
  });

  app.post<{ Params: { id: string }; Body: { section?: string; text?: string } }>("/api/projects/:id/backlog", async (req, reply) => {
    const f = await project(req.params.id, reply);
    if (!f) return;
    const { section, text } = req.body ?? {};
    if (typeof section !== "string" || !section.trim() || typeof text !== "string" || !text.trim()) return bad(reply, "section and text required");
    const state = await readBacklog(f.path);
    if (!state.exists) return bad(reply, "backlog_not_found", 404);
    await writeBacklog(f.path, addItem(state.raw, section.trim(), text));
    return readBacklog(f.path);
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/backlog/create", async (req, reply) => {
    const f = await project(req.params.id, reply);
    if (!f) return;
    if ((await readBacklog(f.path)).exists) return reply.code(409).send({ error: "exists" });
    await writeBacklog(f.path, TEMPLATE);
    return readBacklog(f.path);
  });

  // settings
  app.get("/api/settings", async () => settingsView(await readConfig()));

  app.put<{ Body: Partial<Config> }>("/api/settings", async (req) => {
    const cfg = await readConfig();
    const next = applySettings(cfg, (req.body ?? {}) as Partial<Config>);
    await writeConfig(next);
    return settingsView(next);
  });

  const toggle = (key: "pinned" | "hidden") => async (req: { params: { id: string } }, reply: FastifyReply) => {
    const f = await project(req.params.id, reply);
    if (!f) return;
    let on = false;
    await updateConfig((cfg) => {
      on = !cfg[key].includes(f.id);
      cfg[key] = on ? [...cfg[key], f.id] : cfg[key].filter((x) => x !== f.id);
    });
    return { id: f.id, [key]: on };
  };
  app.post<{ Params: { id: string } }>("/api/projects/:id/pin", toggle("pinned"));
  app.post<{ Params: { id: string } }>("/api/projects/:id/hide", toggle("hidden"));
}

