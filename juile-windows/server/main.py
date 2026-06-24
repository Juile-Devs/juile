"""FastAPI server + WebSocket bridge + native window launcher."""
import asyncio
import os
import re
import subprocess
import uuid

from fastapi import FastAPI, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import agent, config, providers, overlay, store

# Spoken-voice personas for TTS (Settings -> Voice & tone). Each maps to an
# edge-tts neural voice with its own rate/pitch character so Juile sounds alive
# and personal, not like one flat robot. `voice` values are validated server-side.
VOICES = [
    {"id": "aria", "name": "Aria", "tag": "Warm & calm", "voice": "en-US-AriaNeural", "rate": "+0%", "pitch": "+0Hz"},
    {"id": "jenny", "name": "Jenny", "tag": "Friendly", "voice": "en-US-JennyNeural", "rate": "+4%", "pitch": "+0Hz"},
    {"id": "nova", "name": "Nova", "tag": "Bright & upbeat", "voice": "en-US-MichelleNeural", "rate": "+7%", "pitch": "+12Hz"},
    {"id": "pixie", "name": "Pixie", "tag": "Playful spark", "voice": "en-US-AnaNeural", "rate": "+9%", "pitch": "+22Hz"},
    {"id": "atlas", "name": "Atlas", "tag": "Deep & steady", "voice": "en-US-ChristopherNeural", "rate": "-4%", "pitch": "-6Hz"},
    {"id": "guy", "name": "Guy", "tag": "Confident", "voice": "en-US-GuyNeural", "rate": "+2%", "pitch": "+0Hz"},
    {"id": "sage", "name": "Sage", "tag": "Soft & thoughtful", "voice": "en-US-EricNeural", "rate": "-6%", "pitch": "+0Hz"},
    {"id": "sterling", "name": "Sterling", "tag": "Smooth radio", "voice": "en-US-RogerNeural", "rate": "+0%", "pitch": "-2Hz"},
    {"id": "sonia", "name": "Sonia", "tag": "British, refined", "voice": "en-GB-SoniaNeural", "rate": "+0%", "pitch": "+0Hz"},
    {"id": "ryan", "name": "Ryan", "tag": "British, easy", "voice": "en-GB-RyanNeural", "rate": "+0%", "pitch": "-2Hz"},
    {"id": "matilda", "name": "Matilda", "tag": "Aussie bright", "voice": "en-AU-NatashaNeural", "rate": "+3%", "pitch": "+4Hz"},
]
_VOICE_IDS = {v["voice"] for v in VOICES}
_RATE_RE = re.compile(r"^[+-]\d{1,3}%$")
_PITCH_RE = re.compile(r"^[+-]\d{1,3}Hz$")

app = FastAPI(title="Juile")

