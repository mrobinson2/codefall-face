# Architecture

Codefall Face 3.0 uses one-way frame ownership: conversational state enters the runtime, the runtime produces a reusable frame snapshot, and the renderer consumes that snapshot. Rendering never invents blink, gaze, speech, or glitch state.

```text
Provider / Agent / UI
         |
         v
  CodefallFace facade
    |      |      |
    v      v      v
 Runtime  Provider Agent channel
    |
    v
 Frame snapshot --> Renderer --> Canvas
                     |
                     +--> SceneBuffers + QualityController
```

## Facade

`src/codefall-face.js` owns initialization, lifecycle, visibility pause/resume, provider selection, agent attachment, and the public API. It is the only layer the control deck calls.

## Deterministic runtime

`src/runtime/face-runtime.js` combines the state machine, gaze/blink controller, speech animation, emotion, coherence, sway, and visual-event scheduler. Named random streams isolate gaze, rain, debris, visual events, speech, persona, and agent behavior so adding one random draw does not perturb unrelated systems.

## Renderer

`src/face/renderer.js` renders ordered passes over reusable `SceneBuffers`. The face model classifies each tile by anatomical region, material, depth, and substrate. `render-passes.js` defines the canonical pass order. `QualityController` adapts resolution and effects using stable frame windows and cooldowns.

Visual events modify presentation only:

- Seam crawl energizes boundary tiles.
- Ocular desynchronization offsets and desaturates one eye glow.
- Mask slip displaces skin tiles while anchoring facial landmarks.
- Aperture breach suppresses skin and reveals cavities, actuators, plates, and conduits from the independent substrate field.

## Voice and agent boundaries

`ProviderManager` owns provider generations and guarantees stale asynchronous providers are disposed. Adapters own their timers, sockets, sources, and effects. `AgentChannel` validates exact command schemas, forwards normalized events, and reconnects with bounded backoff.

## UI

`ControlDeck` talks only to the public facade. Presentation preferences are versioned and normalized before persistence. Conversation text, credentials, and provider payloads are never stored.

## Server

`server/server.mjs` hosts provider relays, agent endpoints, and static files. Shared HTTP utilities enforce bounded bodies, consistent JSON errors, request IDs, security headers, safe paths, ETags, and HEAD behavior.
