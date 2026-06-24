"""Multi-provider model client. One adapter per API style:
  openai / azure -> OpenAI-compatible /chat/completions (streaming + tools)
  anthropic      -> native Anthropic Messages API (streaming + tools)
  bedrock        -> AWS Bedrock runtime (Claude messages schema, via boto3)

Credentials are resolved per call: user-entered (store) over .env defaults, so
Juile is fully bring-your-own-key.
"""
import asyncio
import json
import os
import subprocess

import httpx

from . import config


# --------------------------------------------------------------------------- #
# Credential resolution
# --------------------------------------------------------------------------- #
def provider_creds(provider: str) -> dict:
    """Resolve a provider's credentials: user-entered (store) over .env."""
    p = config.PROVIDERS.get(provider) or {}
    creds = {}
    for field in p.get("fields", []):
        env_name = (p.get("env") or {}).get(field)
        creds[field] = config._env(env_name) if env_name else ""
    try:
        from . import store
        saved = (store.load().get("provider_keys") or {}).get(provider) or {}
    except Exception:
        saved = {}
    for field, val in saved.items():
        if val not in (None, ""):
            creds[field] = str(val).strip()
    return creds


def base_url(provider: str, creds: dict) -> str:
    p = config.PROVIDERS.get(provider) or {}
    if provider == "cloudflare":
        acct = creds.get("account_id", "")
        return f"https://api.cloudflare.com/client/v4/accounts/{acct}/ai/v1" if acct else ""
    if provider == "azure":
        return (creds.get("base_url") or "").rstrip("/")
    return p.get("base_url", "")


def is_configured(provider: str) -> bool:
    p = config.PROVIDERS.get(provider)
    if not p:
        return False
    if provider == "claude_cli":           # account-based: configured iff the CLI is present
        return bool(_claude_binary())
    if p.get("local"):
        return True
    creds = provider_creds(provider)
    if provider == "bedrock":
        return bool(creds.get("aws_access_key_id") and creds.get("aws_secret_access_key"))
    if provider == "cloudflare":
        return bool(creds.get("api_key") and creds.get("account_id"))
    if provider == "azure":
        return bool(creds.get("api_key") and creds.get("base_url"))
    return bool(creds.get("api_key"))


# --------------------------------------------------------------------------- #
# OpenAI-compatible helpers (also covers Azure / Cloudflare / Google / local)
# --------------------------------------------------------------------------- #
def _openai_headers(provider: str, creds: dict) -> dict:
    h = {"Content-Type": "application/json"}
    key = creds.get("api_key", "")
    if provider == "azure":
        if key:
            h["api-key"] = key
    elif key:
        h["Authorization"] = f"Bearer {key}"
    if provider == "openrouter":
        h["HTTP-Referer"] = "http://localhost"
        h["X-Title"] = "Juile"
    return h


def _chat_url(provider: str, creds: dict, model: str) -> str:
    b = base_url(provider, creds).rstrip("/")
    if provider == "azure":
        ver = config.PROVIDERS["azure"].get("api_version", "2024-10-21")
        return f"{b}/openai/deployments/{model}/chat/completions?api-version={ver}"
    return f"{b}/chat/completions"


# --------------------------------------------------------------------------- #
# Model listing
# --------------------------------------------------------------------------- #
async def list_models(provider: str) -> list[str]:
    p = config.PROVIDERS.get(provider)
    if not p:
        return []
    creds = provider_creds(provider)
    style = p.get("style", "openai")

    if provider == "cloudflare":
        acct, tok = creds.get("account_id"), creds.get("api_key")
        if acct and tok:
            try:
                url = f"https://api.cloudflare.com/client/v4/accounts/{acct}/ai/models/search"
                async with httpx.AsyncClient(timeout=20) as c:
                    r = await c.get(url, headers={"Authorization": f"Bearer {tok}"},
                                    params={"task": "Text Generation", "per_page": 100})
                    if r.status_code == 200:
                        ids = [m["name"] for m in r.json().get("result", [])
                               if (m.get("task") or {}).get("name") == "Text Generation" and m.get("name")]
                        bad = ("lora", "guard", "-math", "sqlcoder")
                        ids = [x for x in ids if not any(b in x.lower() for b in bad)]
                        if ids:
                            return sorted(ids)
            except Exception:
                pass
        return p.get("models", [])

    if style == "anthropic":
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.get(p["base_url"].rstrip("/") + "/models",
                                headers={"x-api-key": creds.get("api_key", ""),
                                         "anthropic-version": "2023-06-01"})
                if r.status_code == 200:
                    ids = [m.get("id") for m in r.json().get("data", []) if m.get("id")]
                    if ids:
                        return ids
        except Exception:
            pass
        return p.get("models", [])

    if style == "bedrock" or not p.get("models_api"):
        return p.get("models", [])

    b = base_url(provider, creds)
    if not b:
        return p.get("models", [])
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(b.rstrip("/") + "/models", headers=_openai_headers(provider, creds))
            if r.status_code == 200:
                ids = [m.get("id") for m in r.json().get("data", []) if m.get("id")]
                if ids:
                    return sorted(set(ids))
    except Exception:
        pass
    return p.get("models", [])


