# UI Polish Checklist (make it not look like an MVP)

Run this pass before declaring any UI "done." Each item is the difference between a
prototype and a product.

## Layout & spacing
- [ ] Everything aligns to one spacing scale (4/8/12/16/24/32/48/64). No stray `13px`.
- [ ] Consistent gaps between like elements; intentional whitespace around content.
- [ ] No 1px misalignments. Optical alignment for icons/text where needed.
- [ ] Max content width set for readability; line length 45–75 chars for prose.

## Type
- [ ] A modular type scale, not random sizes. Body ≥ 16px, line-height ~1.5.
- [ ] Weights used for hierarchy (400/500/600/700); no faux bold.
- [ ] Numerals/tabular figures align in tables. No orphaned single words where avoidable.

## Color & contrast
- [ ] One accent; neutrals carry the UI. No pure black/white on large surfaces.
- [ ] Text contrast ≥ 4.5:1 (AA); UI/large text ≥ 3:1. Verified, not eyeballed.
- [ ] State never communicated by color alone (add icon/label).

## Depth & shape
- [ ] Consistent border-radius across components.
- [ ] Soft, layered shadows (not one harsh drop). Consistent light direction.
- [ ] Subtle 1px borders define edges on glass/low-contrast surfaces.

## Every state present
- [ ] Empty state with guidance (not a blank screen).
- [ ] Loading state with skeletons/shimmer (not just a spinner).
- [ ] Error state: what happened + how to recover.
- [ ] Hover, active/pressed, focus (visible ring), disabled, selected.

## Interaction & motion
- [ ] Transitions 120–240ms, ease-out in / ease-in out. Nothing janky.
- [ ] `prefers-reduced-motion` respected.
- [ ] Hit targets ≥ 44×44px. Full keyboard navigation with visible focus.
- [ ] Buttons show pending state on async actions; no double-submit.

## Content & resilience
- [ ] Real content tested: long strings, empty lists, huge numbers, errors.
- [ ] Truncation/wrapping handled gracefully (ellipsis, tooltips).
- [ ] Responsive 360px → 1440px+: layout reflows, nothing overflows or clips.

## Final
- [ ] Favicon/app icon, page title, and meta set.
- [ ] Dark mode (if applicable) checked for contrast and surface tints.
- [ ] No console errors. No layout shift on load (reserve space for media).
