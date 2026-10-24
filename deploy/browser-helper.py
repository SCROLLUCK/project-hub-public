#!/usr/bin/env python3
"""Host-side helper: launches/reuses one headed Chrome per project with CDP on 127.0.0.1.

Chrome needs the host's display, so the hub container cannot start it. The container talks to
this helper over a Unix socket (JSON, one request per connection):
  {"op":"launch","projectId":"..","url":".."} -> {"ok":true,"cdpUrl":"http://127.0.0.1:<port>","reused":bool}
  {"op":"close","projectId":".."}             -> {"ok":true} | {"ok":false,"error":"not_owned"}
  {"op":"list"}                               -> [{"projectId","cdpUrl","pid"}]
Errors are {"ok":false,"error":"<code>"}.
"""
import json
import os
import re
import signal
import socketserver
import subprocess
import threading
import time
import urllib.parse
import urllib.request

STATE = os.environ.get("PROJECT_HUB_STATE") or os.path.expanduser("~/.local/state/project-hub")
CHROME = os.environ.get("PROJECT_HUB_CHROME", "/usr/bin/google-chrome")
SOCK = os.path.join(STATE, "browser.sock")
PROFILES = os.path.join(STATE, "browser-profiles")
ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")

lock = threading.Lock()
owned = {}  # projectId -> Popen of the Chrome this helper launched


def profile_dir(pid):
    return os.path.join(PROFILES, pid)


def cdp_port(pid):
    """Port of a live CDP endpoint for this profile, else None."""
    try:
        with open(os.path.join(profile_dir(pid), "DevToolsActivePort")) as f:
            port = int(f.readline().strip())
        urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2).close()
        return port
    except (OSError, ValueError):
        return None


def valid_url(url):
    if not isinstance(url, str) or re.search(r"[\x00-\x20\x7f]", url):
        return False
    try:
        u = urllib.parse.urlsplit(url)
        return u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1") and u.port is not None
    except ValueError:
        return False


def launch(pid, url):
    port = cdp_port(pid)
    if port:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?{url}", method="PUT")
        urllib.request.urlopen(req, timeout=5).close()
        return {"ok": True, "cdpUrl": f"http://127.0.0.1:{port}", "reused": True}
    prof = profile_dir(pid)
    os.makedirs(prof, exist_ok=True)
    try:
        os.remove(os.path.join(prof, "DevToolsActivePort"))
    except FileNotFoundError:
        pass
    proc = subprocess.Popen(
        [CHROME, "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
         f"--user-data-dir={prof}", "--no-first-run", "--new-window", url],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    owned[pid] = proc
    # wait() reaps the child when Chrome exits.
    threading.Thread(target=lambda: (proc.wait(), owned.get(pid) is proc and owned.pop(pid)), daemon=True).start()
    deadline = time.time() + 20
    while time.time() < deadline:
        if proc.poll() is not None:
            return {"ok": False, "error": "chrome_exited"}
        port = cdp_port(pid)
        if port:
            return {"ok": True, "cdpUrl": f"http://127.0.0.1:{port}", "reused": False}
        time.sleep(0.2)
    return {"ok": False, "error": "launch_timeout"}


def close(pid):
    proc = owned.get(pid)
    if proc is None or proc.poll() is not None:
        return {"ok": False, "error": "not_owned"}
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    return {"ok": True}


def list_live():
    out = []
    for pid in sorted(os.listdir(PROFILES)) if os.path.isdir(PROFILES) else []:
        port = cdp_port(pid)
        if port:
            proc = owned.get(pid)
            out.append({"projectId": pid, "cdpUrl": f"http://127.0.0.1:{port}", "pid": proc.pid if proc else None})
    return out


def handle(req):
    op = req.get("op") if isinstance(req, dict) else None
    if op == "list":
        return list_live()
    if op in ("launch", "close"):
        pid = req.get("projectId")
        if not isinstance(pid, str) or not ID_RE.match(pid) or pid in (".", ".."):
            return {"ok": False, "error": "invalid_project_id"}
        if op == "close":
            return close(pid)
        if not valid_url(req.get("url")):
            return {"ok": False, "error": "invalid_url"}
        return launch(pid, req["url"])
    return {"ok": False, "error": "unknown_op"}


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            req = json.loads(self.rfile.readline(65536))
        except ValueError:
            res = {"ok": False, "error": "bad_request"}
        else:
            try:
                with lock:
                    res = handle(req)
            except Exception:
                res = {"ok": False, "error": "internal_error"}
        self.wfile.write(json.dumps(res).encode() + b"\n")


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def main():
    os.makedirs(STATE, exist_ok=True)
    try:
        os.remove(SOCK)
    except FileNotFoundError:
        pass
    old_umask = os.umask(0o177)  # socket is created 0600; restored so Chrome's profile files are normal
    srv = Server(SOCK, Handler)
    os.umask(old_umask)
    os.chmod(SOCK, 0o600)
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=srv.shutdown).start())
    try:
        srv.serve_forever()
    finally:
        srv.server_close()
        os.remove(SOCK)


if __name__ == "__main__":
    main()
