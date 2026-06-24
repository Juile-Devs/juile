# Juile

An autonomous, agentic AI assistant that lives on your Windows PC — a blend of OpenClaw,
Claude Code, and Claude Cowork. A bright blue glassmorphism UI with four living orbs,
**bring-your-own-key** multi-provider models, real computer control with Juile's own blue
cursor, deep research, charts/tables/email cards, MCP (Composio + Zapier + Higgsfield),
skills, file uploads, persistent memory, and phone access.

## Run it

**Windows** — double-click **`Juile.bat`**. First launch creates a virtual env and installs
everything (takes a minute), then a native window opens.

**Arch Linux / other Linux** — make the launcher executable once, then run it:

```bash
chmod +x juile.sh
./juile.sh
```

It creates a `.venv`, installs dependencies, and opens the native window.

Requires **Python 3.10+** on PATH. For local models, start **LM Studio** or **Ollama** first.

### Arch Linux system packages
The native window uses a system WebKit/Qt backend; computer-control needs X11 tools:

```bash
sudo pacman -S --needed python python-pip tk \
  webkit2gtk python-gobject \
  scrot xdotool
```

- Native window (pywebview) uses **webkit2gtk + python-gobject** (GTK). For Qt instead:
  `sudo pacman -S --needed qt6-webengine python-pyqt6`.
- **Computer control** (blue cursor, clicks, screenshots) works on **X11**; on **Wayland** it is
  limited — use an **Xorg** session for full control.

## Connect a provider (bring your own key)
Open **Settings → Providers** and paste a key for any of:
OpenAI · Anthropic · Google AI Studio · Cloudflare Workers AI · Azure OpenAI · OpenRouter ·
Ollama Cloud · Ollama (local) · LM Studio (local) · AWS Bedrock · Hugging Face.

Keys are stored **locally** on this PC (`workspace/juile.json`) and never leave it. Anything
in `.env` is just an optional default. Anthropic and Bedrock use native APIs; everything else
speaks the OpenAI API. (Bedrock needs `boto3`, which `requirements.txt` installs.)

## What it can do
- **Models** — switch any provider/model from the model chip (top-left); it auto-lists models per provider.
- **Computer control** — Juile drives its **own blue cursor**: moves, clicks, right-clicks, types,
  drags, scrolls, screenshots, opens apps/URLs, runs PowerShell/Python, reads/writes files.
  Toggle **Bypass** / **Ask before doing** from the permission chip.
- **Agentic loop** — thinks, acts, observes, repeats until done. The step budget is flexible:
  it extends while real progress is being made, so long tasks aren't cut off.
- **Research** — `web_search` and `deep_research` (fans out many Tavily queries, dedupes, cites).
- **Rich output** — markdown, tables (CSV export), Chart.js charts, step lists, email drafts,
  generated images, and slide decks.
- **MCP** — Composio (Gmail, Calendar, Notion, 500+), Zapier, and Higgsfield (image/video/slides).
- **Personality + memory** — Juile speaks like a human (short and real, long when composing) and
  remembers durable facts about you across sessions.
- **Skills** — markdown playbooks in `skills/`. **Files** — upload with the `+` in the input bar.
- **Voice** — speaks replies; dictates your input. **Phone** — QR + LAN URL on the same Wi-Fi.

## Layout
```
Juile/
  Juile.bat           launcher
  .env                optional default keys (secret; prefer Settings -> Providers)
  server/             FastAPI backend, agent loop, tools, providers
  web/                the UI (index.html, styles.css, app.js)
  skills/             skill playbooks
  workspace/          where Juile reads/writes files, uploads, memory (juile.json)
```

## Security
- Bring-your-own-key: credentials live locally in `workspace/juile.json`. `.env` is git-ignored.
- **Bypass** mode runs actions (shell, mouse/keyboard) without asking. Use **Ask before doing** to confirm each step.
- Phone access is LAN-only by default (not exposed to the internet).
