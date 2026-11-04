from http.server import BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from http.server import HTTPServer
import urllib.request, urllib.error
import json, os, shutil, subprocess, tempfile

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200, json.dumps({"ok": True, "msg": "proxy works"}).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        if self.path == "/api/chat":
            key = self.headers.get("X-Ollama-Key", "")
            req = urllib.request.Request(
                "https://ollama.com/api/chat",
                data=body,
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {key}"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    self._send(r.status, r.read())
            except urllib.error.HTTPError as e:
                self._send(e.code, e.read())
            except Exception as e:
                self._send(502, json.dumps({"error": str(e)}).encode())
            return

        if self.path == "/convert":
            self._convert_pptx_to_odp(body)
            return

        self._send(404, json.dumps({"error": "not found"}).encode())

    def _convert_pptx_to_odp(self, body):
        # достаём файл из multipart
        ctype = self.headers.get("Content-Type", "")
        if "boundary=" not in ctype:
            self._send(400, json.dumps({"error": "no multipart boundary"}).encode())
            return
        boundary = ctype.split("boundary=")[-1].encode()
        filedata = None
        for part in body.split(b"--" + boundary):
            if b'filename="' in part:
                _, _, rest = part.partition(b"\r\n\r\n")
                filedata = rest.rsplit(b"\r\n", 1)[0]
                break
        if not filedata:
            self._send(400, json.dumps({"error": "file not found in request"}).encode())
            return

        soffice = shutil.which("soffice") or shutil.which("libreoffice")
        if not soffice:
            self._send(500, json.dumps({
                "error": "LibreOffice не найден. Установи: sudo apt install libreoffice-impress"
            }).encode())
            return

        try:
            with tempfile.TemporaryDirectory() as td:
                src = os.path.join(td, "in.pptx")
                with open(src, "wb") as f:
                    f.write(filedata)
                subprocess.run(
                    [soffice, "--headless", "--convert-to", "odp", "--outdir", td, src],
                    capture_output=True, timeout=180,
                )
                out = os.path.join(td, "in.odp")
                if not os.path.exists(out):
                    self._send(500, json.dumps({"error": "конвертация не удалась"}).encode())
                    return
                with open(out, "rb") as f:
                    data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.oasis.opendocument.presentation")
            self._cors()
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self._send(500, json.dumps({"error": str(e)}).encode())

    def log_message(self, fmt, *args):
        print("[proxy]", fmt % args)

if __name__ == "__main__":
    print("Прокси запущен на http://127.0.0.1:8787 (chat + convert)")
    HTTPServer(("127.0.0.1", 8787), Handler).serve_forever()