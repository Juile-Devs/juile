# Frontend Design Principles (world-class UI)

Use this whenever you build or restyle any UI. The goal: ship interfaces that look
intentional and premium, never a grey-box MVP. Opinionated defaults below — follow them
unless the brief says otherwise.

## 1. Hierarchy first
- Every screen has ONE primary action. Make it the most prominent thing (size, color, weight, position). Everything else is quieter.
- Establish hierarchy with **size, weight, and color/contrast** — in that order — not borders and boxes.
- Squint test: blur your eyes; the most important element should still dominate.

## 2. Space is a feature (8pt grid)
- Use a spacing scale: **4, 8, 12, 16, 24, 32, 48, 64, 96**. Never arbitrary `13px`.
- Give content room. Cramped UIs read as cheap. Generous whitespace reads as confident.
- Group related items with proximity; separate unrelated ones with space, not dividers.
- Consistent rhythm: the same gap between like elements everywhere.

## 3. Type scale
- One typeface for UI is fine (Inter, Geist, system-ui). Pair at most two.
- Use a modular scale (~1.2–1.25 ratio): e.g. 12, 14, 16, 20, 24, 32, 40.
- Body text 16px min; line-height ~1.5 for body, ~1.2 for headings. Line length 45–75 chars.
- Weight does the work: 400 body, 500–600 emphasis, 600–700 headings. Avoid faux-bolding everything.

## 4. Color with restraint
- One strong accent. Neutrals (a true gray ramp, 8–10 steps) carry 90% of the UI.
- Don't use pure `#000`/`#fff` for large surfaces — slightly tinted darks/lights feel richer.
- Convey state with color + a second cue (icon/label) for accessibility.
- Gradients and glass: subtle, purposeful. A faint accent-to-transparent ramp reads as glow.

## 5. Depth & surface
- Elevation via soft, layered shadows (small tight + large diffuse), not one harsh shadow.
- Border-radius consistent across the system (e.g. 8/12/16). Match radii to scale.
- Light from a single consistent direction. Subtle borders (1px, low-contrast) define edges on glass.

## 6. Motion that informs
- Animate to explain change, not to decorate. 120–240ms for most UI transitions.
- Ease-out for things entering, ease-in for leaving. Use `cubic-bezier(0.2, 0, 0, 1)` as a tasteful default.
- Respect `prefers-reduced-motion`. Never block interaction on animation.

## 7. States are not optional
Design ALL of them, every time:
- **Empty** (first-run guidance, not a blank void), **loading** (skeletons/shimmer, not just spinners),
  **error** (what happened + how to fix), **success**, **hover**, **active/pressed**, **focus** (visible ring),
  **disabled**, **selected**. A UI without these states looks unfinished because it is.

## 8. Accessibility = quality
- Contrast: 4.5:1 body text, 3:1 large text/UI (WCAG AA). Check it.
- Every interactive element is keyboard-reachable with a visible focus ring.
- Hit targets ≥ 44×44px. Label icons. Don't rely on color alone.

## 9. Responsive by default
- Mobile-first. Fluid type/space with `clamp()`. Test 360px → 1440px+.
- Reflow, don't shrink: change layout at breakpoints rather than scaling everything down.

## 10. Polish pass (before you call it done)
- Align to the grid; kill 1px misalignments. Consistent corner radii and shadows.
- Optical alignment beats mathematical (icons next to text often need a nudge).
- Real content, not lorem ipsum — long names, empty lists, huge numbers all must look right.
- For real UI, `web_search` current top-tier references first so it feels current.

> Default stack when unspecified: system-ui/Inter, an 8pt grid, a neutral ramp + one accent,
> soft layered shadows, 12px radius, 160ms ease-out motion, full state coverage. Then refine.
