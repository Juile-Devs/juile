"""Persistent user data: instructions, tone, long-term memory, provider keys,
MCP connectors. Everything Juile learns or is configured with lives in one JSON
file in the workspace (migrated from the old jarvis.json on first run)."""
import json

from . import config

STORE = config.WORKSPACE / "juile.json"
_LEGACY = config.WORKSPACE / "jarvis.json"

DEFAULT = {
    "instructions": "",
    "tone": "Human and warm. Short, real sentences by default — long and structured only when composing real work.",
    "memory": [],
    "tts_voice": "en-US-AriaNeural",   # spoken-voice persona (Settings -> Voice & tone)
    "tts_rate": "+0%",
    "tts_pitch": "+0Hz",
    "tts_persona": "aria",
    "project_name": "Project 1",
    "folders": [],             # absolute paths Juile may read/edit directly
    "local_focus": "",         # the one folder Juile should focus on (general "Local" if blank)
    "github_repo": "",         # active GitHub repo (owner/name) Juile reads & acts on
    "connectors": [],          # custom MCP: [{name, url, header_name, header_value}]
    "conversations": [],       # saved chat history (server-side persistence)
    "provider_keys": {},       # {providerKey: {field: value}}  (bring-your-own-key)
    "mcp": {                   # built-in integrations: {name: {url?, api_key?}}
        "composio": {"url": "", "api_key": ""},
        "zapier": {"url": ""},
        "higgsfield": {"url": "", "api_key": ""},
        "tavily": {"api_key": ""},
    },
}


def _merge(base: dict, patch: dict) -> dict:
    """Deep-merge one level of dicts so saving provider_keys/mcp doesn't wipe siblings."""
    out = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = {**out[k], **v}
        else:
            out[k] = v
    return out


def load() -> dict:
    path = STORE if STORE.exists() else (_LEGACY if _LEGACY.exists() else None)
    if path:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            merged = _merge(DEFAULT, data)
            if path is _LEGACY and not STORE.exists():   # one-time migration
                STORE.write_text(json.dumps(merged, indent=2), encoding="utf-8")
            return merged
        except Exception:
            pass
    return json.loads(json.dumps(DEFAULT))  # deep copy


def save(patch: dict) -> dict:
    cur = load()
    cur = _merge(cur, {k: v for k, v in patch.items() if k in DEFAULT})
    STORE.write_text(json.dumps(cur, indent=2), encoding="utf-8")
    return cur


def add_memory(text: str) -> list:
    cur = load()
    text = (text or "").strip()
    if text and text not in cur["memory"]:
        cur["memory"].append(text)
        STORE.write_text(json.dumps(cur, indent=2), encoding="utf-8")
    return cur["memory"]


def context_block() -> str:
    d = load()
    parts = []
    if d.get("instructions"):
        parts.append("# Custom instructions from the user\n" + d["instructions"])
    if d.get("tone"):
        parts.append("# How you (Juile) speak\n" + d["tone"])
    mem = d.get("memory") or []
    if mem:
        parts.append("# What you remember about the user\n" + "\n".join("- " + m for m in mem[-50:]))
    folders = d.get("folders") or []
    if folders:
        parts.append("# Project folders — you may read, write, and edit files in these directly (use absolute paths)\n"
                     + "\n".join("- " + f for f in folders))
    if d.get("local_focus"):
        parts.append("# FOCUS FOLDER — the user has pointed you at this folder; treat it as the working directory "
                     "for this task unless told otherwise\n" + d["local_focus"])
    if d.get("github_repo"):
        parts.append("# Active GitHub repo — you may read and act on it with the `github` tool (it runs the gh CLI). "
                     "Default any repo operation to this one unless told otherwise\n" + d["github_repo"])
    return "\n\n".join(parts)
