"""Central configuration: loads .env, defines AI providers and runtime settings.

Juile is "bring your own key". Every provider/MCP credential can be entered in the
app (Settings -> Providers / Connectors) and is stored in workspace/juile.json;
anything in .env is only an optional default. Credential resolution (store over
.env) lives in providers.py and the mcp_* helpers below.
"""
import os
import socket
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _env(key: str, default: str = "") -> str:
    return (os.getenv(key, default) or "").strip()


# --------------------------------------------------------------------------- #
# AI providers.  `style` selects the client adapter in providers.py:
#   openai    -> OpenAI-compatible /chat/completions (the large majority)
#   azure     -> Azure OpenAI (api-key header + deployment + api-version)
#   anthropic -> native Anthropic Messages API (streaming + tools)
#   bedrock   -> AWS Bedrock runtime (Claude messages schema, via boto3)
# `fields` are the credentials the Settings UI asks for; `env` maps each field to
# its optional .env fallback. No secrets are stored here.
# --------------------------------------------------------------------------- #
PROVIDERS = {
    "openai": {
        "label": "OpenAI", "style": "openai",
        "base_url": "https://api.openai.com/v1",
        "fields": ["api_key"], "env": {"api_key": "OPENAI_API_KEY"},
        "models": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3", "o4-mini"],
        "models_api": True,
    },
    "anthropic": {
        "label": "Anthropic", "style": "anthropic",
        "base_url": "https://api.anthropic.com/v1",
        "fields": ["api_key"], "env": {"api_key": "ANTHROPIC_API_KEY"},
        "models": ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001",
                   "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
        "models_api": True,
    },
    "claude_cli": {
        # "Account-Based": no API key. Shells out to the locally-installed Claude
        # Code CLI in print mode (`claude -p`), using your existing Claude login.
        # Juile feeds it the system prompt + tool catalog + full conversation
        # history, and catches the tool calls it writes back. See the dedicated
        # "claude_cli" adapter in providers.py.
        "label": "Claude (Account-Based)", "style": "claude_cli", "local": True,
        "base_url": "",
        "fields": [], "env": {},
        "models": ["sonnet", "opus", "haiku"],
        "models_api": False,
    },
    "google": {
        "label": "Google AI Studio", "style": "openai",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "fields": ["api_key"], "env": {"api_key": "GOOGLE_API_KEY"},
        "models": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"],
        "models_api": True,
    },
    "cloudflare": {
        "label": "Cloudflare Workers AI", "style": "openai",
        "base_url": "",  # built from account_id at resolve time
        "fields": ["api_key", "account_id"],
        "env": {"api_key": "CLOUDFLARE_API_TOKEN", "account_id": "CLOUDFLARE_ACCOUNT_ID"},
        "models": [
            "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
            "@cf/meta/llama-4-scout-17b-16e-instruct",
            "@cf/qwen/qwen2.5-coder-32b-instruct",
            "@cf/meta/llama-3.1-8b-instruct",
            "@cf/mistralai/mistral-small-3.1-24b-instruct",
        ],
        "models_api": True,
    },
    "azure": {
        "label": "Azure OpenAI", "style": "azure",
        "base_url": "",  # https://<resource>.openai.azure.com
        "fields": ["api_key", "base_url"],
        "env": {"api_key": "AZURE_API_KEY", "base_url": "AZURE_BASE_URL"},
        "api_version": "2024-10-21",
        "models": [],  # the "model" you pick is your Azure deployment name
        "models_api": False,
    },
    "openrouter": {
        "label": "OpenRouter", "style": "openai",
        "base_url": "https://openrouter.ai/api/v1",
        "fields": ["api_key"], "env": {"api_key": "OPENROUTER_API_KEY"},
        "models": [
            "anthropic/claude-3.5-sonnet", "openai/gpt-4o",
            "google/gemini-2.0-flash-exp:free", "deepseek/deepseek-chat-v3-0324:free",
            "meta-llama/llama-3.3-70b-instruct:free",
        ],
        "models_api": True,
    },
    "ollama_cloud": {
        "label": "Ollama Cloud", "style": "openai",
        "base_url": "https://ollama.com/v1",
        "fields": ["api_key"], "env": {"api_key": "OLLAMA_API_KEY"},
        "models": ["gpt-oss:120b", "gpt-oss:20b", "qwen3-coder:480b", "deepseek-v3.1:671b"],
        "models_api": True,
    },
    "ollama": {
        "label": "Ollama (local)", "style": "openai", "local": True,
        "base_url": _env("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
        "fields": [], "env": {}, "models": [], "models_api": True,
    },
    "lmstudio": {
        "label": "LM Studio (local)", "style": "openai", "local": True,
        "base_url": _env("LMSTUDIO_BASE_URL", "http://localhost:1234/v1"),
        "fields": [], "env": {}, "models": [], "models_api": True,
    },
    "bedrock": {
        "label": "AWS Bedrock", "style": "bedrock", "base_url": "",
        "fields": ["aws_access_key_id", "aws_secret_access_key", "region"],
        "env": {"aws_access_key_id": "AWS_ACCESS_KEY_ID",
                "aws_secret_access_key": "AWS_SECRET_ACCESS_KEY", "region": "AWS_REGION"},
        "models": [
            "anthropic.claude-3-5-sonnet-20241022-v2:0",
            "anthropic.claude-3-5-haiku-20241022-v1:0",
            "anthropic.claude-3-opus-20240229-v1:0",
        ],
        "models_api": False,
    },
    "huggingface": {
        "label": "Hugging Face", "style": "openai",
        "base_url": "https://router.huggingface.co/v1",
        "fields": ["api_key"], "env": {"api_key": "HF_TOKEN"},
        "models": ["deepseek-ai/DeepSeek-V3-0324", "meta-llama/Llama-3.3-70B-Instruct",
                   "Qwen/Qwen2.5-72B-Instruct"],
        "models_api": True,
    },
    "oneminai": {
        # NOT OpenAI-compatible: custom "Chat with AI" endpoint, API-KEY header,
        # {type, model, promptObject:{prompt}} payload, SSE event/data stream.
        # See the dedicated "oneminai" adapter in providers.py.
        "label": "OneMinute AI", "style": "oneminai",
        "base_url": "https://api.1min.ai",
        "fields": ["api_key"], "env": {"api_key": "ONEMINAI_API_KEY"},
        # 1min.ai doesn't expose a public GET /models endpoint (confirmed against
        # their docs as of June 2026), so this is a hand-curated list of the
        # underlying-provider model IDs they route to, pulled from their docs/
        # changelog rather than a live API response. Edit freely as their catalog
        # changes; models_api stays False so Juile won't try to auto-fetch it.
        "models": [
            # OpenAI
            "gpt-5.5", "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano",
            "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
            "o3", "o4-mini",
            # Anthropic
            "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6",
            "claude-haiku-4-5-20251001", "claude-3-5-sonnet-latest",
            # Google
            "gemini-3.1-pro", "gemini-3-pro", "gemini-3-flash", "gemini-2.5-pro", "gemini-2.5-flash",
            # Meta Llama
            "llama-4-maverick", "llama-4-scout", "llama-3.3-70b-instruct", "llama-3.1-405b-instruct",
            # Mistral
            "mistral-large-latest", "mistral-medium-latest", "magistral-medium-latest",
            # xAI Grok
            "grok-4", "grok-4.1-fast", "grok-3",
            # DeepSeek
            "deepseek-chat", "deepseek-reasoner",
            # Alibaba Qwen
            "qwen3-max", "qwen2.5-72b-instruct",
            # Cohere Command R
            "command-r-plus", "command-r",
            # Moonshot Kimi
            "kimi-k2",
            # Z.AI GLM
            "glm-4.6",
        ],
        "models_api": False,
    },
}

# Friendly initial selection (no key required to *show* it; the UI marks it "no key").
DEFAULT_PROVIDER = _env("DEFAULT_PROVIDER", "openai")
DEFAULT_MODEL = _env("DEFAULT_MODEL", "gpt-4o-mini")


# --------------------------------------------------------------------------- #
# MCP servers + web search.  Endpoints are non-secret defaults; the tokens come
# from the store (Settings -> Connectors) first, then .env.
# --------------------------------------------------------------------------- #
COMPOSIO_MCP_URL = _env("COMPOSIO_MCP_URL", "https://connect.composio.dev/mcp")
ZAPIER_MCP_URL = _env("ZAPIER_MCP_URL")
HIGGSFIELD_MCP_URL = _env("HIGGSFIELD_MCP_URL", "https://mcp.higgsfield.ai/mcp")


def _store_section(name: str) -> dict:
    """Read one section of the on-disk store without import cycles."""
    try:
        from . import store
        return (store.load().get(name) or {})
    except Exception:
        return {}


def mcp_creds(name: str) -> dict:
    """Resolve an MCP integration's url/key: store (user-entered) over .env."""
    saved = (_store_section("mcp").get(name) or {})
    env_url = {"composio": COMPOSIO_MCP_URL, "zapier": ZAPIER_MCP_URL, "higgsfield": HIGGSFIELD_MCP_URL}.get(name, "")
    env_key = {"composio": _env("COMPOSIO_API_KEY"), "higgsfield": _env("HIGGSFIELD_API_KEY")}.get(name, "")
    return {
        "url": (saved.get("url") or env_url or "").strip(),
        "api_key": (saved.get("api_key") or env_key or "").strip(),
    }


def tavily_key() -> str:
    return (_store_section("mcp").get("tavily", {}).get("api_key") or _env("TAVILY_API_KEY") or "").strip()


PERMISSION_MODE = _env("PERMISSION_MODE", "ask").lower()  # "ask" | "bypass"
HOST = _env("HOST", "0.0.0.0")
PORT = int(_env("PORT", "8765") or "8765")

WORKSPACE = ROOT / "workspace"
UPLOADS = WORKSPACE / "uploads"
SKILLS_DIR = ROOT / "skills"
WEB_DIR = ROOT / "web"
for _d in (WORKSPACE, UPLOADS, SKILLS_DIR):
    _d.mkdir(parents=True, exist_ok=True)


def lan_ip() -> str:
    """Best-effort LAN IP so the phone can reach the server on the same Wi-Fi."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"
