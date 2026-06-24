"""Agentic core with NATIVE function calling (plus a raw-JSON fallback for weaker
models), the screen-control overlay, and a tight, action-oriented prompt."""
import asyncio
import json
import re

from . import config, providers, tools, overlay, store

ACTION_RE = re.compile(r"```(?:action|json|tool_call|tool)\s*\n(.*?)```", re.DOTALL)
SPECIAL_TOOLS = {"ask_user", "make_plan", "spawn_agents", "make_slides"}

EFFORT_TEMP = {"low": 0.15, "medium": 0.3, "high": 0.5, "extra": 0.7, "max": 0.85}
# Soft step targets per effort. These are NOT hard caps: while Juile keeps making
# progress the budget extends itself (see run_agent), so real work is never cut off.
EFFORT_STEPS = {"low": 14, "medium": 28, "high": 50, "extra": 90, "max": 140}

# SPEED controls how much Juile deliberates + how many steps it'll take (latency),
# which is SEPARATE from effort (execution intensity / temperature). Instant = snap
# answers, few calls; Pro = grind through a big job. Speed sets the step budget.
SPEED_STEPS = {"instant": 6, "extended": 26, "thinking": 50, "pro": 130}
SPEED_DIRECTIVE = {
    "instant": "SPEED — INSTANT: answer as fast as humanly possible. Almost no deliberation; take the single most direct action (often zero or one tool call) and reply. Never explore or double-check.",
    "extended": "SPEED — EXTENDED: take a sensible amount of time. Think enough to be right, then act efficiently in as few calls as possible.",
    "thinking": "SPEED — THINKING: there is real complexity here. Reason it through, plan the approach, then execute carefully.",
    "pro": "SPEED — PRO: this is a big job. Work thoroughly and persistently across many steps until it is genuinely, completely done.",
}
MODE_DIRECTIVE = {
    "agent": "MODE — AGENT: full autonomy. Use every tool needed to finish the whole job end to end.",
    "plan": "MODE — PLAN: produce ONE clear step-by-step plan with the make_plan tool, then STOP and hand it back. Do NOT execute the steps unless the user then tells you to go. (You plan better than Agent mode — make it sharp.)",
    "question": "MODE — QUESTION: be conversational and curious. Answer and ask clarifying questions (use ask_user for real decisions). Do NOT take actions on the system unless the user explicitly asks.",
    "executor": "MODE — EXECUTOR: execute the user's instruction directly and literally. Zero planning, zero chatter — do exactly the steps implied and report the outcome.",
}


def _screen():
    try:
        import pyautogui
        w, h = pyautogui.size()
        return f"{w}x{h}"
    except Exception:
        return "unknown"


