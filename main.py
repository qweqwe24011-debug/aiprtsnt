#!/usr/bin/env python3
"""
SlideCraft — локальный прокси + статический сервер с обязательной регистрацией.

ИИ-запросы идут напрямую в GenAPI (OpenAI-совместимый прокси):
    https://proxy.gen-api.ru/v1/chat/completions
Ключ живёт только на сервере, браузер его не видит.

Настройки читаются из `.env` рядом с этим файлом:
  AI_PROVIDER             — "genapi" (по умолчанию) | "ollama" | "groq" | "openai" | "gigachat"
  GENAPI_BASE_URL         — https://proxy.gen-api.ru/v1
  GENAPI_API_KEY          — ключ из личного кабинета gen-api.ru
  GENAPI_MODEL_FAST       — id модели для режима «Быстро»
  GENAPI_MODEL_THINK      — id модели для режима «Раздумия»
  GENAPI_MAX_TOKENS       — потолок вывода (GenAPI резервирует стоимость по нему!)
  GENAPI_REASONING_THINK  — reasoning_effort для режима «Раздумия» (пусто = не слать)
  GENAPI_CHECK_MODELS     — сверять id с каталогом при старте (по умолчанию true)

АВТОРИЗАЦИЯ:
  - users.json    — {username: {salt, hash, iterations, created}}
  - sessions.json — {token: {username, expires}}
  - PBKDF2-HMAC-SHA256, 600k итераций, 16-байтовый salt.
  - Сессия — 32 случайных байта в HttpOnly-куке sc_session.
  - Публичные маршруты: /login (HTML), /register (POST), /login (POST).

Запуск:  python main.py
Открыть: http://127.0.0.1:8787/  ->  редирект на /login
"""
import os
import sys
import re
import ssl
import time
import json
import hmac
import shutil
import hashlib
import secrets
import tempfile
import threading
import mimetypes
import subprocess
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from http.cookies import SimpleCookie

# ---------- веб-поиск для промпта презентации ----------
try:
    from search import search_web, format_for_prompt, is_available as search_is_available
    SEARCH_AVAILABLE = search_is_available()
except ImportError:
    SEARCH_AVAILABLE = False
    print("⚠️  search.py не найден — веб-поиск отключён.", file=sys.stderr)

# ============================================================
# Загрузка .env (pure stdlib)
# ============================================================
_STRIP_QUOTES = '"\'\u2018\u2019\u201c\u201d\u00ab\u00bb'

