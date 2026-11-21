# Claude Code handoff for The Hush

Implement The Hush as an interactive character in the game repository you are working in. Start by identifying the game's engine, dialogue system, audio bus, input handling, save data, and rules for adding an NPC or encounter. Build one playable encounter that uses the game's existing conventions for those features.

Use the original Babylon.js portrait and voice code in `/Volumes/Forge/07-Projects/codefall-face`. If that path is unavailable, obtain the local Codefall Face working tree from me. It contains the latest portrait and voice work.

- `babylon/src/main.ts` shows how the camera, lights, effects, and reveal are assembled. The reveal begins with faint eyes and a silhouette, brings the face into the light over 4.2 seconds, and introduces the tendrils last.
- `babylon/src/face.ts`, `skin.ts`, `tiles.ts`, and `energy.ts` define the sculpted metal face, raised tiles, moods, and effects. Preserve the satin silver, blue-gray steel, and warm bronze palettes and subtle expressions.
- `babylon/src/voice.ts` is the reusable browser voice controller. It exposes `connect()`, `setListening(enabled)`, `ask(text)`, `speak(text)`, `interrupt()`, `disconnect()`, and `setStoryPhase(phase)`. Subscribe to its state and transcript callbacks. Drive `face.setSpeech(open, wide, speaking)` with the values from `voice.tick(deltaSeconds)` and `voice.isSpeaking()` once per rendered frame.
- `docs/HUSH-VOICE-LIVE.md` explains the Azure Voice Live configuration, asset paths, and server relay.

For a web game, import the reusable TypeScript modules and use the existing preview entry point as the assembly reference. For a native engine, check whether the game's supported WebView can render Babylon.js, play Web Audio, and request microphone permission in a packaged build. Use a narrow, origin-checked bridge between the game and a WebView if needed. If the target cannot run that stack, document the limitation and use a native equivalent for the portrait and audio transport. Treat the reference MP4 as a fallback for the entrance only. An interactive face needs a live mouth rig and dialogue controls.

The Hush sounds calm and friendly when first encountered. Let him provide real relief before he makes a larger promise. As the story develops, the player learns that he lied about the price of the peace and pleasure he offered. His demonic bargain costs the character their soul. Keep his voice gentle through the revelation. An optional opening or callback line is “I can make it quiet. All you have to do is say yes.”

The game owns progression and calls `setStoryPhase("friendly")`, `setStoryPhase("uneasy")`, or `setStoryPhase("revealed")` at authored checkpoints. The first meeting starts in `friendly`. Send only the story facts appropriate to the current scene. Any quest outcome or bargain must come from a separate game action with confirmation. Spoken player input, generated dialogue, and captions carry no authority to alter save data.

Provide typed input and captions alongside the microphone. Start microphone capture after the player chooses it. Use a gesture to unlock audio, and release the microphone and connection when the encounter closes, the player disconnects, or the scene unloads. Respect reduced motion. Route the authenticated game client to a same-origin relay for Microsoft Foundry Voice Live and keep credentials on the server.

Verify the complete encounter in the target build. Check the reveal, stage changes without early spoilers, typed and microphone turns, visible lip motion during speech, interruption, microphone release on exit, and playability if voice access is denied or the service is unavailable. Report which checks used a mock and which used a configured Azure resource.