# --------------------------------------------------------------------------- #
# OpenAI-style completion
# --------------------------------------------------------------------------- #
class _ToolsUnsupported(Exception):
    pass


async def _openai_attempt(provider, model, messages, tools, temperature, on_token):
    creds = provider_creds(provider)
    if not base_url(provider, creds):
        raise RuntimeError(f"Provider '{provider}' is not configured.")
    url = _chat_url(provider, creds, model)
    headers = _openai_headers(provider, creds)
    payload = {"model": model, "messages": messages, "stream": True, "temperature": temperature}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    content = ""
    calls = {}
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as c:
        async with c.stream("POST", url, headers=headers, json=payload) as r:
            if r.status_code >= 400:
                body = (await r.aread()).decode("utf-8", "ignore")
                if tools and ("tool" in body.lower() or r.status_code == 400):
                    raise _ToolsUnsupported()
                raise RuntimeError(f"{provider} HTTP {r.status_code}: {body[:600]}")
            async for line in r.aiter_lines():
                if not line:
                    continue
                if line.startswith("data:"):
                    line = line[5:].strip()
                if line == "[DONE]":
                    break
                if not line.startswith("{"):
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                delta = (obj.get("choices") or [{}])[0].get("delta", {}) or {}
                cont = delta.get("content")
                if cont:
                    cont = cont if isinstance(cont, str) else str(cont)
                    content += cont
                    await on_token(cont)
                for tc in (delta.get("tool_calls") or []):
                    idx = tc.get("index", 0)
                    slot = calls.setdefault(idx, {"id": "", "name": "", "args": ""})
                    if tc.get("id"):
                        slot["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    if fn.get("name"):
                        slot["name"] = fn["name"]
                    if fn.get("arguments"):
                        slot["args"] += fn["arguments"]
    out = [{"id": v["id"] or f"call_{i}", "name": v["name"], "args": v["args"]}
           for i, v in sorted(calls.items()) if v["name"]]
    return content, out


async def _openai_nostream(provider, model, messages, temperature):
    creds = provider_creds(provider)
    url = _chat_url(provider, creds, model)
    payload = {"model": model, "messages": messages, "stream": False,
               "temperature": temperature, "max_tokens": 2048}
    async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=30.0)) as c:
        r = await c.post(url, headers=_openai_headers(provider, creds), json=payload)
        if r.status_code >= 400:
            raise RuntimeError(f"{provider} HTTP {r.status_code}: {r.text[:400]}")
        msg = (r.json().get("choices") or [{}])[0].get("message", {}) or {}
        return str(msg.get("content") or "")


async def _openai_complete(provider, model, messages, tools, temperature, on_token):
    try:
        content, calls = await _openai_attempt(provider, model, messages, tools, temperature, on_token)
    except _ToolsUnsupported:
        content, calls = await _openai_attempt(provider, model, messages, None, temperature, on_token)
    if not (content or "").strip() and not calls:
        try:
            content2 = await _openai_nostream(provider, model, messages, temperature)
            if content2.strip():
                await on_token(content2)
                content = content2
        except Exception:
            pass
    return content, calls


