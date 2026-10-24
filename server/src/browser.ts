import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Host helper (deploy/browser-helper.py) reply: one JSON line per request. */
export type HelperReply = { ok: true; cdpUrl?: string; reused?: boolean } | { ok: false; error: string };

export class BrowserError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const TIMEOUT_MS = 25_000; // a cold Chrome launch can take ~20 s

function socketPath(): string {
  return process.env.PROJECT_HUB_BROWSER_SOCK ?? path.join(os.homedir(), ".local/state/project-hub/browser.sock");
}

/** Sends one request to the helper socket. Rejects with `BrowserError("browser_helper_unavailable")` when it is not there. */
export function helperCall(req: Record<string, unknown>): Promise<HelperReply> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socketPath());
    let buf = "";
    const done = (fn: () => void) => {
      clearTimeout(timer);
      sock.destroy();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new BrowserError("browser_helper_timeout"))), TIMEOUT_MS);
    sock.once("connect", () => sock.write(JSON.stringify(req) + "\n"));
    sock.on("data", (c) => {
      buf += c.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      try {
        const reply = JSON.parse(buf.slice(0, nl)) as HelperReply;
        done(() => resolve(reply));
      } catch {
        done(() => reject(new BrowserError("browser_helper_bad_reply")));
      }
    });
    sock.once("error", (e: NodeJS.ErrnoException) => {
      const gone = e.code === "ENOENT" || e.code === "ECONNREFUSED";
      done(() => reject(new BrowserError(gone ? "browser_helper_unavailable" : "browser_helper_error")));
    });
    sock.once("end", () => done(() => reject(new BrowserError("browser_helper_bad_reply"))));
  });
}
