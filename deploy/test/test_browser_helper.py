import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest

HELPER = os.path.join(os.path.dirname(__file__), "..", "browser-helper.py")

# Fake Chrome: writes DevToolsActivePort and serves /json/version + PUT /json/new on a free port.
# Every request path and the launch args are appended to <profile>/log.
FAKE_CHROME = """#!%s
import http.server, os, sys
args = sys.argv[1:]
prof = next(a.split("=", 1)[1] for a in args if a.startswith("--user-data-dir="))
def log(line):
    with open(os.path.join(prof, "log"), "a") as f:
        f.write(line + "\\n")
class H(http.server.BaseHTTPRequestHandler):
    def reply(self):
        log(self.command + " " + self.path)
        self.send_response(200); self.end_headers(); self.wfile.write(b"{}")
    do_GET = do_PUT = reply
    def log_message(self, *a): pass
srv = http.server.HTTPServer(("127.0.0.1", 0), H)
log("ARGS " + " ".join(args))
with open(os.path.join(prof, "DevToolsActivePort"), "w") as f:
    f.write("%%d\\n/devtools/browser/fake\\n" %% srv.server_port)
srv.serve_forever()
""" % sys.executable


class BrowserHelperTest(unittest.TestCase):
    def setUp(self):
        self.state = tempfile.mkdtemp(prefix="hub-browser-")
        self.chrome = os.path.join(self.state, "fake-chrome")
        with open(self.chrome, "w") as f:
            f.write(FAKE_CHROME)
        os.chmod(self.chrome, 0o755)
        self.sock = os.path.join(self.state, "browser.sock")
        env = {**os.environ, "PROJECT_HUB_STATE": self.state, "PROJECT_HUB_CHROME": self.chrome}
        self.helper = subprocess.Popen([sys.executable, HELPER], env=env)
        for _ in range(50):
            if os.path.exists(self.sock):
                break
            time.sleep(0.1)
        self.extra = []

    def tearDown(self):
        self.helper.terminate()
        self.helper.wait(timeout=10)
        for p in self.extra:
            p.kill()
            p.wait()
        # Fake Chromes left running (the helper does not kill them on exit; systemd does).
        subprocess.run(["pkill", "-f", self.chrome])
        shutil.rmtree(self.state, ignore_errors=True)

    def call(self, **req):
        with socket.socket(socket.AF_UNIX) as s:
            s.settimeout(30)
            s.connect(self.sock)
            s.sendall(json.dumps(req).encode() + b"\n")
            return json.loads(s.makefile().readline())

    def profile(self, pid):
        return os.path.join(self.state, "browser-profiles", pid)

    def log(self, pid):
        with open(os.path.join(self.profile(pid), "log")) as f:
            return f.read().splitlines()

    def test_socket_mode_0600(self):
        self.assertEqual(stat.S_IMODE(os.stat(self.sock).st_mode), 0o600)

    def test_launch_then_reuse(self):
        r = self.call(op="launch", projectId="proj", url="http://localhost:5000/a")
        self.assertTrue(r["ok"])
        self.assertFalse(r["reused"])
        self.assertRegex(r["cdpUrl"], r"^http://127\.0\.0\.1:\d+$")
        args = [l for l in self.log("proj") if l.startswith("ARGS")][0]
        for flag in ("--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--no-first-run",
                     "--new-window", "http://localhost:5000/a"):
            self.assertIn(flag, args)
        r2 = self.call(op="launch", projectId="proj", url="http://127.0.0.1:5001/b")
        self.assertEqual(r2, {"ok": True, "cdpUrl": r["cdpUrl"], "reused": True})
        self.assertIn("PUT /json/new?http://127.0.0.1:5001/b", self.log("proj"))
        listed = self.call(op="list")
        self.assertEqual([(e["projectId"], e["cdpUrl"]) for e in listed], [("proj", r["cdpUrl"])])
        self.assertIsInstance(listed[0]["pid"], int)

    def test_stale_port_file(self):
        os.makedirs(self.profile("proj"))
        with open(os.path.join(self.profile("proj"), "DevToolsActivePort"), "w") as f:
            f.write("1\n/devtools/browser/dead\n")
        r = self.call(op="launch", projectId="proj", url="http://localhost:5000/")
        self.assertTrue(r["ok"])
        self.assertFalse(r["reused"])
        self.assertNotEqual(r["cdpUrl"], "http://127.0.0.1:1")

    def test_reuses_chrome_not_launched_by_helper(self):
        prof = self.profile("manual")
        os.makedirs(prof)
        p = subprocess.Popen([self.chrome, f"--user-data-dir={prof}"])
        self.extra.append(p)
        for _ in range(50):
            if os.path.exists(os.path.join(prof, "DevToolsActivePort")):
                break
            time.sleep(0.1)
        r = self.call(op="launch", projectId="manual", url="http://localhost:5000/")
        self.assertTrue(r["reused"])
        self.assertEqual(self.call(op="list")[0]["pid"], None)
        self.assertEqual(self.call(op="close", projectId="manual"), {"ok": False, "error": "not_owned"})
        self.assertIsNone(p.poll())

    def test_validation(self):
        bad_ids = ["../x", "a/b", "", "a b", "..", "."]
        for pid in bad_ids:
            self.assertEqual(self.call(op="launch", projectId=pid, url="http://localhost:1/"),
                             {"ok": False, "error": "invalid_project_id"}, pid)
            self.assertEqual(self.call(op="close", projectId=pid), {"ok": False, "error": "invalid_project_id"})
        bad_urls = ["https://localhost:5000/", "http://example.com:5000/", "http://localhost/",
                    "http://localhost.evil.com:5000/", "file:///etc/passwd", "http://localhost:5000/ --foo",
                    "javascript:alert(1)", None, 5]
        for url in bad_urls:
            self.assertEqual(self.call(op="launch", projectId="proj", url=url),
                             {"ok": False, "error": "invalid_url"}, url)
        self.assertEqual(self.call(op="nope"), {"ok": False, "error": "unknown_op"})
        self.assertFalse(os.path.exists(self.profile("proj")))

    def test_bad_json(self):
        with socket.socket(socket.AF_UNIX) as s:
            s.connect(self.sock)
            s.sendall(b"not json\n")
            self.assertEqual(json.loads(s.makefile().readline()), {"ok": False, "error": "bad_request"})

    def test_close(self):
        r = self.call(op="launch", projectId="proj", url="http://localhost:5000/")
        self.assertEqual(self.call(op="close", projectId="proj"), {"ok": True})
        self.assertEqual(self.call(op="list"), [])
        self.assertEqual(self.call(op="close", projectId="proj"), {"ok": False, "error": "not_owned"})
        # a new launch after close starts a fresh Chrome
        r2 = self.call(op="launch", projectId="proj", url="http://localhost:5000/")
        self.assertTrue(r2["ok"])
        self.assertFalse(r2["reused"])


if __name__ == "__main__":
    unittest.main()
