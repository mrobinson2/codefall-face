# Accessibility

The 3.0 control deck is designed for keyboard, touch, screen reader, zoom, and reduced-motion use.

## Interaction contract

- Every interactive control has a visible label or accessible name.
- Toggle state is exposed with `aria-pressed`; console collapse uses `aria-expanded`.
- Keyboard focus uses a high-contrast 2px outline.
- Touch targets are at least 44px.
- Live status announcements are separate from partial transcript output to prevent repeated speech.
- The viewport remains user-zoomable.
- Layout remains usable at 320px and 360px widths.

## Motion

The default `reducedMotion: 'auto'` follows `prefers-reduced-motion`. Users can also select full or reduced motion from the control deck. Reduced motion suppresses high-displacement mask slips and breaches while retaining non-motion status cues and a stable face.

## Visual contrast

The face remains decorative canvas content; conversational state and provider health are always represented in DOM text. Control states do not rely on color alone. The Wintermute palette uses bright foreground glyphs against a near-black field with explicit focus treatment.

## Verification

The Node suite checks accessible names, pressed/expanded state, preference normalization, listener cleanup, and status/transcript separation. The Playwright accessibility spec adds keyboard traversal, viewport, and reduced-motion browser checks.