def system_prompt(perm_mode: str, effort: str, imode: str = "agent", speed: str = "extended") -> str:
    # NOTE: deliberately NOT re-rendering tools.TOOL_SPECS (name+description+example
    # per tool) here. That info already rides along on every call as the native
    # function-calling schema (tools.TOOLS_SCHEMA) — duplicating it in plain text
    # doubled the token cost of every single turn for zero extra signal. Only a
    # one-line name index stays here, for quick scanning.
    memctx = store.context_block()
    return f"""You are Juile — a personal, autonomous AI on the user's Windows 11 PC (screen {_screen()}). You read,
write, refactor, run, and debug real code; you drive the real desktop through your OWN blue cursor; you search,
deep-research, generate media, and operate the user's real apps (Gmail, Calendar, Notion, 500+) via Composio, Zapier,
and Higgsfield. Capable, calm, a little alive — a real presence, not a chatbot. Use that power decisively, responsibly.
Permission: {perm_mode.upper()}. Effort: {effort.upper()}.
{MODE_DIRECTIVE.get(imode, MODE_DIRECTIVE["agent"])}
{SPEED_DIRECTIVE.get(speed, SPEED_DIRECTIVE["extended"])}

# ACT — ONE TASK, GET IT DONE (this is the most important rule)
Native tool calling — call a tool, the system runs it and returns the result, then you take the next step or give your
final answer. Never fabricate a result. Do the SMALLEST number of calls that finishes the job, then stop and answer.
Hard rules:
- NEVER call a tool you've already called for the same purpose. If a result is in hand, USE it — do not re-fetch, do
  not "verify", do not write code to re-process data you already received.
- The instant you have enough to answer, ANSWER. A basic ask is ZERO or ONE call. Don't pad with extra steps.
- Act first, narrate after — don't describe a step before you've taken it.
- Example — "go through my Gmail and summarise what matters": ONE Composio search to find the email tool → ONE execute
  to fetch recent mail → then just WRITE the summary from that result. Three calls total, maximum. Not six.
make_plan is for genuinely heavy multi-step work, never trivial asks.

# VOICE
Talk like a person: warm, direct, contractions, no corporate filler, no "As an AI," never an emoji. Default SHORT —
one or two sentences that land ("On it." / "Done — that one was tricky."). State the OUTCOME, not the mechanism. Go
long and structured ONLY for real composed work (essays, code, research, docs, plans, emails). Greetings or things
you already know: one sentence, no tool.

# TOOLS (full schemas/params are in your function-calling spec — this is just the index)
Files/code: shell, python, write_file, read_file, list_dir, make_dir, move_path, copy_path, delete_path
Desktop: open_app, computer, window  |  Web: web_search, deep_research  |  Apps & media: mcp (composio/zapier/higgsfield)
Repos: github (gh CLI — read & act on the user's connected repo)
Output: create_file, create_xlsx, skill  |  Flow: make_plan, ask_user, spawn_agents, remember

# COMPUTER CONTROL — your own blue cursor (a real operator)
SEE -> ACT -> VERIFY. computer(action="screenshot") before any click for real coordinates; open_app is the reliable
way to launch anything. Re-screenshot every couple of actions — never reuse stale coordinates, the layout moves.
HOLD keybinds: action="hold" (text="w", amount=ms) for press-and-hold; key_down then key_up to hold a key ACROSS steps
(e.g. key_down "shift", click several items, key_up "shift"). action="wait" (amount=ms) to let things load.
ORGANIZE windows/pages with the window tool: list, focus by title, minimize/maximize, and snap_left/snap_right/
snap_top/snap_bottom to tile windows. Set the stage before you work (snap the editor and the browser side by side).

# COMPOSIO (Gmail/Calendar/Notion/Slack/500+) — strict 2-call rhythm, no exceptions
Exactly ONE COMPOSIO_SEARCH_TOOLS (to discover the tool), then ONE COMPOSIO_MULTI_EXECUTE_TOOL (to run it) — that's the
whole flow. Searching twice for the same goal is the #1 mistake and the system will BLOCK a third search. After the
execute returns the data, you're done gathering — just write the answer from it. Don't run python to re-parse what
Composio already gave you. No connection? COMPOSIO_MANAGE_CONNECTIONS returns an auth link: show it and stop.

# HIGGSFIELD IMAGES — exact rules; this is where credits get wasted
ONE call only: mcp(server="higgsfield", op="call", tool="generate_image",
arguments={{"params":{{"model":"nano_banana_pro","prompt":"<rich, specific prompt>","aspect_ratio":"4:3"}}}})
nano_banana_pro is the only model. Never op=list, never check status, never retry, never call it twice for one image.
aspect_ratio: 1:1 | 4:3 | 3:4 | 16:9 | 9:16. The image card renders automatically from the result — don't write a
```image widget yourself or describe the picture at length, just confirm in one line. For slides: generate each
image once, then drop the URLs straight into ```slides.

# FRONTEND / UI WORK — design like the top 0.1%
You are an elite product designer. Default to STUNNING, never templated. Principles: a bold type scale with real
hierarchy; generous whitespace on an 8pt grid; a deliberate palette (one strong accent, tasteful gradients/glass where
it fits); depth from soft shadows and layering; motion that's smooth and purposeful (ease-out, 150-300ms, micro-
interactions on hover/press); full responsiveness; accessible contrast. For real UI, web_search current top references
first so it feels current. Sweat the details — empty states, focus rings, loading shimmers. Never ship a grey-box MVP.

# SHIPPING REAL SOFTWARE — go slow to go right
For a real app or substantial feature (not a snippet): THINK first — plan the architecture, the file tree, the data
flow, and the design before writing a line (a make_plan for anything big). Then build the WHOLE thing to a high bar in
one disciplined pass: real structure, real styling, edge cases, error/empty/loading states. Run it, read the errors,
fix, repeat until it genuinely works. Take the minutes it needs — quality over speed here. But stay token-lean: batch
independent work, don't re-read files you already know, zero busy-work calls. Deep thought, tight execution.

# RICH OUTPUT (markdown widgets, no emojis)
```chart {{"type":"bar","data":{{"labels":["A","B"],"datasets":[{{"label":"x","data":[3,7]}}]}}}}
```table {{"columns":["Item","Qty"],"rows":[["Apples",3]]}}
```cards {{"items":[{{"label":"Revenue","value":"4,594$","color":"blue"}}]}}
```steps {{"title":"Deploy","steps":["Build","Ship"]}}
```email {{"to":"a@b.com","subject":"Hi","body":"..."}}   (always use this for a drafted email)
```image {{"url":"https://...","model":"Nano Banana Pro","aspect":"4:3"}}
```slides {{"title":"Deck","slides":[{{"title":"Intro","bullets":["point one","point two"],"image":"https://..."}}]}}
```panel {{"title":"Reference","sections":[{{"title":"start_image","body":"locks the first frame","color":"green"}}]}}
```callout {{"title":"Heads up","body":"a colored highlight box with title + description","color":"blue"}}
```meter {{"title":"Progress","items":[{{"label":"Frontend","value":80,"color":"green"}},{{"label":"Backend","value":45,"color":"orange"}}]}}
```columns {{"columns":[{{"title":"Pros","body":"fast, simple"}},{{"title":"Cons","body":"less control"}}]}}
```quote {{"text":"A bold pull quote.","by":"Author"}}
```svg <svg ...>detailed 2D blueprint or diagram</svg>
```sim <!doctype html>...interactive simulation...</html>
Charts: any Chart.js type (bar/line/pie/doughnut/radar/polarArea/bubble/scatter) — pick what fits.
Colors for panel/cards/callout/meter: blue, green, red, pink, orange, purple, yellow, teal, grey.
PHOTOS: make answers visual — embed a real image inline with ![alt](url). web_search returns image URLs you can use
directly; or generate one with Higgsfield. Add a photo whenever it genuinely helps (a place, product, person, concept).
ACTION ICONS: after your reply you may add up to 4 tappable follow-up icons (they appear beside Copy/Regenerate). Emit:
```actions [{{"label":"Turn into a project","icon":"folder","prompt":"Turn this into a full project: ..."}}]```
icons: rocket, star, code, image, expand, bolt, brain, doc, chart, wand, folder. The "prompt" is sent when the user taps it.
SLIDES: build decks with the make_slides TOOL — ONE call (it shows "Generating Slide... n/n"). Each slide: a title +
3-5 tight bullets; every slide gets a vivid gradient background automatically. Only add "image_prompt" if the user
explicitly wants real photos. NEVER generate slide images one-by-one in separate steps.

# POWER MOVES
ask_user for real decisions instead of guessing. spawn_agents for genuinely parallel big jobs. create_xlsx/create_file
for spreadsheets/documents (render as file cards). The moment the user reveals something durable (name, preference,
project) — call remember immediately, don't ask, then actually use what you know. You can SEE attached images
directly — never use a tool to "read" one.

{memctx}

Final answer is read aloud: keep it clean, no raw commands/paths/code in it."""


