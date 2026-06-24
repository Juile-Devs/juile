"""Full-screen, click-through desktop overlay shown while Juile controls the computer:

  * a glowing BLUE / light-blue gradient that blooms inward from every screen edge
    (corners bloom brightest), softly fading to invisible toward the center,
  * a center-bottom banner: "Juile is controlling your computer",
  * Juile's OWN blue cursor — a second pointer that glides to wherever Juile acts.

show() makes ALL of it appear; hide() makes ALL of it vanish (glow, banner, cursor).
Purely cosmetic — every failure is swallowed so it can never break the agent.
"""
import threading

# tx,ty = Juile's target; cx,cy = the eased on-screen position of the blue cursor.
_state = {"visible": False, "started": False, "tx": None, "ty": None,
          "cx": None, "cy": None, "pulse": False}


def _run():
    try:
        import tkinter as tk
        import ctypes
        import pyautogui
    except Exception:
        return

    try:
        root = tk.Tk()
        root.overrideredirect(True)
        root.attributes("-topmost", True)
        sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
        root.geometry(f"{sw}x{sh}+0+0")
        root.config(bg="black")
        try:
            root.attributes("-transparentcolor", "black")   # black == fully transparent
            root.attributes("-alpha", 0.95)
        except Exception:
            pass
        canvas = tk.Canvas(root, width=sw, height=sh, bg="black", highlightthickness=0)
        canvas.pack()

        # make the whole window click-through so it never blocks Juile or the user
        try:
            GWL_EXSTYLE = -20
            WS_EX_LAYERED = 0x80000
            WS_EX_TRANSPARENT = 0x20
            WS_EX_TOOLWINDOW = 0x80
            hwnd = ctypes.windll.user32.GetParent(root.winfo_id()) or root.winfo_id()
            style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            ctypes.windll.user32.SetWindowLongW(
                hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW)
        except Exception:
            pass

        # --- blue gradient glow blooming inward from every edge ---------------- #
        # Because black is transparent, fading a colour toward black fades it to
        # invisible — so a colour->black ramp from each edge reads as a soft glow.
        DEPTH = max(80, sh // 8)
        EDGE = (150, 210, 255)        # light blue right at the screen edge
        STEPS = 40

        def _hex(t):
            return "#%02x%02x%02x" % (max(0, min(255, int(t[0]))),
                                      max(0, min(255, int(t[1]))),
                                      max(0, min(255, int(t[2]))))

        glow_items = []

        def draw_glow():
            for it in glow_items:
                canvas.delete(it)
            glow_items.clear()
            for i in range(STEPS):
                f = (1 - i / STEPS) ** 1.7        # bright at edge -> 0 inward
                col = _hex((EDGE[0] * f, EDGE[1] * f, EDGE[2] * f))
                d0 = int(i / STEPS * DEPTH)
                d1 = int((i + 1) / STEPS * DEPTH)
                glow_items.append(canvas.create_rectangle(0, d0, sw, d1, fill=col, outline=col))                # top
                glow_items.append(canvas.create_rectangle(0, sh - d1, sw, sh - d0, fill=col, outline=col))      # bottom
                glow_items.append(canvas.create_rectangle(d0, 0, d1, sh, fill=col, outline=col))                # left
                glow_items.append(canvas.create_rectangle(sw - d1, 0, sw - d0, sh, fill=col, outline=col))      # right

        def clear_glow():
            for it in glow_items:
                canvas.delete(it)
            glow_items.clear()

        # --- center-bottom banner --------------------------------------------- #
        by = sh - 56
        banner_bg = canvas.create_rectangle(sw // 2 - 205, by - 21, sw // 2 + 205, by + 21,
                                            fill="#0a1830", outline="#3aa0ff", width=2)
        banner = canvas.create_text(sw // 2, by, text="Juile is controlling your computer",
                                    fill="#dbeeff", font=("Segoe UI", 13, "bold"))

        # --- Juile's blue cursor ---------------------------------------------- #
        SHAPE = [(0, 0), (0, 18), (5, 13), (8.5, 20), (11, 19), (8, 12), (15, 12)]

        def ptr(x, y, s=2.1):
            out = []
            for dx, dy in SHAPE:
                out += [x + dx * s, y + dy * s]
            return out

        halo2 = canvas.create_oval(0, 0, 0, 0, outline="#1f6fff", width=2, state="hidden")
        halo = canvas.create_oval(0, 0, 0, 0, outline="#7fc4ff", width=3, state="hidden")
        ring = canvas.create_oval(0, 0, 0, 0, outline="#2b8cff", width=3, state="hidden")
        shadow = canvas.create_polygon(*ptr(2, 3), fill="#06101f", outline="")
        cursor = canvas.create_polygon(*ptr(0, 0), fill="#2b8cff", outline="#eaf4ff", width=2)
        label = canvas.create_text(0, 0, text="Juile", fill="#cfe6ff", font=("Segoe UI", 11, "bold"), anchor="w")
        HIDE_ALL = (banner_bg, banner, halo2, halo, ring, shadow, cursor, label)
        frame = {"i": 0, "pulse": 0, "glow": False}

        def tick():
            frame["i"] += 1
            if _state["visible"]:
                if root.state() == "withdrawn":
                    root.deiconify()
                if not frame["glow"]:
                    draw_glow()
                    frame["glow"] = True
                tx, ty = _state["tx"], _state["ty"]
                if tx is None or ty is None:
                    try:
                        tx, ty = pyautogui.position()
                    except Exception:
                        tx, ty = sw // 2, sh // 2
                if _state["cx"] is None:
                    _state["cx"], _state["cy"] = tx, ty
                _state["cx"] += (tx - _state["cx"]) * 0.35
                _state["cy"] += (ty - _state["cy"]) * 0.35
                x, y = _state["cx"], _state["cy"]
                canvas.coords(shadow, *ptr(x + 2, y + 4))
                canvas.coords(cursor, *ptr(x, y))
                canvas.coords(label, x + 34, y + 40)
                pulse = 4 + 2 * abs((frame["i"] % 40) - 20) / 20.0
                for rr, it in ((30 + pulse, halo), (44 + pulse, halo2)):
                    canvas.coords(it, x - rr, y - rr, x + rr, y + rr)
                for it in (banner_bg, banner, halo2, halo, shadow, cursor, label):
                    canvas.itemconfig(it, state="normal")
                # click ripple
                if _state["pulse"]:
                    _state["pulse"] = False
                    frame["pulse"] = 1
                if frame["pulse"]:
                    k = frame["pulse"]
                    r = 6 + k * 5
                    canvas.coords(ring, x - r, y - r, x + r, y + r)
                    canvas.itemconfig(ring, state="normal", width=max(1, 5 - k // 3))
                    frame["pulse"] = k + 1 if k < 12 else 0
                    if frame["pulse"] == 0:
                        canvas.itemconfig(ring, state="hidden")
                else:
                    canvas.itemconfig(ring, state="hidden")
            else:
                # vanish EVERYTHING — glow, banner, cursor
                if frame["glow"]:
                    clear_glow()
                    frame["glow"] = False
                for it in HIDE_ALL:
                    canvas.itemconfig(it, state="hidden")
                if root.state() != "withdrawn":
                    root.withdraw()
            root.after(16, tick)

        root.withdraw()
        root.after(16, tick)
        root.mainloop()
    except Exception:
        pass


def _ensure():
    if not _state["started"]:
        _state["started"] = True
        threading.Thread(target=_run, daemon=True).start()


def set_pos(x, y):
    """Point Juile's blue cursor at (x, y); it glides there on the next frames."""
    try:
        _state["tx"], _state["ty"] = int(x), int(y)
    except Exception:
        pass


def pulse():
    """Trigger a click ripple at the cursor's current spot."""
    _state["pulse"] = True


def show():
    """Make the blue cursor + glowing blue screen edges + banner APPEAR (centered)."""
    try:
        _ensure()
        try:
            import pyautogui
            w, h = pyautogui.size()
            _state["tx"], _state["ty"] = w // 2, h // 2
            if not _state["visible"]:                 # appear centered, not gliding from a stale spot
                _state["cx"], _state["cy"] = w // 2, h // 2
        except Exception:
            pass
        _state["visible"] = True
    except Exception:
        pass


def hide():
    """Make the cursor, the glow, and the banner all BEGONE."""
    _state["visible"] = False
