# Performance

Codefall Face targets a stable 60 fps desktop experience and a conservative adaptive path for constrained devices.

## Render tiers

`high`, `medium`, and `low` tiers adjust column density, glow work, rain/debris density, and secondary cybernetic detail. `auto` watches 120 eligible frames at a time:

- two slow windows trigger a downgrade;
- four fast windows trigger an upgrade;
- an eight-second cooldown prevents oscillation;
- hidden and resize frames do not influence the decision.

The selected policy and active tier are separate in snapshots and the control deck.

## Allocation discipline

`SceneBuffers` owns typed arrays for brightness, region, distance, material, depth, substrate, glyph, and churn phase. Buffers are reused until geometry changes. Eye and mouth position objects and the runtime frame snapshot are also reused.

## Determinism

Named seeded random streams make 60-second animation and event sequences reproducible without coupling subsystems. This supports regression checks for event duration, displacement budgets, anatomy coverage, and reduced-motion behavior.

## Browser gates

The Playwright suite samples rendered canvas output, lifecycle cleanup, responsive controls, reduced motion, and frame pacing. Run it after installing Chromium:

```bash
npm install
npx playwright install chromium
npm run test:browser
```