# --------------------------------------------------------------------------- #
# Anthropic message-format conversion (shared by anthropic + bedrock)
# --------------------------------------------------------------------------- #
def _ablocks(content):
    """Convert OpenAI-style content (str or multimodal list) to Anthropic content blocks."""
    if isinstance(content, list):
        out = []
        for part in content:
            if not isinstance(part, dict):
                out.append({"type": "text", "text": str(part)}); continue
            if part.get("type") == "text":
                out.append({"type": "text", "text": part.get("text", "")})
            elif part.get("type") == "image_url":
                url = (part.get("image_url") or {}).get("url", "")
                if url.startswith("data:"):
                    try:
                        head, b64 = url.split(",", 1)
                        media = head.split(";")[0].split(":", 1)[1]
                        out.append({"type": "image", "source": {"type": "base64", "media_type": media, "data": b64}})
                    except Exception:
                        pass
        return out or [{"type": "text", "text": ""}]
    return [{"type": "text", "text": content if isinstance(content, str) else str(content)}]


def _to_anthropic(messages):
    """Convert the OpenAI-shaped message list into (system_text, anthropic_messages),
    merging consecutive same-role turns and folding tool results into user turns."""
    system_parts, conv = [], []

    def push(role, blocks):
        if conv and conv[-1]["role"] == role:
            conv[-1]["content"].extend(blocks)
        else:
            conv.append({"role": role, "content": blocks})

    for m in messages:
        role, content = m.get("role"), m.get("content")
        if role == "system":
            if content:
                system_parts.append(content if isinstance(content, str)
                                    else " ".join(p.get("text", "") for p in content if isinstance(p, dict)))
        elif role == "tool":
            push("user", [{"type": "tool_result", "tool_use_id": m.get("tool_call_id", ""),
                           "content": str(content or "")}])
        elif role == "assistant":
            blocks = _ablocks(content) if content else []
            for tc in (m.get("tool_calls") or []):
                fn = tc.get("function") or {}
                try:
                    inp = json.loads(fn.get("arguments") or "{}")
                except Exception:
                    inp = {}
                blocks.append({"type": "tool_use", "id": tc.get("id") or "", "name": fn.get("name") or "", "input": inp})
            push("assistant", blocks or [{"type": "text", "text": " "}])
        else:  # user
            push("user", _ablocks(content))

    if conv and conv[0]["role"] == "assistant":
        conv.insert(0, {"role": "user", "content": [{"type": "text", "text": "(start)"}]})
    return "\n\n".join(system_parts), conv


def _tools_anthropic(tools):
    out = []
    for t in tools or []:
        fn = t.get("function") or {}
        out.append({"name": fn.get("name"), "description": fn.get("description", ""),
                    "input_schema": fn.get("parameters") or {"type": "object", "properties": {}}})
    return out


async def _anthropic_complete(provider, model, messages, tools, temperature, on_token):
    creds = provider_creds(provider)
    key = creds.get("api_key", "")
    if not key:
        raise RuntimeError("Anthropic API key not set. Add it in Settings -> Providers.")
    system, conv = _to_anthropic(messages)
    payload = {"model": model, "max_tokens": 4096, "messages": conv, "stream": True,
               "temperature": max(0.0, min(1.0, temperature))}
    if system:
        payload["system"] = system
    if tools:
        payload["tools"] = _tools_anthropic(tools)
    url = config.PROVIDERS["anthropic"]["base_url"].rstrip("/") + "/messages"
    headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    content, calls, cur = "", [], None
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as c:
        async with c.stream("POST", url, headers=headers, json=payload) as r:
            if r.status_code >= 400:
                body = (await r.aread()).decode("utf-8", "ignore")
                raise RuntimeError(f"anthropic HTTP {r.status_code}: {body[:600]}")
            async for line in r.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    ev = json.loads(data)
                except Exception:
                    continue
                et = ev.get("type")
                if et == "content_block_start":
                    blk = ev.get("content_block") or {}
                    if blk.get("type") == "tool_use":
                        cur = {"id": blk.get("id", ""), "name": blk.get("name", ""), "args": ""}
                elif et == "content_block_delta":
                    d = ev.get("delta") or {}
                    if d.get("type") == "text_delta":
                        piece = d.get("text", "")
                        if piece:
                            content += piece
                            await on_token(piece)
                    elif d.get("type") == "input_json_delta" and cur is not None:
                        cur["args"] += d.get("partial_json", "")
                elif et == "content_block_stop" and cur is not None:
                    cur["args"] = cur["args"].strip() or "{}"
                    calls.append(cur)
                    cur = None
    return content, calls