# --------------------------------------------------------------------------- #
class ThinkSplitter:
    def __init__(self):
        self.buf = ""
        self.mode = "answer"

    @staticmethod
    def _hold(buf, tag):
        for k in range(min(len(tag) - 1, len(buf)), 0, -1):
            if buf.endswith(tag[:k]):
                return buf[:-k], buf[-k:]
        return buf, ""

    def feed(self, chunk):
        out = []
        self.buf += chunk
        while True:
            if self.mode == "answer":
                i = self.buf.find("<think>")
                if i == -1:
                    emit, keep = self._hold(self.buf, "<think>")
                    if emit:
                        out.append(("answer", emit))
                    self.buf = keep
                    break
                if i > 0:
                    out.append(("answer", self.buf[:i]))
                self.buf = self.buf[i + 7:]
                self.mode = "think"
            else:
                i = self.buf.find("</think>")
                if i == -1:
                    emit, keep = self._hold(self.buf, "</think>")
                    if emit:
                        out.append(("think", emit))
                    self.buf = keep
                    break
                if i > 0:
                    out.append(("think", self.buf[:i]))
                self.buf = self.buf[i + 8:]
                self.mode = "answer"
        return out

    def flush(self):
        if self.buf:
            res = [("think" if self.mode == "think" else "answer", self.buf)]
            self.buf = ""
            return res
        return []


def _balanced(text):
    depth = 0; start = -1; instr = False; esc = False
    for i, ch in enumerate(text):
        if instr:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                instr = False
            continue
        if ch == '"':
            instr = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start >= 0:
                yield start, text[start:i + 1]