def _load_env(path=".env"):
    """Минимальный парсер .env. Переменные оболочки имеют приоритет."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip().strip(_STRIP_QUOTES).strip())

STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
_load_env(os.path.join(STATIC_DIR, ".env"))

# ============================================================
# Хелперы чтения env
# ============================================================
def _env_bool(name, default=False):
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in ("true", "1", "yes", "on")

def _env_int(name, default):
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except (ValueError, TypeError):
        print(f"⚠️  {name}='{raw}' не число — использую default={default}", file=sys.stderr)
        return default

# ============================================================
# ИИ-провайдер
# ============================================================
AI_PROVIDER     = os.environ.get("AI_PROVIDER", "genapi").lower().strip()
ALLOWED_ORIGIN  = os.environ.get("ALLOWED_ORIGIN", "*")
AI_TIMEOUT      = _env_int("AI_TIMEOUT", 300)
MAX_TOKENS      = _env_int("GENAPI_MAX_TOKENS", 4000)   # 0 = не ограничивать
REASONING_THINK = os.environ.get("GENAPI_REASONING_THINK", "").strip()

if AI_PROVIDER == "genapi":
    # OpenAI-формат GenAPI живёт на отдельном поддомене proxy.gen-api.ru
    GENAPI_BASE_URL = os.environ.get(
        "GENAPI_BASE_URL", "https://proxy.gen-api.ru/v1").rstrip("/")
    AI_URL      = GENAPI_BASE_URL + "/chat/completions"
    API_KEY     = os.environ.get("GENAPI_API_KEY", "").strip()
    MODEL_FAST  = os.environ.get("GENAPI_MODEL_FAST",  "deepseek-v4-1-flash").strip()
    MODEL_THINK = os.environ.get("GENAPI_MODEL_THINK", "deepseek-v4-1-flash").strip()
    # response_format=json_object поддерживают не все модели GenAPI
    USE_JSON_RESPONSE_FORMAT = _env_bool("GENAPI_JSON_RESPONSE_FORMAT", False)
    VERIFY_SSL  = True
else:
    GENAPI_BASE_URL = ""
    API_KEY     = os.environ.get("OLLAMA_API_KEY", "").strip()
    MODEL_FAST  = os.environ.get("OLLAMA_MODEL_FAST",  "gemma4:31b")
    MODEL_THINK = os.environ.get("OLLAMA_MODEL_THINK", "nemotron-3-super")
    USE_JSON_RESPONSE_FORMAT = True
    VERIFY_SSL  = AI_PROVIDER != "gigachat"
    if AI_PROVIDER == "groq":
        AI_URL = "https://api.groq.com/openai/v1/chat/completions"
    elif AI_PROVIDER == "openai":
        AI_URL = os.environ.get("AI_URL", "https://api.openai.com/v1/chat/completions")
    elif AI_PROVIDER == "gigachat":
        AI_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"
        AI_OAUTH_URL = "https://gigachat.devices.sberbank.ru/api/v1/oauth"
    else:
        AI_URL = os.environ.get("AI_URL", "https://ollama.com/api/chat")

# ---------- legacy: GigaChat OAuth (только если AI_PROVIDER=gigachat) ----------
_giga_token = None
_giga_token_expires = 0

def _get_gigachat_token():
    """OAuth access_token для GigaChat, кеш на 25 минут (токен живёт 30)."""
    global _giga_token, _giga_token_expires
    if _giga_token and time.time() < _giga_token_expires:
        return _giga_token
    import uuid
    req = urllib.request.Request(
        AI_OAUTH_URL,
        headers={
            "Authorization": f"Basic {API_KEY}",
            "RqUID": str(uuid.uuid4()),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
        data=b"scope=GIGACHAT_API_PERS",
    )
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
            data = json.loads(r.read())
            _giga_token = data.get("access_token")
            _giga_token_expires = time.time() + 25 * 60
            print("[gigachat] token получен", file=sys.stderr)
            return _giga_token
    except Exception as e:
        print(f"[gigachat] ошибка получения токена: {e}", file=sys.stderr)
        return None

# ============================================================
# Сеть / HTTPS / поиск
# ============================================================
BIND_HOST = os.environ.get("BIND_HOST", "127.0.0.1")
BIND_PORT = _env_int("BIND_PORT", 8787)

USE_HTTPS = _env_bool("USE_HTTPS", False)
CERT_FILE = os.environ.get("SSL_CERT_FILE", os.path.join(STATIC_DIR, "cert.pem"))
KEY_FILE  = os.environ.get("SSL_KEY_FILE",  os.path.join(STATIC_DIR, "key.pem"))

SEARCH_ENABLED     = _env_bool("SEARCH_ENABLED", True)
SEARCH_MAX_RESULTS = _env_int("SEARCH_MAX_RESULTS", 5)
SEARCH_REGION      = os.environ.get("SEARCH_REGION", "ru-ru")

if SEARCH_ENABLED and not SEARCH_AVAILABLE:
    print("⚠️  SEARCH_ENABLED=true, но библиотека не установлена. pip install ddgs",
          file=sys.stderr)

if not API_KEY:
    if AI_PROVIDER == "genapi":
        print("⚠️  GENAPI_API_KEY пустой. Создай ключ в личном кабинете gen-api.ru "
              "и впиши в .env рядом с main.py.", file=sys.stderr)
    else:
        print("⚠️  OLLAMA_API_KEY пустой. Проставь ключ в .env рядом с main.py.", file=sys.stderr)
elif not API_KEY.isascii():
    print("⚠️  Ключ содержит не-ASCII символы. Проверь .env на смарт-кавычки.", file=sys.stderr)

# ============================================================
# Auth
# ============================================================
USERS_FILE     = os.path.join(STATIC_DIR, "users.json")
SESSIONS_FILE  = os.path.join(STATIC_DIR, "sessions.json")
SESSION_COOKIE = "sc_session"
SESSION_TTL    = 30 * 24 * 3600
PBKDF2_ITERS   = 600_000

_PROTECTED_FILES = {
    "users.json", "sessions.json", ".env", ".env.example",
    "main.py", "search.py", "test.py", "check_genapi.py",
    "cert.pem", "key.pem",
}

def _load_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def _save_json(path, data, private=False):
    """Атомарная запись: временный файл + os.replace. private=True -> 0o600."""
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(
            dir=os.path.dirname(path) or ".",
            prefix=".tmp_", suffix=os.path.basename(path))
        if private:
            try: os.fchmod(fd, 0o600)
            except (OSError, AttributeError): pass
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
        tmp_path = None
        if private:
            try: os.chmod(path, 0o600)
            except OSError: pass
    except Exception as e:
        print(f"save_json {path}: {e}", file=sys.stderr)
        if tmp_path and os.path.exists(tmp_path):
            try: os.unlink(tmp_path)
            except OSError: pass

def _hash_password(password, salt_hex=None, iterations=PBKDF2_ITERS):
    salt = secrets.token_bytes(16) if salt_hex is None else bytes.fromhex(salt_hex)
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return salt.hex(), h.hex()

def _verify_password(password, salt_hex, hash_hex, iterations=PBKDF2_ITERS):
    try:
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(h.hex(), hash_hex)

def _create_session(username):
    token = secrets.token_urlsafe(32)
    sessions = _load_json(SESSIONS_FILE, {})
    now = time.time()
    sessions = {t: v for t, v in sessions.items() if v.get("expires", 0) > now}
    sessions[token] = {"username": username, "expires": now + SESSION_TTL}
    _save_json(SESSIONS_FILE, sessions, private=True)
    return token

def _get_session_user(headers):
    cookie_header = headers.get("Cookie", "")
    if not cookie_header:
        return None
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header)
    except Exception:
        return None
    morsel = cookie.get(SESSION_COOKIE)
    if not morsel:
        return None
    sessions = _load_json(SESSIONS_FILE, {})
    entry = sessions.get(morsel.value)
    if not entry:
        return None
    if time.time() > entry.get("expires", 0):
        sessions.pop(morsel.value, None)
        _save_json(SESSIONS_FILE, sessions, private=True)
        return None
    return entry.get("username")

def _destroy_session_by_cookie(headers):
    cookie_header = headers.get("Cookie", "")
    if not cookie_header:
        return
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header)
    except Exception:
        return
    morsel = cookie.get(SESSION_COOKIE)
    if not morsel:
        return
    sessions = _load_json(SESSIONS_FILE, {})
    sessions.pop(morsel.value, None)
    _save_json(SESSIONS_FILE, sessions, private=True)

def _get_local_ips():
    """IPv4-адреса компьютера в локальной сети (без loopback)."""
    ips = []
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        try:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                ips.append(ip)
        except OSError:
            pass
        finally:
            s.close()
    except Exception:
        pass
    try:
        import socket
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips

def _ensure_self_signed_cert():
    """self-signed cert.pem/key.pem через openssl, SAN = localhost + локальные IP."""
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        return True
    openssl = shutil.which("openssl")
    if not openssl:
        print("⚠️  USE_HTTPS=true, но openssl не найден в PATH. "
              "Linux: sudo apt install openssl", file=sys.stderr)
        return False
    san = ",".join(["DNS:localhost"] + [f"IP:{ip}" for ip in _get_local_ips()])
    print(f"[ssl] генерирую self-signed сертификат (SAN: {san})...")
    cmd = [openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes",
           "-keyout", KEY_FILE, "-out", CERT_FILE, "-days", "3650",
           "-subj", "/CN=SlideCraft-Local", "-addext", f"subjectAltName={san}"]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=30)
        print(f"[ssl] сертификат создан:\n      {CERT_FILE}\n      {KEY_FILE}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[ssl] ошибка генерации: {e.stderr.decode(errors='replace')}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"[ssl] ошибка: {e}", file=sys.stderr)
        return False

CONFIG_FOR_FRONTEND = {
    "useProxy": True,
    "proxyUrl": "/api/chat",
    "models": {"fast": MODEL_FAST, "think": MODEL_THINK},
    "provider": AI_PROVIDER,
}

def _check_genapi_models():
    """Сверяет id моделей из .env с каталогом GenAPI.
    Неверный регистр чинит сам, неизвестный id — предупреждает.
    При недоступном каталоге просто пропускает проверку."""
    global MODEL_FAST, MODEL_THINK
    if AI_PROVIDER != "genapi" or not API_KEY or not _env_bool("GENAPI_CHECK_MODELS", True):
        return
    req = urllib.request.Request(
        GENAPI_BASE_URL + "/models",
        headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            ids = [m.get("id", "") for m in json.loads(r.read()).get("data", [])]
    except Exception as e:
        print(f"[genapi] каталог недоступен ({e}) — проверку моделей пропускаю", file=sys.stderr)
        return
    by_lower = {i.lower(): i for i in ids}
    for label, name in (("fast", MODEL_FAST), ("think", MODEL_THINK)):
        if name in ids:
            continue
        real = by_lower.get(name.lower())
        if real:
            print(f"⚠️  GENAPI_MODEL_{label.upper()}='{name}' — неверный регистр, "
                  f"исправляю на '{real}'", file=sys.stderr)
            if label == "fast":
                MODEL_FAST = real
            else:
                MODEL_THINK = real
        else:
            print(f"⚠️  GENAPI_MODEL_{label.upper()}='{name}' нет в каталоге "
                  f"({len(ids)} моделей). Список: python test.py --list", file=sys.stderr)
    CONFIG_FOR_FRONTEND["models"] = {"fast": MODEL_FAST, "think": MODEL_THINK}
    print(f"[genapi] каталог: {len(ids)} моделей, проверка id выполнена", file=sys.stderr)

def _balance_hint(text):
    """GenAPI резервирует стоимость по max_tokens. Из текста 402 считаем,
    какой потолок влезает в баланс, и подсказываем конкретное число.
    ВАЖНО: подавать сюда разобранный msg, а не сырое тело — в JSON
    символы ₽ и × приходят экранированными (\\u20bd, \\u00d7)."""
    try:
        bal = re.search(r"Balance:\s*([0-9.]+)", text)
        inp = re.search(r"input:\s*~(\d+)\s*tok\s*[×x*]\s*([0-9.]+)", text)
        out = re.search(r"output:\s*~(\d+)\s*tok\s*[×x*]\s*([0-9.]+)", text)
        if not (bal and inp and out):
            return ""
        balance = float(bal.group(1))
        left = balance - int(inp.group(1)) * float(inp.group(2)) / 1000
        fit = int(max(0.0, left) / (float(out.group(2)) / 1000) * 0.95)
        return (f" Баланс {balance:.2f}₽: уменьши GENAPI_MAX_TOKENS до {fit} "
                f"или пополни счёт (резервируется максимум, списывается по факту).")
    except Exception:
        return ""

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class Handler(BaseHTTPRequestHandler):
    # ---------- утилиты ответа ----------
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def _security_headers(self, no_store=False):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        if no_store:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
        if USE_HTTPS:
            self.send_header("Strict-Transport-Security",
                             "max-age=31536000; includeSubDomains")

    def _send(self, code, body, ctype="application/json", no_store=False):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self._security_headers(no_store=no_store)
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_with_cookie(self, code, body, cookie_str, ctype="application/json",
                          no_store=True):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        if cookie_str:
            self.send_header("Set-Cookie", cookie_str)
        self._security_headers(no_store=no_store)
        self._cors()
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _internal_error(self, e, context=""):
        err_id = secrets.token_hex(8)
        import traceback
        print(f"[error {err_id}] {context}: {traceback.format_exc()}", file=sys.stderr)
        self._send(500, json.dumps({
            "error": f"внутренняя ошибка сервера (id={err_id})"}).encode())

    def _redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self._security_headers()
        self._cors()
        self.end_headers()

    # ---------- статика ----------
    def _serve_file(self, rel):
        rel = rel.split("?", 1)[0].lstrip("/")
        if not rel:
            rel = "index.html"
        safe = os.path.normpath(os.path.join(STATIC_DIR, rel))
        try:
            real_static = os.path.realpath(STATIC_DIR)
            real_safe = os.path.realpath(safe)
        except OSError:
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        if not (real_safe == real_static or real_safe.startswith(real_static + os.sep)):
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        if not os.path.isfile(safe):
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        if os.path.basename(safe) in _PROTECTED_FILES:
            self._send(403, b"forbidden", "text/plain; charset=utf-8")
            return
        ctype, _ = mimetypes.guess_type(safe)
        with open(safe, "rb") as f:
            self._send(200, f.read(), ctype or "application/octet-stream")

    # ---------- auth ----------
    def _require_auth(self):
        user = _get_session_user(self.headers)
        if user:
            return user
        if (self.path.startswith("/api/") or self.path == "/config"
                or self.path == "/convert"):
            self._send(401, json.dumps({"error": "auth required"}).encode())
            return None
        self._redirect("/login")
        return None

    def do_GET(self):
        if self.path in ("/login", "/login.html"):
            self._serve_file("login.html")
            return
        user = self._require_auth()
        if not user:
            return
        if self.path == "/config":
            cfg = dict(CONFIG_FOR_FRONTEND)
            cfg["user"] = user
            self._send(200, json.dumps(cfg).encode(), no_store=True)
            return
        if self.path == "/api/chat":
            self._send(200, json.dumps({"ok": True, "msg": "proxy works"}).encode(),
                       no_store=True)
            return
        self._serve_file(self.path)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path == "/logout":
            if not self._require_auth():
                return
            self._handle_logout()
            return

        MAX_BODY = 50 * 1024 * 1024
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_BODY:
            self._send(413, json.dumps({
                "error": f"тело запроса слишком большое (макс {MAX_BODY // (1024*1024)} МБ)"
            }).encode())
            return
        if length <= 0:
            self._send(400, json.dumps({"error": "пустое тело запроса"}).encode())
            return
        body = self.rfile.read(length)

        if self.path == "/register":
            if not self._check_rate_limit("register"):
                self._send(429, json.dumps({
                    "error": "слишком много регистраций, попробуй через минуту"}).encode())
                return
            self._handle_register(body)
            return
        if self.path == "/login":
            if not self._check_rate_limit("login"):
                self._send(429, json.dumps({
                    "error": "слишком много попыток входа, попробуй через минуту"}).encode())
                return
            self._handle_login(body)
            return

        user = self._require_auth()
        if not user:
            return

        if self.path == "/api/chat":
            if not self._check_rate_limit("chat", max_attempts=20, window_sec=60):
                self._send(429, json.dumps({
                    "error": "слишком много запросов к ИИ, попробуй через минуту"}).encode())
                return
            self._forward_chat(body, user)
            return
        if self.path == "/convert":
            if not self._check_rate_limit("convert", max_attempts=5, window_sec=60):
                self._send(429, json.dumps({
                    "error": "слишком много конвертаций, попробуй через минуту"}).encode())
                return
            self._convert_pptx_to_odp(body)
            return
        self._send(404, json.dumps({"error": "not found"}).encode())

    # ---------- rate limiting ----------
    _rate_buckets = {}
    _rate_lock = threading.Lock()
    _rate_cleanup_counter = 0

    def _check_rate_limit(self, action, max_attempts=10, window_sec=60):
        fwd = self.headers.get("X-Forwarded-For", "")
        ip = (fwd.split(",")[0].strip() if fwd else self.client_address[0]) or "unknown"
        key = (action, ip)
        now = time.time()
        with Handler._rate_lock:
            events = [t for t in Handler._rate_buckets.get(key, []) if now - t < window_sec]
            if len(events) >= max_attempts:
                Handler._rate_buckets[key] = events
                return False
            events.append(now)
            Handler._rate_buckets[key] = events
            Handler._rate_cleanup_counter += 1
            if Handler._rate_cleanup_counter >= 1000:
                Handler._rate_cleanup_counter = 0
                cutoff = now - window_sec
                Handler._rate_buckets = {k: v for k, v in Handler._rate_buckets.items()
                                         if any(t > cutoff for t in v)}
            return True

    # ---------- auth-обработчики ----------
    def _handle_register(self, body):
        try:
            data = json.loads(body)
            username = (data.get("username") or "").strip()
            password = data.get("password") or ""
        except Exception:
            self._send(400, json.dumps({"error": "Некорректный запрос"}).encode())
            return
        if len(username) < 3:
            self._send(400, json.dumps({"error": "Имя пользователя минимум 3 символа"}).encode())
            return
        if len(username) > 32:
            self._send(400, json.dumps({"error": "Имя пользователя максимум 32 символа"}).encode())
            return
        if len(password) < 8:
            self._send(400, json.dumps({"error": "Пароль минимум 8 символов"}).encode())
            return
        if len(password) > 1024:
            self._send(400, json.dumps({"error": "Пароль слишком длинный (макс 1024 символа)"}).encode())
            return
        if not all(c.isalnum() or c in "._-@" for c in username):
            self._send(400, json.dumps({
                "error": "В имени пользователя допустимы только буквы, цифры и . _ - @"}).encode())
            return

        users = _load_json(USERS_FILE, {})
        if username in users:
            print(f"[auth] register on existing username (silent): {username}", file=sys.stderr)
            self._send(200, json.dumps({"ok": True, "user": username}).encode())
            return

        salt_hex, hash_hex = _hash_password(password)
        users[username] = {"salt": salt_hex, "hash": hash_hex,
                           "iterations": PBKDF2_ITERS, "created": time.time()}
        _save_json(USERS_FILE, users, private=True)
        token = _create_session(username)
        cookie = f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={SESSION_TTL}; SameSite=Strict"
        if USE_HTTPS:
            cookie += "; Secure"
        self._send_with_cookie(200, json.dumps({"ok": True, "user": username}).encode(), cookie)
        print(f"[auth] registered: {username}", file=sys.stderr)

    def _handle_login(self, body):
        try:
            data = json.loads(body)
            username = (data.get("username") or "").strip()
            password = data.get("password") or ""
        except Exception:
            self._send(400, json.dumps({"error": "Некорректный запрос"}).encode())
            return
        users = _load_json(USERS_FILE, {})
        user = users.get(username)
        if not isinstance(user, dict) or "salt" not in user or "hash" not in user:
            self._send(401, json.dumps({"error": "Неверное имя пользователя или пароль"}).encode())
            return
        if not _verify_password(password, user["salt"], user["hash"],
                                user.get("iterations", PBKDF2_ITERS)):
            self._send(401, json.dumps({"error": "Неверное имя пользователя или пароль"}).encode())
            return
        token = _create_session(username)
        cookie = f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={SESSION_TTL}; SameSite=Strict"
        if USE_HTTPS:
            cookie += "; Secure"
        self._send_with_cookie(200, json.dumps({"ok": True, "user": username}).encode(), cookie)
        print(f"[auth] login: {username}", file=sys.stderr)

    def _handle_logout(self):
        _destroy_session_by_cookie(self.headers)
        cookie = f"{SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict"
        if USE_HTTPS:
            cookie += "; Secure"
        self._send_with_cookie(200, json.dumps({"ok": True}).encode(), cookie)

    # ---------- чат: ключ живёт на сервере ----------
    def _forward_chat(self, body, user):
        if not API_KEY:
            self._send(503, json.dumps({
                "error": "Ключ ИИ не задан на сервере. Заполни .env рядом с main.py"
            }).encode())
            return
        try:
            payload = json.loads(body)
        except Exception:
            self._send(400, json.dumps({"error": "bad json body"}).encode())
            return

        mode = payload.pop("_mode", "fast")
        payload["model"] = MODEL_THINK if mode == "think" else MODEL_FAST
        payload["stream"] = False   # прокси буферизует ответ, стрим фронт не умеет

        is_gigachat = AI_PROVIDER == "gigachat"
        openai_like = AI_PROVIDER in ("genapi", "groq", "openai", "gigachat")

        if openai_like:
            # вычищаем ollama-специфичные поля, которые шлёт core.js
            payload.pop("format", None)
            payload.pop("keep_alive", None)
            opts = payload.pop("options", None) or {}
            if "temperature" not in payload and "temperature" in opts:
                payload["temperature"] = opts["temperature"]
            if USE_JSON_RESPONSE_FORMAT and not is_gigachat:
                payload["response_format"] = {"type": "json_object"}
        else:
            payload.setdefault("format", "json")

        if AI_PROVIDER == "genapi":
            # GenAPI резервирует стоимость по max_tokens — держим потолок в рамках баланса
            if MAX_TOKENS > 0:
                payload.setdefault("max_tokens", MAX_TOKENS)
            # «Раздумия» = та же модель, но с включённым рассуждением
            if mode == "think" and REASONING_THINK:
                payload["reasoning_effort"] = REASONING_THINK

        if SEARCH_ENABLED and SEARCH_AVAILABLE:
            self._augment_with_search(payload, user)

        body = json.dumps(payload).encode()

        if is_gigachat:
            token = _get_gigachat_token()
            if not token:
                self._send(503, json.dumps({
                    "error": "Не удалось получить токен GigaChat. Проверь ключ в .env"}).encode())
                return
            auth_value = f"Bearer {token}"
        else:
            auth_value = f"Bearer {API_KEY}"

        ssl_ctx = None
        if is_gigachat or (AI_URL.startswith("https") and not VERIFY_SSL):
            ssl_ctx = ssl.create_default_context()
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl.CERT_NONE

        req = urllib.request.Request(
            AI_URL, data=body, method="POST",
            headers={"Content-Type": "application/json",
                     "Accept": "application/json",
                     "Authorization": auth_value})
        try:
            with urllib.request.urlopen(req, timeout=AI_TIMEOUT, context=ssl_ctx) as r:
                resp_bytes = r.read()

            if openai_like:
                try:
                    raw = json.loads(resp_bytes)
                    if isinstance(raw, list) and raw:
                        raw = raw[0]
                    content = (raw.get("choices") or [{}])[0] \
                        .get("message", {}).get("content", "")
                    usage = raw.get("usage") or {}
                    cost = raw.get("cost")
                    print(f"[{AI_PROVIDER}] user={user} mode={mode} model={payload['model']} "
                          f"tokens={usage.get('total_tokens', '?')}"
                          + (f" cost={cost}₽" if cost is not None else ""), file=sys.stderr)
                    if not content:
                        self._send(502, json.dumps({
                            "error": "Модель вернула пустой ответ — попробуй другую модель в .env"
                        }).encode())
                        return
                    resp_bytes = json.dumps(
                        {"message": {"content": content}, "done": True}).encode()
                except Exception as e:
                    print(f"[ai] не разобрал ответ провайдера: {e}", file=sys.stderr)
            self._send(200, resp_bytes)

        except urllib.error.HTTPError as e:
            code = e.code
            raw_err = e.read()
            text = raw_err.decode("utf-8", errors="replace")
            print(f"[ai] HTTP {code} от {AI_URL} (model={payload.get('model')}): {text[:500]}",
                  file=sys.stderr)
            try:
                d = json.loads(raw_err)
                err = d.get("error")
                msg = err.get("message", "") if isinstance(err, dict) else str(err or "")
                if not msg and isinstance(d.get("errors_validation"), dict):
                    msg = json.dumps(d["errors_validation"], ensure_ascii=False)[:300]
            except Exception:
                msg = text[:300]
            # подсказку считаем по разобранному msg: в сыром JSON ₽ и × экранированы
            hint = _balance_hint(msg or text) if code == 402 else ""
            if hint:
                print(f"[ai]{hint}", file=sys.stderr)
            # ЛЮБОЙ отказ провайдера отдаём как 502: иначе 401 уведёт браузер
            # на /login, а 402/410/429 фронт покажет сырым JSON.
            self._send(502, json.dumps({
                "error": f"ИИ-провайдер вернул {code}: {msg or text[:200]}{hint}"}).encode())
        except urllib.error.URLError as e:
            print(f"[ai] нет соединения с {AI_URL}: {e.reason}", file=sys.stderr)
            self._send(502, json.dumps({
                "error": f"Нет соединения с ИИ-провайдером ({AI_URL}): {e.reason}"}).encode())
        except Exception as e:
            self._internal_error(e, context=f"_forward_chat user={user}")

    def _augment_with_search(self, payload, user):
        """Веб-поиск по теме презентации -> контекст в system message."""
        messages = payload.get("messages") or []
        if not messages:
            return
        last_user = None
        for msg in reversed(messages):
            if isinstance(msg, dict) and msg.get("role") == "user":
                last_user = msg.get("content", "")
                break
        if not last_user:
            return
        m = re.search(r'на тему:\s*"([^"]+)"', last_user)
        if not m:
            return
        topic = m.group(1).strip()
        if len(topic) < 3:
            return
        comp_match = re.search(r"Компании для сравнения:\s*([^\n]+)", last_user)
        queries = [topic]
        if comp_match:
            companies_str = comp_match.group(1).strip().rstrip(".")
            for c in [c.strip() for c in companies_str.split(",") if c.strip()][:3]:
                queries.append(f"{c} компания выручка сотрудники 2024")

        all_results = []
        for q in queries[:2]:
            try:
                rs = search_web(q, max_results=SEARCH_MAX_RESULTS, region=SEARCH_REGION)
                if rs:
                    all_results.extend(rs)
                    if len(all_results) >= SEARCH_MAX_RESULTS * 2:
                        break
            except Exception as e:
                print(f"[search] query '{q}' failed: {e}", file=sys.stderr)
        if not all_results:
            print(f"[search] no results for topic: {topic}", file=sys.stderr)
            return

        seen_urls, unique = set(), []
        for r in all_results:
            u = r.get("url", "")
            if u and u in seen_urls:
                continue
            if u:
                seen_urls.add(u)
            unique.append(r)
        unique = unique[:SEARCH_MAX_RESULTS * 2]

        context = format_for_prompt(unique, topic)
        if not context:
            return
        injected = False
        for msg in messages:
            if isinstance(msg, dict) and msg.get("role") == "system":
                msg["content"] = (msg.get("content", "") + "\n\n" + context).strip()
                injected = True
                break
        if not injected:
            messages.insert(0, {"role": "system", "content": context})
        payload["messages"] = messages
        print(f"[search] user={user} topic='{topic}' results={len(unique)}", file=sys.stderr)

    # ---------- конвертация PPTX -> ODP ----------
    _convert_sem = threading.BoundedSemaphore(2)

    def _convert_pptx_to_odp(self, body):
        sem = Handler._convert_sem
        if not sem.acquire(timeout=5):
            self._send(503, json.dumps({
                "error": "конвертация занята, попробуй позже"}).encode())
            return
        try:
            self._do_convert(body)
        finally:
            sem.release()

    def _do_convert(self, body):
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
                "error": "LibreOffice не найден. sudo apt install libreoffice-impress"}).encode())
            return
        try:
            with tempfile.TemporaryDirectory() as td:
                src = os.path.join(td, "in.pptx")
                with open(src, "wb") as f:
                    f.write(filedata)
                subprocess.run([soffice, "--headless", "--convert-to", "odp",
                                "--outdir", td, src], capture_output=True, timeout=180)
                out = os.path.join(td, "in.odp")
                if not os.path.exists(out):
                    self._send(500, json.dumps({"error": "конвертация не удалась"}).encode())
                    return
                with open(out, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type",
                                 "application/vnd.oasis.opendocument.presentation")
                self._security_headers()
                self._cors()
                self.end_headers()
                self.wfile.write(data)
        except Exception as e:
            self._internal_error(e, context="_convert_pptx_to_odp")

    def log_message(self, fmt, *args):
        try:
            msg = fmt % args
        except Exception:
            return
        if "Bad request version" in msg or "Bad request syntax" in msg:
            return
        try:
            msg.encode("ascii")
        except UnicodeEncodeError:
            return
        print("[proxy]", msg)

if __name__ == "__main__":
    protocol = "https" if USE_HTTPS else "http"
    print(f"SlideCraft на {protocol}://{BIND_HOST}:{BIND_PORT}/  (chat + config + static + auth + search)")
    print(f"  ai provider = {AI_PROVIDER}")
    print(f"  ai url      = {AI_URL}")
    print(f"  model.fast  = {MODEL_FAST}")
    print(f"  model.think = {MODEL_THINK}")
    print(f"  key set     = {bool(API_KEY)}")
    print(f"  max tokens  = {MAX_TOKENS or 'без лимита'}")
    print(f"  reasoning   = {REASONING_THINK or 'выкл'} (режим «Раздумия»)")
    print(f"  ai timeout  = {AI_TIMEOUT}s")
    print(f"  json mode   = {'response_format' if USE_JSON_RESPONSE_FORMAT else 'prompt-only'}")
    print(f"  web search  = {'on' if (SEARCH_ENABLED and SEARCH_AVAILABLE) else 'off'}"
          + (f" (region={SEARCH_REGION}, max={SEARCH_MAX_RESULTS})"
             if (SEARCH_ENABLED and SEARCH_AVAILABLE) else ""))
    print(f"  https       = {'on (self-signed)' if USE_HTTPS else 'off'}")
    print(f"  users       = {len(_load_json(USERS_FILE, {}))}")
    print(f"  first open  -> /login")

    _check_genapi_models()

    if BIND_HOST == "0.0.0.0":
        print()
        print("📡 Сервер доступен в локальной сети. Зайди с телефона:")
        for ip in _get_local_ips():
            print(f"   {protocol}://{ip}:{BIND_PORT}/")
        if USE_HTTPS:
            print("🔒 Self-signed сертификат: на телефоне «Дополнительно → Перейти на сайт».")
        else:
            print("⚠️  Мобильные браузеры пробуют HTTPS — вводи адрес с явным http://")
        print(f"Если телефон не подключается: sudo ufw allow {BIND_PORT}/tcp")

    httpd = ThreadedHTTPServer((BIND_HOST, BIND_PORT), Handler)
    if USE_HTTPS:
        if not _ensure_self_signed_cert():
            print("⚠️  Не удалось создать сертификат. Запускаю без HTTPS.")
        else:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(CERT_FILE, KEY_FILE)
            httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
            print(f"[ssl] слушаю HTTPS на {BIND_HOST}:{BIND_PORT}")
    httpd.serve_forever()