# --------------------------------------------------------------------------- #
# OneMinute AI ("Chat with AI" API) — NOT OpenAI-compatible: single `prompt`
# string rather than a messages array, API-KEY header auth, custom SSE events
# (content / result / done / error), no function-calling support per their docs.
# --------------------------------------------------------------------------- #
def _to_oneminai_prompt(messages) -> str:
    """Flatten the OpenAI-shaped message list into one prompt string: system
    text as a preamble, then prior turns labelled User:/Assistant:, ending
    with the latest turn. (1min.ai's native multi-turn support is a server-side
    conversationId created via a separate endpoint, which doesn't fit Juile's
    stateless per-call message list, so history rides along in the prompt.)"""
    sys_parts, turns = [], []
    for m in messages:
        role, content = m.get("role"), m.get("content")
        if isinstance(content, list):  # multimodal -> keep text parts only
            content = " ".join(p.get("text", "") for p in content
                               if isinstance(p, dict) and p.get("type") == "text")
        content = content.strip() if isinstance(content, str) else str(content or "").strip()
        if not content:
            continue
        if role == "system":
            sys_parts.append(content)
        elif role == "tool":
            turns.append(f"[Tool result] {content}")
        elif role == "assistant":
            turns.append(f"Assistant: {content}")
        else:
            turns.append(f"User: {content}")
    prefix = ("\n\n".join(sys_parts) + "\n\n") if sys_parts else ""
    return prefix + "\n".join(turns)


async def _oneminai_complete(provider, model, messages, tools, temperature, on_token):
    creds = provider_creds(provider)
    key = creds.get("api_key", "")
    if not key:
        raise RuntimeError("OneMinute AI API key not set. Add it in Settings -> Providers.")
    prompt = _to_oneminai_prompt(messages) or "Hello"
    payload = {"type": "UNIFY_CHAT_WITH_AI", "model": model, "promptObject": {"prompt": prompt}}
    headers = {"Content-Type": "application/json", "API-KEY": key}
    b = config.PROVIDERS["oneminai"]["base_url"].rstrip("/")
    content = ""
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as c:
        async with c.stream("POST", b + "/api/chat-with-ai?isStreaming=true",
                            headers=headers, json=payload) as r:
            if r.status_code >= 400:
                body = (await r.aread()).decode("utf-8", "ignore")
                raise RuntimeError(f"oneminai HTTP {r.status_code}: {body[:600]}")
            event = None
            async for line in r.aiter_lines():
                if not line:
                    event = None
                    continue
                if line.startswith("event:"):
                    event = line[6:].strip()
                    continue
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data:
                    continue
                try:
                    obj = json.loads(data)
                except Exception:
                    continue
                if event == "content":
                    piece = obj.get("content", "")
                    if piece:
                        content += piece
                        await on_token(piece)
                elif event == "error":
                    err = obj.get("error") or {}
                    raise RuntimeError(f"oneminai: {err.get('message') or obj.get('message') or 'stream error'}")
                elif event == "done":
                    break
    if not content.strip():
        try:  # non-streaming fallback, mirrors _openai_nostream
            async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=30.0)) as c:
                r = await c.post(b + "/api/chat-with-ai", headers=headers, json=payload)
                if r.status_code < 400:
                    rec = (r.json().get("aiRecord") or {}).get("aiRecordDetail") or {}
                    content2 = "".join(x for x in (rec.get("resultObject") or []) if isinstance(x, str))
                    if content2.strip():
                        await on_token(content2)
                        content = content2
        except Exception:
            pass
    return content, []  # 1min.ai's chat API has no documented function-calling / tool support