TEXT_EXTS = {".txt", ".md", ".py", ".js", ".ts", ".json", ".csv", ".html", ".css",
             ".log", ".yaml", ".yml", ".xml", ".java", ".c", ".cpp", ".rs", ".go", ".sh"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
IMAGE_MT = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp"}


@app.get("/api/config")
async def api_config():
    provs = []
    for key, p in config.PROVIDERS.items():
        provs.append({
            "key": key,
            "label": p["label"],
            "configured": providers.is_configured(key),
            "models": p["models"],
            "fields": p.get("fields", []),
            "style": p.get("style", "openai"),
            "local": p.get("local", False),
        })
    return {
        "providers": provs,
        "default_provider": config.DEFAULT_PROVIDER,
        "default_model": config.DEFAULT_MODEL,
        "permission_mode": config.PERMISSION_MODE,
        "lan_url": f"http://{config.lan_ip()}:{config.PORT}",
        "port": config.PORT,
    }


@app.get("/api/models")
async def api_models(provider: str):
    return {"models": await providers.list_models(provider)}


@app.get("/api/settings")
async def api_settings_get():
    return store.load()


@app.post("/api/settings")
async def api_settings_post(request: Request):
    return store.save(await request.json())


@app.post("/api/title")
async def api_title(request: Request):
    """Let Juile name a conversation from its first exchange (2-4 words)."""
    data = await request.json()
    provider = data.get("provider") or config.DEFAULT_PROVIDER
    model = data.get("model") or config.DEFAULT_MODEL
    msgs = data.get("messages") or []

    def _txt(c):
        if isinstance(c, list):
            return " ".join(p.get("text", "") for p in c if isinstance(p, dict) and p.get("type") == "text")
        return str(c or "")

    convo = "\n".join(f"{m.get('role')}: {_txt(m.get('content'))[:400]}" for m in msgs[:4])
    first_user = next((_txt(m.get("content")) for m in msgs if m.get("role") == "user"), "")
    prompt = [
        {"role": "system", "content": "Generate a 2-5 word Title Case label for the chat topic. Output ONLY the title text — no quotes, no punctuation, no 'Title:' prefix, no explanation, no reasoning."},
        {"role": "user", "content": f"Conversation:\n{convo}\n\nTitle:"},
    ]
    title = ""
    try:
        content, _ = await providers.complete(provider, model, prompt, None, 0.3, lambda t: None)
        title = _clean_title(content)
    except Exception:
        title = ""
    if not title:
        title = _clean_title(first_user) or "New Chat"
    return {"title": title}


def _clean_title(s: str) -> str:
    lines = [l.strip(" \"'`*#").strip() for l in str(s or "").splitlines() if l.strip()]
    out = next((l for l in lines if 0 < len(l.split()) <= 8), lines[0] if lines else "")
    low = out.lower()
    for pre in ("title:", "chat title:", "conversation title:", "here's a title:", "here is a title:", "sure,", "the title is"):
        if low.startswith(pre):
            out = out[len(pre):].strip(" \"'`:").strip()
            low = out.lower()
    out = out.strip(" \"'`").rstrip(".!?,:;").strip()
    words = out.split()
    if len(words) > 7:
        out = " ".join(words[:7])
    return out[:48]


@app.get("/api/skills")
async def api_skills():
    out = []
    for f in sorted(config.SKILLS_DIR.glob("*.md")):
        lines = f.read_text(encoding="utf-8", errors="ignore").splitlines()
        title = next((l.lstrip("# ").strip() for l in lines if l.strip()), f.stem)
        out.append({"name": f.stem, "title": title})
    return {"skills": out}


def _safe_skill(name: str) -> str:
    return "".join(c for c in (name or "").strip().lower() if c.isalnum() or c in "-_").strip("-_")


@app.post("/api/skills/save")
async def api_skill_save(request: Request):
    data = await request.json()
    name = _safe_skill(data.get("name"))
    if not name:
        return {"ok": False, "error": "name required"}
    (config.SKILLS_DIR / f"{name}.md").write_text(data.get("content") or "", encoding="utf-8")
    return {"ok": True, "name": name}


@app.post("/api/skills/delete")
async def api_skill_delete(request: Request):
    name = _safe_skill((await request.json()).get("name"))
    f = config.SKILLS_DIR / f"{name}.md"
    if name and f.exists():
        f.unlink()
        return {"ok": True}
    return {"ok": False}


@app.get("/api/weather")
async def api_weather():
    import httpx
    try:
        async with httpx.AsyncClient(timeout=12) as c:
            r = await c.get("https://wttr.in/?format=j1", headers={"User-Agent": "curl/8"})
            if r.status_code == 200:
                d = r.json()
                cur = (d.get("current_condition") or [{}])[0]
                area = (d.get("nearest_area") or [{}])[0]
                city = area["areaName"][0].get("value", "") if area.get("areaName") else ""
                desc = cur["weatherDesc"][0].get("value", "") if cur.get("weatherDesc") else ""
                return {"ok": True, "city": city, "tempC": cur.get("temp_C"), "tempF": cur.get("temp_F"),
                        "desc": desc, "feels": cur.get("FeelsLikeC"), "humidity": cur.get("humidity")}
    except Exception:
        pass
    return {"ok": False}


@app.get("/api/markets")
async def api_markets():
    import httpx
    try:
        async with httpx.AsyncClient(timeout=12) as c:
            r = await c.get("https://api.coingecko.com/api/v3/simple/price",
                            params={"ids": "bitcoin,ethereum,solana", "vs_currencies": "usd", "include_24hr_change": "true"})
            if r.status_code == 200:
                d = r.json()
                out = []
                for k, label, sym in (("bitcoin", "Bitcoin", "BTC"), ("ethereum", "Ethereum", "ETH"), ("solana", "Solana", "SOL")):
                    v = d.get(k) or {}
                    if v:
                        out.append({"name": label, "sym": sym, "price": v.get("usd"), "chg": v.get("usd_24h_change")})
                return {"ok": True, "items": out}
    except Exception:
        pass
    return {"ok": False}


@app.get("/api/files")
async def api_files():
    out = []
    for f in sorted(config.WORKSPACE.glob("*")):
        if f.is_file() and f.suffix.lower() not in (".json",):
            out.append({"name": f.name, "ext": f.suffix.lower().lstrip(".")})
    for f in sorted(config.UPLOADS.glob("*")):
        if f.is_file():
            out.append({"name": f.name, "ext": f.suffix.lower().lstrip(".")})
    return {"files": out}


@app.get("/api/reveal")
async def api_reveal(name: str):
    import subprocess
    target = config.WORKSPACE / name
    if not target.exists():
        target = config.UPLOADS / name
    if target.exists():
        subprocess.Popen(["explorer", "/select,", str(target)])
        return {"ok": True}
    return {"ok": False}


@app.get("/api/diff")
async def api_diff(name: str):
    from .tools import _DIFFS
    return {"name": name, "diff": _DIFFS.get(name, "")}


@app.get("/api/day")
async def api_day():
    import datetime
    today = datetime.date.today()
    base = [
        {"time": "09:00", "title": "Review priorities for the day", "done": False},
        {"time": "10:30", "title": "Deep work block", "done": False},
        {"time": "13:00", "title": "Inbox and messages", "done": False},
        {"time": "15:00", "title": "Build / ship the main task", "done": False},
        {"time": "17:30", "title": "Wrap up and plan tomorrow", "done": False},
    ]
    return {"date": today.isoformat(), "items": base}


@app.get("/api/voices")
async def api_voices():
    """The spoken-voice personas the UI offers."""
    return {"voices": VOICES}


@app.get("/api/tts")
async def api_tts(text: str, voice: str = "en-US-AriaNeural", rate: str = "+0%", pitch: str = "+0Hz"):
    """High-quality neural TTS via edge-tts (free, no key). Personalized per the
    chosen persona's voice + rate + pitch. Returns MP3 bytes."""
    try:
        import edge_tts
    except ImportError:
        return Response(status_code=503, content=b"edge-tts not installed")
    text = (text or "").strip()[:1500]
    if not text:
        return Response(status_code=204)
    if voice not in _VOICE_IDS:
        voice = "en-US-AriaNeural"
    if not _RATE_RE.match(rate or ""):
        rate = "+0%"
    if not _PITCH_RE.match(pitch or ""):
        pitch = "+0Hz"
    try:
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        audio = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.extend(chunk["data"])
        return Response(content=bytes(audio), media_type="audio/mpeg")
    except Exception as e:
        return Response(status_code=502, content=str(e).encode())


@app.post("/api/connector/auth")
async def api_connector_auth(request: Request):
    """Authenticate / verify one connector at the spot (Settings -> Connectors)."""
    from . import tools
    name = (await request.json()).get("name", "")
    return await tools.connector_auth(name)


@app.get("/api/peers")
async def api_peers():
    """How many clients (PC + phone) are connected — drives the Remote Control status."""
    return {"peers": len(CONNECTIONS)}


def _gh_bin() -> str:
    import shutil
    return shutil.which("gh") or shutil.which("gh.exe") or ""


async def _run_cli(argv, timeout=30):
    return await asyncio.to_thread(lambda: subprocess.run(argv, capture_output=True, text=True, timeout=timeout))


@app.get("/api/github/status")
async def api_github_status():
    gh = _gh_bin()
    if not gh:
        return {"ok": False, "message": "GitHub CLI (gh) isn't installed. Get it at cli.github.com, then click Authenticate."}
    try:
        r = await _run_cli([gh, "api", "user", "--jq", ".login"])
        user = (r.stdout or "").strip()
        if r.returncode == 0 and user:
            return {"ok": True, "user": user, "active": store.load().get("github_repo", "")}
    except Exception as e:
        return {"ok": False, "message": f"gh error: {str(e)[:160]}"}
    return {"ok": False, "message": "Not signed in to GitHub yet. Click Authenticate to sign in."}


@app.post("/api/github/auth")
async def api_github_auth():
    gh = _gh_bin()
    if not gh:
        return {"ok": False, "message": "Install GitHub CLI (gh) from cli.github.com first, then click Authenticate."}
    try:
        r = await _run_cli([gh, "api", "user", "--jq", ".login"])
        if r.returncode == 0 and (r.stdout or "").strip():
            return {"ok": True, "user": r.stdout.strip()}
    except Exception:
        pass
    try:                                   # pop a terminal so the user can finish the interactive web login
        if os.name == "nt":
            subprocess.Popen(["cmd", "/c", "start", "GitHub Login", "cmd", "/k",
                              gh, "auth", "login", "--web", "--git-protocol", "https"])
        else:
            subprocess.Popen([gh, "auth", "login", "--web", "--git-protocol", "https"])
    except Exception as e:
        return {"ok": False, "message": f"Couldn't start gh login: {str(e)[:160]}"}
    return {"ok": False, "message": "A terminal opened — finish signing in to GitHub there (a browser will pop up), then click Authenticate again."}


@app.get("/api/github/repos")
async def api_github_repos():
    gh = _gh_bin()
    if not gh:
        return {"repos": []}
    try:
        import json as _json
        r = await _run_cli([gh, "repo", "list", "--limit", "50", "--json", "nameWithOwner"])
        data = _json.loads(r.stdout or "[]")
        return {"repos": [x.get("nameWithOwner") for x in data if x.get("nameWithOwner")]}
    except Exception:
        return {"repos": []}


@app.post("/api/github/select")
async def api_github_select(request: Request):
    repo = (await request.json()).get("repo", "")
    store.save({"github_repo": repo})
    return {"ok": True, "repo": repo}


@app.get("/api/claude/check")
async def api_claude_check():
    """Verify the Claude (Account-Based) connector — is the CLI installed & ready?"""
    binary = providers._claude_binary()
    if not binary:
        return {"ok": False, "message": "Claude CLI not found. Install Claude Code (npm i -g "
                "@anthropic-ai/claude-code), then run `claude` once to sign in to your account."}
    argv = (["cmd", "/c", binary, "--version"] if os.name == "nt" else [binary, "--version"])
    try:
        r = await asyncio.to_thread(lambda: subprocess.run(argv, capture_output=True, text=True, timeout=30))
        ver = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()
        ver = ver[0] if ver else ""
        if r.returncode == 0:
            return {"ok": True, "message": f"Ready — {ver or 'Claude CLI installed'}. Uses your Claude account login, no API key."}
        return {"ok": False, "message": f"Claude CLI found but errored: {(r.stderr or '').strip()[:200]}"}
    except Exception as e:
        return {"ok": False, "message": f"Couldn't run Claude CLI: {str(e)[:200]}"}


@app.post("/api/upload")
async def api_upload(file: UploadFile):
    dest = config.UPLOADS / file.filename
    data = await file.read()
    dest.write_bytes(data)
    ext = dest.suffix.lower()
    text, image = "", ""
    if ext in IMAGE_EXTS:
        import base64
        image = f"data:{IMAGE_MT.get(ext, 'image/png')};base64," + base64.b64encode(data).decode()
    elif ext in TEXT_EXTS:
        try:
            text = dest.read_text(encoding="utf-8", errors="ignore")[:8000]
        except Exception:
            text = ""
    return {"name": file.filename, "path": str(dest), "text": text, "image": image, "is_image": bool(image)}


CONNECTIONS = set()


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    CONNECTIONS.add(websocket)
    state = {
        "conversation": [],
        "settings": {
            "provider": config.DEFAULT_PROVIDER,
            "model": config.DEFAULT_MODEL,
            "permission_mode": config.PERMISSION_MODE,
            "effort": "medium",
            "imode": "agent",
            "speed": "extended",
        },
        "pending": {},
        "task": None,
        "convs": {},     # conv_id -> conversation list (parallel tasks)
        "tasks": {},     # conv_id -> asyncio.Task
        "active": None,
    }
    await websocket.send_json({"type": "hello", "settings": state["settings"]})

    async def emit(event):
        await websocket.send_json(event)

    async def ask_permission(tool, args):
        rid = uuid.uuid4().hex
        fut = asyncio.get_event_loop().create_future()
        state["pending"][rid] = fut
        await websocket.send_json({"type": "permission_request", "id": rid, "tool": tool, "args": args})
        try:
            return bool(await asyncio.wait_for(fut, timeout=300))
        except asyncio.TimeoutError:
            return False

    async def ask_user(spec):
        rid = uuid.uuid4().hex
        fut = asyncio.get_event_loop().create_future()
        state["pending"][rid] = fut
        await websocket.send_json({"type": "ask", "id": rid, "spec": spec})
        try:
            answers = await asyncio.wait_for(fut, timeout=600)
        except asyncio.TimeoutError:
            return "User did not answer (timed out)."
        if not answers:
            return "User skipped the questions."
        return "User answered:\n" + "\n".join(f"- {q}: {a}" for q, a in answers.items())

    try:
        while True:
            msg = await websocket.receive_json()
            kind = msg.get("type")

            if kind == "chat":
                cid = msg.get("conv_id")
                for f in ("provider", "model", "permission_mode", "effort", "imode", "speed"):
                    if msg.get(f):
                        state["settings"][f] = msg[f]
                text = msg.get("text", "")
                atts = msg.get("attachments", []) or []
                images = [a for a in atts if a.get("is_image") and a.get("image")]
                for att in atts:
                    if not att.get("is_image"):
                        text += f"\n\n[Attached file: {att.get('name')}]\n{att.get('text', '')}"
                if images:
                    user_msg = {"role": "user", "content": [{"type": "text", "text": text or "What's in this image?"}]
                                + [{"type": "image_url", "image_url": {"url": a["image"]}} for a in images]}
                else:
                    user_msg = {"role": "user", "content": text}
                settings_copy = dict(state["settings"])
                if cid:
                    # parallel: an independent task per conversation; others keep running
                    conv = state["convs"].setdefault(cid, [])
                    conv.append(user_msg)
                    state["active"] = state.get("active") or cid
                    old = state["tasks"].get(cid)
                    if old and not old.done():
                        old.cancel()

                    def make_emit(c):
                        async def _e(ev):
                            ev = dict(ev)
                            ev["conv_id"] = c
                            await websocket.send_json(ev)
                        return _e

                    state["tasks"][cid] = asyncio.create_task(
                        agent.run_agent(conv, settings_copy, make_emit(cid), ask_permission, ask_user))
                else:
                    if state["task"] and not state["task"].done():
                        state["task"].cancel()
                        overlay.hide()
                    state["conversation"].append(user_msg)
                    state["task"] = asyncio.create_task(
                        agent.run_agent(state["conversation"], settings_copy, emit, ask_permission, ask_user))

            elif kind == "permission":
                fut = state["pending"].pop(msg.get("id"), None)
                if fut and not fut.done():
                    fut.set_result(msg.get("approve", False))

            elif kind == "answer":
                fut = state["pending"].pop(msg.get("id"), None)
                if fut and not fut.done():
                    fut.set_result(msg.get("answers") or {})

            elif kind == "settings":
                for f in ("provider", "model", "permission_mode", "effort", "imode", "speed"):
                    if msg.get(f):
                        state["settings"][f] = msg[f]
                await emit({"type": "settings", "settings": state["settings"]})

            elif kind == "load":
                # switch conversation: adopt its history. Do NOT cancel other running
                # tasks — switching away keeps a conversation's task running in parallel.
                cid = msg.get("conv_id")
                conv = [
                    {"role": m.get("role", "user"), "content": str(m.get("content", ""))}
                    for m in (msg.get("messages") or []) if m.get("role") in ("user", "assistant")
                ]
                if cid:
                    state["convs"][cid] = conv
                    state["active"] = cid
                state["conversation"] = conv

            elif kind == "stop":
                cid = msg.get("conv_id")
                if cid and state["tasks"].get(cid):
                    t = state["tasks"].get(cid)
                    if t and not t.done():
                        t.cancel()
                else:
                    if state["task"] and not state["task"].done():
                        state["task"].cancel()
                    for t in list(state["tasks"].values()):
                        if t and not t.done():
                            t.cancel()
                overlay.hide()
                await emit({"type": "stopped"})
                await emit({"type": "done"})

            elif kind == "relay":
                # voice from the phone -> push the transcribed text to every other client (the PC)
                text = msg.get("text", "")
                for c in list(CONNECTIONS):
                    if c is not websocket:
                        try:
                            await c.send_json({"type": "remote_text", "text": text, "send": msg.get("send", True)})
                        except Exception:
                            pass

    except WebSocketDisconnect:
        if state["task"] and not state["task"].done():
            state["task"].cancel()
        for t in list(state["tasks"].values()):
            if t and not t.done():
                t.cancel()
    except Exception:
        pass
    finally:
        CONNECTIONS.discard(websocket)


# Screenshots Juile captures (served so the UI can show them).
app.mount("/shots", StaticFiles(directory=str(config.WORKSPACE)), name="shots")
# Files Juile creates (downloadable via file cards).
app.mount("/files", StaticFiles(directory=str(config.WORKSPACE)), name="files")
# Static frontend (mounted last so /api and /ws win).
app.mount("/", StaticFiles(directory=str(config.WEB_DIR), html=True), name="web")


def _make_qr():
    try:
        import qrcode
        url = f"http://{config.lan_ip()}:{config.PORT}"
        qrcode.make(url).save(str(config.WEB_DIR / "qr.png"))
    except Exception:
        pass


def _apply_window_icon():
    """Best-effort: replace the default Python icon with Juile's J on the
    Windows titlebar + taskbar. pywebview gives no portable icon hook, so we
    find the window by title and set it via the Win32 API once it appears."""
    ico = config.WEB_DIR / "juile.ico"
    if os.name != "nt" or not ico.exists():
        return
    import ctypes
    import threading
    import time as _t
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(ctypes.c_wchar_p("Juile.App"))
    except Exception:
        pass

    def _set():
        u = ctypes.windll.user32
        u.FindWindowW.restype = ctypes.c_void_p
        u.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
        u.LoadImageW.restype = ctypes.c_void_p
        u.LoadImageW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint,
                                 ctypes.c_int, ctypes.c_int, ctypes.c_uint]
        u.SendMessageW.restype = ctypes.c_void_p
        u.SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
        WM_SETICON, ICON_SMALL, ICON_BIG = 0x0080, 0, 1
        IMAGE_ICON, LR_LOADFROMFILE, LR_DEFAULTSIZE = 1, 0x10, 0x40
        p = str(ico)
        for _ in range(80):                                   # poll up to ~12s for the window
            hwnd = u.FindWindowW(None, "Juile")
            if hwnd:
                try:
                    big = u.LoadImageW(None, p, IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE)
                    small = u.LoadImageW(None, p, IMAGE_ICON, 32, 32, LR_LOADFROMFILE)
                    if big:
                        u.SendMessageW(hwnd, WM_SETICON, ICON_BIG, big)
                    if small:
                        u.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, small)
                except Exception:
                    pass
                return
            _t.sleep(0.15)

    threading.Thread(target=_set, daemon=True).start()


def run():
    """Start uvicorn in a thread, then open the native window."""
    import socket
    import threading
    import time
    import uvicorn

    config.WEB_DIR.mkdir(exist_ok=True)
    _make_qr()

    def serve():
        cfg = uvicorn.Config(app, host=config.HOST, port=config.PORT, log_level="warning")
        server = uvicorn.Server(cfg)
        server.install_signal_handlers = lambda: None
        asyncio.run(server.serve())

    threading.Thread(target=serve, daemon=True).start()

    # Wait until the port accepts connections.
    for _ in range(100):
        try:
            with socket.create_connection(("127.0.0.1", config.PORT), timeout=0.5):
                break
        except OSError:
            time.sleep(0.1)

    local = f"http://127.0.0.1:{config.PORT}"
    lan = f"http://{config.lan_ip()}:{config.PORT}"
    print(f"\n  JUILE is live.\n  This PC : {local}\n  Phone   : {lan}  (same Wi-Fi)\n")

    try:
        import webview
        webview.create_window("Juile", local, width=1280, height=860,
                              background_color="#0a1830", min_size=(900, 640))
        _apply_window_icon()
        webview.start()
    except Exception as e:
        print(f"  (Native window unavailable: {e})\n  Open {local} in your browser instead.")
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    run()