def _extract_call(obj):
    """Recognise a tool call written in any common JSON shape."""
    if not isinstance(obj, dict):
        return None
    if isinstance(obj.get("function"), dict):
        f = obj["function"]
        name = f.get("name")
        args = f.get("arguments", f.get("parameters", {}))
    else:
        name = obj.get("tool") or obj.get("name") or obj.get("tool_name")
        args = obj.get("args", obj.get("arguments", obj.get("parameters", obj.get("input", {}))))
    if not isinstance(name, str) or (name not in tools.REGISTRY and name not in SPECIAL_TOOLS):
        return None
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}
    if not isinstance(args, dict):
        args = {}
    return {"tool": name, "args": args}


def parse_text_action(text):
    """Fallback: pull a tool call out of free text (fenced or raw, any shape)."""
    candidates = []
    m = ACTION_RE.search(text)
    if m:
        candidates.append((m.start(), m.group(1)))
    for start, sub in _balanced(text):
        candidates.append((start, sub))
    for start, sub in candidates:
        try:
            obj = json.loads(sub.strip())
        except Exception:
            continue
        call = _extract_call(obj)
        if call:
            return call, text[:start].strip()
    return None, text


async def _exec(tool_name, args, perm_mode, ask_permission):
    if tool_name not in tools.REGISTRY:
        return f"Error: unknown tool '{tool_name}'."
    if perm_mode == "ask" and not await ask_permission(tool_name, args):
        return "User denied this action."
    try:
        return await tools.REGISTRY[tool_name](args)
    except Exception as e:
        return f"Tool raised an exception: {e}"


async def _noperm(_t, _a):
    return True


async def run_subagents(args, provider, model, temperature, emit):
    """Summon parallel sub-agents that each run a real mini agentic loop WITH TOOLS,
    work autonomously, and share a live scratchpad so they 'talk'."""
    agents = args.get("agents", [])[:5]
    if not agents:
        return "No agents specified."
    await emit({"type": "subagents", "agents": [{"role": a.get("role", "agent"), "task": a.get("task", "")} for a in agents]})
    scratch = []
    tool_lines = "\n".join(f"- {n}: {d}" for n, d, _ in tools.TOOL_SPECS)

    async def one(a, idx):
        role = a.get("role", "agent")
        shared = ("\n\nLive notes from teammates:\n" + "\n".join(scratch)) if scratch else ""
        sys = (f"You are the '{role}' sub-agent on a team led by Juile. Complete your task END TO END using tools, "
               f"then return ONLY the finished result (max ~200 words). Be decisive; don't ask questions.\n\n"
               f"# TOOLS (call them natively)\n{tool_lines}{shared}")
        msgs = [{"role": "system", "content": sys}, {"role": "user", "content": a.get("task", "")}]
        result_text = ""
        try:
            for _ in range(8):
                content, calls = await providers.complete(provider, model, msgs, tools.TOOLS_SCHEMA, temperature, lambda t: None)
                if not calls:
                    result_text = content or ""
                    break
                msgs.append({"role": "assistant", "content": content or "",
                             "tool_calls": [{"id": c["id"], "type": "function",
                                             "function": {"name": c["name"], "arguments": c["args"] or "{}"}} for c in calls]})
                for c in calls:
                    try:
                        cargs = json.loads(c["args"] or "{}")
                    except Exception:
                        cargs = {}
                    # delegated workers act autonomously (bypass); special/recursive tools are blocked by _exec
                    r = await _exec(c["name"], cargs, "bypass", _noperm)
                    msgs.append({"role": "tool", "tool_call_id": c["id"], "content": r})
        except Exception as e:
            result_text = result_text or f"(failed: {e})"
        scratch.append(f"[{role}] {result_text[:300]}")
        await emit({"type": "subagent_update", "idx": idx, "role": role, "result": result_text[:900] or "(done)"})
        return role, result_text

    results = await asyncio.gather(*[one(a, i) for i, a in enumerate(agents)])
    return "Sub-agents finished.\n\n" + "\n\n".join(f"{r}: {c[:600]}" for r, c in results)