# --------------------------------------------------------------------------- #
# AWS Bedrock (Claude messages schema via boto3; non-streaming for simplicity)
# --------------------------------------------------------------------------- #
async def _bedrock_complete(provider, model, messages, tools, temperature, on_token):
    creds = provider_creds(provider)
    system, conv = _to_anthropic(messages)

    def _run():
        import boto3
        client = boto3.client(
            "bedrock-runtime",
            region_name=creds.get("region") or "us-east-1",
            aws_access_key_id=creds.get("aws_access_key_id") or None,
            aws_secret_access_key=creds.get("aws_secret_access_key") or None,
        )
        body = {"anthropic_version": "bedrock-2023-05-31", "max_tokens": 4096,
                "messages": conv, "temperature": max(0.0, min(1.0, temperature))}
        if system:
            body["system"] = system
        if tools:
            body["tools"] = _tools_anthropic(tools)
        resp = client.invoke_model(modelId=model, body=json.dumps(body))
        return json.loads(resp["body"].read())

    try:
        data = await asyncio.to_thread(_run)
    except ModuleNotFoundError:
        raise RuntimeError("Bedrock needs boto3. Run: pip install boto3")
    except Exception as e:
        raise RuntimeError(f"bedrock error: {e}")

    content, calls = "", []
    for blk in data.get("content", []):
        if blk.get("type") == "text":
            content += blk.get("text", "")
        elif blk.get("type") == "tool_use":
            calls.append({"id": blk.get("id", ""), "name": blk.get("name", ""),
                          "args": json.dumps(blk.get("input") or {})})
    if content:
        await on_token(content)
    return content, calls


# --------------------------------------------------------------------------- #
# Claude (Account-Based) — drives the locally-installed Claude Code CLI in print
# mode (`claude -p`), using the user's existing Claude login instead of an API
# key. Juile stays the brain: we feed Claude the SAME system prompt, the full
# tool catalog, and the whole conversation, and Claude writes back ONE tool call
# as a ```action JSON block (caught by agent.parse_text_action) or a plain reply.
# Extra CLI flags can be tuned here without touching the call site.
# --------------------------------------------------------------------------- #
CLAUDE_CLI_FLAGS = ["-p", "--output-format", "text"]
# Stop the CLI from running its OWN tools (Bash/Edit/Read/…) — Juile owns the
# tools, the CLI only decides the next move. Set to [] to let Claude act directly.
CLAUDE_CLI_DISALLOW = ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebSearch",
                       "WebFetch", "Task", "NotebookEdit", "TodoWrite"]


def _claude_binary() -> str:
    """Resolve the Claude CLI: a user-set path (store) over whatever is on PATH."""
    import shutil
    try:
        from . import store
        saved = (store.load().get("provider_keys") or {}).get("claude_cli") or {}
    except Exception:
        saved = {}
    cand = (saved.get("cli_path") or "").strip()
    if cand:
        return cand
    for name in ("claude", "claude.cmd", "claude.exe"):
        found = shutil.which(name)
        if found:
            return found
    return ""


def _render_tool_catalog(tools) -> str:
    """Render the native function-calling schema as plain text the CLI can read
    (it has no native tool-calling channel, so the schema must ride in the prompt)."""
    lines = []
    for t in tools or []:
        fn = (t or {}).get("function") or {}
        name = fn.get("name", "")
        if not name:
            continue
        params = (fn.get("parameters") or {}).get("properties") or {}
        required = set((fn.get("parameters") or {}).get("required") or [])
        sig = ", ".join((p + "*" if p in required else p) for p in params)
        lines.append(f"- {name}({sig}): {fn.get('description', '')}")
    return "\n".join(lines)


