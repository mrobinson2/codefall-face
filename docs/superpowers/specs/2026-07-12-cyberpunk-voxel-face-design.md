# Cyberpunk Voxel Face Design

## Goal

Turn Codefall Face into a haunting digital human assembled from machine tiles. The face should read as human at a glance and synthetic on inspection. Short possession events will break the disguise and expose a deeper machine structure.

The supplied references establish the target: a pale tessellated face, hard facial lighting, a broken white halo, and a lower jaw that dissolves into suspended blocks.

## Scope

This work upgrades the existing wintermute theme and makes it the default face theme. The green codefall theme remains available through configuration.

The redesign covers:

- facial silhouette and surface structure
- glyph and tile vocabulary
- lighting and depth
- halo treatment
- jaw and neck disintegration
- possession glitch events
- speech-driven mouth deformation
- reduced-motion and quality behavior

Voice providers, conversation logic, console layout, and public speech APIs stay unchanged.

## Visual Design

### Human silhouette

The head keeps human proportions with a flatter temple line, high cheek planes, a clear jaw corner, and a narrow chin. The outline uses connected planar segments instead of a smooth oval. The eyes, nose, mouth, and current expression system remain legible.

The renderer will preserve slight asymmetry. One cheek can carry a dim circular port, and the eye assemblies can differ by a small amount. The stable face should feel manufactured without reading as a robot mask.

### Tessellated skin

Dense square and rectangular glyphs form the face. Large tiles define the forehead and outer cheeks. Smaller marks cluster around the eyes, nose, and lips to preserve expression.

Three brightness levels establish depth:

1. Forehead, eye rims, nose bridge, and upper cheek ridges receive the brightest values.
2. Mid-face planes carry the main tile field.
3. Temples, lower cheeks, and jaw sides fade toward black.

Dim seams interrupt the tile field along the brow, cheek, nose, and jaw planes. Small diagnostic marks appear at the temples and jaw, but they stay subordinate to the human features.

### Eyes and mouth

Each eye has a dark socket, a tiled rim, and a cold point of light. Blink and gaze behavior continue to drive the eye geometry. Glow remains tight enough to preserve the surrounding tiles.

At rest, the mouth uses compact horizontal tiles. Speech opens a deep black cavity and pulls nearby tiles into the lip shape. Wide phonemes can expose a dark machine aperture, as shown in the second reference image. The cavity must not erase lip-sync motion.

### Halo and background

A bright broken ring sits behind the head. The ring has one large gap on the right and minor irregular breaks around its circumference. A narrow white core and restrained bloom make it the brightest element in the scene.

The background remains black with sparse rain and particles. The wintermute rain becomes dimmer near the face so the silhouette stays clear. A few slow particles may cross the halo and catch its light.

### Disintegration

The lower jaw and neck shed square blocks into a suspended data field. Emission concentrates below the chin and weakens near the eyes. Blocks start close to the face color, dim as they descend, and drift sideways before disappearing.

The stable face loses only a small number of tiles. Boot assembly, low coherence, and possession events increase the loss rate.

## Possession Events

The face stays coherent most of the time. The renderer schedules a possession event every 7 to 18 seconds, with enough random variation to prevent an obvious loop. Each event lasts 180 to 650 milliseconds and can contain two or three short pulses.

An event can combine:

- horizontal bands that shift tile clusters left or right
- a duplicated eye or mouth fragment with a small vertical offset
- a temporary black aperture at a temple, cheek, or mouth
- bright machine tiles inside the displaced gap
- a short halo interruption
- a burst of falling blocks

The renderer limits displacement to selected bands. Most of the face remains anchored so the viewer still recognizes the human host.

Emotion and speech affect event intensity. Thinking can increase fine tile churn. Speaking can bias glitches toward the mouth and jaw. Strong emotions can alter frequency within a safe range. No state should create constant full-face noise.