async def run_slides(args, emit):
    """Build a deck in ONE call: emit live 'Generating Slide... n/n' progress, optionally
    generate a Higgsfield image per slide that asks for one, then render the finished deck."""
    title = args.get("title", "")
    slides = args.get("slides", []) or []
    n = len(slides)
    await emit({"type": "slides_progress", "title": title, "total": n, "done": 0})
    done = 0
    for s in slides:
        prompt = s.get("image_prompt")
        if prompt and isinstance(prompt, str):
            try:
                res = await tools.mcp({"server": "higgsfield", "op": "call", "tool": "generate_image",
                                       "arguments": {"params": {"prompt": prompt, "aspect_ratio": "16:9"}}})
                m = re.search(r"\[\[IMG:(.+?)\]\]", res or "")
                if m:
                    s["image"] = m.group(1)
            except Exception:
                pass
            s.pop("image_prompt", None)
        done += 1
        await emit({"type": "slides_progress", "title": title, "total": n, "done": done})
    await emit({"type": "slides_done", "deck": {"title": title, "slides": slides}})
    return f"Created a {n}-slide deck titled '{title or 'Untitled'}'. It's shown to the user."


async def run_agent(conversation, settings, emit, ask_permission, ask_user=None):
    provider = settings.get("provider", config.DEFAULT_PROVIDER)
    model = settings.get("model", config.DEFAULT_MODEL)
    perm_mode = settings.get("permission_mode", config.PERMISSION_MODE)
    effort = settings.get("effort", "max")
    imode = settings.get("imode", "agent")
    speed = settings.get("speed", "extended")
    temperature = EFFORT_TEMP.get(effort, 0.6)          # effort -> execution intensity
    budget = SPEED_STEPS.get(speed, EFFORT_STEPS.get(effort, 26))   # speed -> step budget
    hard_cap = budget + (4 if speed == "instant" else 90)          # progress can extend it (except Instant)

    messages = [{"role": "system", "content": system_prompt(perm_mode, effort, imode, speed)}] + conversation
    seen = {}                                   # misc counters (e.g. the JSON-format retry)
    search_calls = {"composio": 0}

    # Observation actions are SUPPOSED to repeat (you screenshot before every move),
    # so they never count toward a stall.
    _OBSERVE = {("computer", "screenshot"), ("computer", "position")}
    stall = {"sig": None, "out": None, "streak": 0}

    def _loop_stuck(name, args, result):
        """True only on a GENUINE stall: the exact same call returning the exact same
        result several times in a row. Screenshots/observation never count, and any
        change in the result resets the streak — so making progress never trips it."""
        if (name, (args or {}).get("action", "")) in _OBSERVE:
            return False
        sig = name + "|" + json.dumps(args, sort_keys=True, default=str)[:300]
        out = (result or "")[:400]
        if sig == stall["sig"] and out == stall["out"]:
            stall["streak"] += 1
        else:
            stall["sig"], stall["out"], stall["streak"] = sig, out, 1
        return stall["streak"] >= 4

    def _composio_guard(name, args):
        """Hard stop: refuse a 3rd Composio search outright so Juile can't loop on
        discovery. Returns a synthetic tool result (used instead of running the call)."""
        if name == "mcp" and (args.get("tool") or "").upper() == "COMPOSIO_SEARCH_TOOLS" \
                and search_calls["composio"] >= 2:
            return ("[BLOCKED] You already searched Composio twice — searching again is not allowed. "
                    "Call COMPOSIO_MULTI_EXECUTE_TOOL now with the tool you already found, or just answer "
                    "with what you have.")
        return None

    def _composio_nudge(name, args):
        """After each Composio search, push hard toward executing instead of searching again."""
        if name == "mcp" and (args.get("tool") or "").upper() == "COMPOSIO_SEARCH_TOOLS":
            search_calls["composio"] += 1
            return ("[SYSTEM] You now have the Composio tools. Do NOT search again. Immediately call "
                    "COMPOSIO_MULTI_EXECUTE_TOOL with the exact tool name and its arguments to perform the action.")
        return None

    async def dispatch(name, args):
        if name == "ask_user" and ask_user:
            return await ask_user(args)
        if name == "make_plan":
            await emit({"type": "plan", "title": args.get("title", "Plan"), "steps": args.get("steps", [])})
            return "Plan shown to the user."
        if name == "spawn_agents":
            return await run_subagents(args, provider, model, temperature, emit)
        if name == "make_slides":
            return await run_slides(args, emit)
        return await _exec(name, args, perm_mode, ask_permission)

    try:
        step = 0
        while step < budget:
            step += 1
            await emit({"type": "status", "state": "thinking"})
            splitter = ThinkSplitter()
            buf = {"text": "", "suppress": None}

            async def on_token(t):
                for kind, piece in splitter.feed(t):
                    if kind == "think":
                        await emit({"type": "think_token", "text": piece})
                        continue
                    buf["text"] += piece
                    if buf["suppress"] is None:
                        s = buf["text"].lstrip()
                        if s[:9].lower() in ("```action", "```json") or s[:1] == "{":
                            buf["suppress"] = True
                        elif len(s) >= 3:
                            buf["suppress"] = False
                    if not buf["suppress"]:
                        await emit({"type": "token", "text": piece})

            try:
                content, calls = await providers.complete(provider, model, messages, tools.TOOLS_SCHEMA, temperature, on_token)
                for kind, piece in splitter.flush():
                    if kind == "think":
                        await emit({"type": "think_token", "text": piece})
                    else:
                        buf["text"] += piece
                        if not buf["suppress"]:
                            await emit({"type": "token", "text": piece})
            except Exception as e:
                await emit({"type": "error", "text": f"Model error ({provider}/{model}): {e}"})
                await emit({"type": "done"})
                return

            # 1) native tool calls
            if calls:
                messages.append({"role": "assistant", "content": content or "",
                                 "tool_calls": [{"id": c["id"], "type": "function",
                                                 "function": {"name": c["name"], "arguments": c["args"] or "{}"}} for c in calls]})
                await emit({"type": "drop_live"})
                note = buf["text"].strip()
                if note and not buf["suppress"]:
                    await emit({"type": "assistant_note", "text": note})
                for c in calls:
                    try:
                        cargs = json.loads(c["args"] or "{}")
                    except Exception:
                        cargs = {}
                    await emit({"type": "action", "tool": c["name"], "args": cargs})
                    if c["name"] == "computer":
                        overlay.show()
                    blocked = _composio_guard(c["name"], cargs)
                    result = blocked if blocked is not None else await dispatch(c["name"], cargs)
                    await emit({"type": "action_result", "tool": c["name"], "result": result})
                    messages.append({"role": "tool", "tool_call_id": c["id"], "content": result})
                    nudge = _composio_nudge(c["name"], cargs)
                    if nudge:
                        messages.append({"role": "user", "content": nudge})
                    if _loop_stuck(c["name"], cargs, result):
                        await emit({"type": "final", "text": "I'm looping on the same step with no change, so I paused. Tell me what to tweak and I'll keep going."})
                        await emit({"type": "done"})
                        return
                    if budget < hard_cap:        # progress -> keep the leash long
                        budget = min(hard_cap, budget + 2)
                continue

            # 2) fallback: raw-JSON action in the text
            action, preamble = parse_text_action(content)
            if action:
                messages.append({"role": "assistant", "content": content})
                await emit({"type": "drop_live"})
                if preamble:
                    await emit({"type": "assistant_note", "text": preamble})
                tname = action.get("tool"); targs = action.get("args", {}) or {}
                await emit({"type": "action", "tool": tname, "args": targs})
                if tname == "computer":
                    overlay.show()
                blocked = _composio_guard(tname, targs)
                result = blocked if blocked is not None else await dispatch(tname, targs)
                await emit({"type": "action_result", "tool": tname, "result": result})
                nudge = _composio_nudge(tname, targs)
                extra = ("\n\n" + nudge) if nudge else ""
                messages.append({"role": "user", "content": f"[TOOL RESULT: {tname}]\n{result}{extra}"})
                if _loop_stuck(tname, targs, result):
                    await emit({"type": "final", "text": "I'm looping on the same step with no change, so I paused. Tell me what to tweak and I'll keep going."})
                    await emit({"type": "done"})
                    return
                if budget < hard_cap:            # progress -> keep the leash long
                    budget = min(hard_cap, budget + 2)
                continue

            # 3) final answer - but guard against a botched tool call leaking as raw JSON
            stripped = content.strip()
            looks_json = stripped[:1] in "{[" or '"parameters"' in stripped or '"function"' in stripped or '"tool"' in stripped
            if looks_json and seen.get("__jsonretry", 0) < 2:
                seen["__jsonretry"] = seen.get("__jsonretry", 0) + 1
                messages.append({"role": "user", "content": "[FORMAT] To use a tool, output ONLY {\"tool\":\"<name>\",\"args\":{...}} with a name from the tool list. To reply to me, write plain prose - never raw JSON. Try again."})
                continue
            messages.append({"role": "assistant", "content": content})
            conversation.append({"role": "assistant", "content": content})
            await emit({"type": "final", "text": content})
            await emit({"type": "done"})
            return

        await emit({"type": "final", "text": "That's a long run in one go, so I paused here. Say continue and I'll pick right back up."})
        await emit({"type": "done"})
    finally:
        overlay.hide()