def _to_claude_cli_prompt(messages, tools) -> str:
    """Flatten Juile's OpenAI-shaped messages into one prompt for `claude -p`:
    system prompt + tool catalog + the action protocol, then the transcript."""
    sys_parts, turns = [], []
    for m in messages:
        role, content = m.get("role"), m.get("content")
        if isinstance(content, list):                # multimodal -> text parts only
            content = " ".join(p.get("text", "") for p in content
                               if isinstance(p, dict) and p.get("type") == "text")
        content = content.strip() if isinstance(content, str) else str(content or "").strip()
        if role == "system":
            if content:
                sys_parts.append(content)
            continue
        if not content:
            continue
        if role == "tool":
            turns.append(f"[TOOL RESULT]\n{content}")
        elif role == "assistant":
            turns.append(f"Assistant: {content}")
        else:
            turns.append(f"User: {content}")
    protocol = (
        "# HOW TO ACT (read carefully)\n"
        "You have NO native tool-calling channel here. To use ONE tool, output ONLY this — nothing else, no prose around it:\n"
        "```action\n"
        '{"tool": "<tool name>", "args": { ... }}\n'
        "```\n"
        "The system runs it and feeds you the result as [TOOL RESULT], then you continue. "
        "Use tool names EXACTLY from the catalog above. One action block per turn, max. "
        "Do NOT try to act on your own — emit the action and stop. "
        "When you're done and want to talk to the user, write a normal reply with NO action block and NO JSON."
    )
    head = "\n\n".join(sys_parts)
    catalog = _render_tool_catalog(tools)
    return (f"{head}\n\n# TOOLS YOU CAN CALL\n{catalog}\n\n{protocol}\n\n"
            f"# CONVERSATION SO FAR\n" + "\n\n".join(turns) + "\n\nAssistant:")


async def _claude_cli_complete(provider, model, messages, tools, temperature, on_token):
    binary = _claude_binary()
    if not binary:
        raise RuntimeError(
            "Claude CLI not found. Install Claude Code (npm i -g @anthropic-ai/claude-code) and run "
            "`claude` once to sign in. You can also set its path in Settings -> Providers.")
    prompt = _to_claude_cli_prompt(messages, tools)
    flags = list(CLAUDE_CLI_FLAGS)
    m = (model or "").strip().lower()
    if m in ("sonnet", "opus", "haiku"):
        flags += ["--model", m]
    if CLAUDE_CLI_DISALLOW:
        flags += ["--disallowedTools", " ".join(CLAUDE_CLI_DISALLOW)]
    argv = (["cmd", "/c", binary] + flags) if os.name == "nt" else ([binary] + flags)

    # Primary path: async subprocess with the prompt piped on stdin (avoids any
    # command-line length/escaping limits since the prompt is large).
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    except NotImplementedError:
        def _blocking():
            r = subprocess.run(argv, input=prompt, capture_output=True, text=True, timeout=900)
            return r.returncode, r.stdout or "", r.stderr or ""
        rc, out, err = await asyncio.to_thread(_blocking)
        if rc and not out.strip():
            raise RuntimeError(_claude_err(rc, err))
        if out:
            await on_token(out)
        return out, []

    content = ""
    try:
        proc.stdin.write(prompt.encode("utf-8", "ignore"))
        await proc.stdin.drain()
    except Exception:
        pass
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
    while True:
        chunk = await proc.stdout.read(512)
        if not chunk:
            break
        piece = chunk.decode("utf-8", "ignore")
        content += piece
        await on_token(piece)
    err = (await proc.stderr.read()).decode("utf-8", "ignore")
    await proc.wait()
    if proc.returncode and not content.strip():
        raise RuntimeError(_claude_err(proc.returncode, err))
    return content, []


def _claude_err(code, stderr: str) -> str:
    msg = (stderr or "").strip()[:500]
    low = msg.lower()
    if any(k in low for k in ("not logged in", "unauthorized", "log in", "login", "authenticate", "/login")):
        return "Claude CLI isn't logged in. Open a terminal, run `claude`, sign in to your Claude account, then try again."
    return f"Claude CLI error (exit {code}): {msg or 'no output — is `claude` installed and logged in?'}"


# --------------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------------- #
async def complete(provider, model, messages, tools, temperature, on_token):
    """Streams content via on_token; returns (content, tool_calls)."""
    style = (config.PROVIDERS.get(provider) or {}).get("style", "openai")
    if style == "anthropic":
        return await _anthropic_complete(provider, model, messages, tools, temperature, on_token)
    if style == "bedrock":
        return await _bedrock_complete(provider, model, messages, tools, temperature, on_token)
    if style == "oneminai":
        return await _oneminai_complete(provider, model, messages, tools, temperature, on_token)
    if style == "claude_cli":
        return await _claude_cli_complete(provider, model, messages, tools, temperature, on_token)
    return await _openai_complete(provider, model, messages, tools, temperature, on_token)