Reduced-motion mode disables displacement and duplicate features. It keeps the angular tile face, halo, and a static suggestion of machine apertures.

## Rendering Architecture

### Face model

src/face/face-model.js continues to own anatomy. Its signed-distance geometry will use piecewise planar widths for the skull, cheek, jaw, and chin. The model will add deterministic facet bands and surface shading based on the existing per-cell noise.

The renderer will allocate a material buffer beside bright, region, and sdf. The face model will fill this buffer with flags for tile skin, seam, aperture, machine interior, and loose shard. Anatomy remains in region, which allows an eye or mouth cell to retain its expressive role while also carrying a machine material.

### Glyph vocabulary

src/face/glyphs.js will add compact tile sets for broad skin, fine facial detail, seams, ports, and machine interiors. The wintermute theme will favor square marks and restrained punctuation. The green codefall theme will keep its current character-heavy vocabulary.

### Renderer

src/face/renderer.js will keep the atlas-based canvas pipeline. It will render the scene in this order:

1. fade and dark background
2. dim rain and background particles
3. broken halo
4. face tiles with planar lighting
5. eyes, mouth cavity, seams, and apertures
6. possession displacement and duplicate fragments
7. jaw and neck debris

The renderer will reuse typed buffers and bounded event arrays. Possession events will update existing cells at draw time instead of allocating a second full-resolution canvas each frame.

An internal possession state will track the next event time, pulse envelope, active bands, and aperture location. A seeded or deterministic helper will generate band geometry so event behavior can be tested.

### Application state

src/codefall-face.js will continue to supply emotion, gaze, mouth, coherence, and lifecycle state. The renderer derives visual intensity from those values. No public API changes are required.

src/config.js will set wintermute as the default theme. Users can still request codefall.

## Quality and Performance

High quality uses the densest current cell grid and all surface details. Medium quality uses fewer secondary seams and fewer debris particles. Low quality keeps the silhouette, primary facial tiles, eyes, mouth, and halo while dropping micro-labels and most loose shards.

The renderer must avoid per-cell object creation inside the frame loop. Resize may rebuild typed arrays and the glyph atlas. A desktop high-quality run should hold the current target frame rate, and mobile should remain responsive at medium quality.

## Failure Handling

Unknown themes continue to fall back to codefall. Missing or unsupported canvas features use the existing 2D path.

The material buffer defaults to ordinary face tiles if the model does not assign a material. Invalid glitch bands get clamped to the canvas bounds. Resize cancels the active possession event before rebuilding grid state.

Reduced-motion mode provides the complete static design without rapid movement or flashing.

## Verification

Implementation will verify:

- neutral, speaking, thinking, and strong-emotion states
- gaze and blink readability through the tile surface
- closed, narrow, and wide mouth shapes
- coherent and possession-event frames
- boot assembly and low-coherence disintegration
- wintermute and legacy codefall themes
- high, medium, and low quality
- desktop, narrow mobile, and high-DPI canvases
- reduced-motion behavior
- resize during idle and during an event

Pure event-envelope and band-clamping helpers will live in src/face/possession.mjs. Tests in test/possession.test.mjs will use Node's built-in test runner and fixed random inputs. Visual verification will compare captured frames against the approved references and confirm that the face remains human, chiseled, dense, and readable.

## Acceptance Criteria

- The default view shows a cold, tile-built human face inside a broken luminous halo.
- The head has angular temples, cheeks, jaw corners, and chin instead of a smooth oval.
- Surface tiles describe facial volume and preserve expression at normal viewing size.
- The mouth opens into a dark cavity during speech.
- The jaw and neck dissolve into suspended square debris.
- Possession events expose machine apertures through localized displacement while keeping most of the face recognizable.
- Reduced-motion mode removes rapid displacement and flashing.
- The legacy green codefall theme remains selectable.
- Existing speech, emotion, blink, gaze, boot, and resize behavior still works.
