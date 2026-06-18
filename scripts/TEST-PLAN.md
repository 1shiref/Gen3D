# Gen3D — Full Feature Test Plan

Backend: http://localhost:3001  •  Frontend: http://localhost:5173 (Vite proxies /api → backend)

## Section A — Health & System
- A1: `GET /api/health` → 200, returns `ai.chain` with ≥1 ready entries, `openscad: true`.
- A2: `GET /api/health` includes the active entry id.

## Section B — Upload
- B1: `POST /api/upload` with no `images` field → error.
- B2: `POST /api/upload` with one PNG → 200, returns one ref with `ref`, `url`.
- B3: `POST /api/upload` with three PNGs → 200, returns three refs.

## Section C — Generate Validation (no AI required)
- C1: `POST /api/generate` with empty body → SSE `error` (`NO_INPUT`).
- C2: `POST /api/generate` with `imageRefs="malformed json"` and no prompt → graceful (warns, treats as no images, then NO_INPUT or proceeds with text).
- C3: `POST /api/generate` with `imageRefs=["nonexistent.png"]` and no prompt → graceful (skips, treats as no images).

## Section D — Generate (Text-only, full AI roundtrip)
- D1: `POST /api/generate strategy=text-to-csg prompt="a 20mm cube"` → SSE stream: `status` → `provider_info` → tokens → `scad_complete` → `compiling` → `stl_ready` → `done`.
- D2: Validate `stl_ready` payload contains a non-zero bounding box, materialSuggestion, and an STL URL whose target file exists and is non-empty.
- D3: Validate `previewUrl` PNG exists (or is null if render failed — non-fatal).

## Section E — Generate (Image + vision pipeline)
- E1: Upload an image, then `POST /api/generate strategy=vision-to-openscad imageRefs=[...]` → two-step (analysis status, then code), eventually `stl_ready`.
- E2: `provider_info` fires before first SCAD token.

## Section F — Generate (Abort)
- F1: Open generate stream, abort after 500ms → backend logs abort, no SSE writes after close.

## Section G — Edit
- G1: `POST /api/edit` with empty body → SSE `error` (`MISSING_PARAMS`).
- G2: `POST /api/edit` with valid `scadCode` and `instruction="make it taller"` → SSE stream ends with `stl_ready`.

## Section H — Slice
- H1: `POST /api/slice` with no body → 400.
- H2: `POST /api/slice` with non-existent stlPath → 404.
- H3: `POST /api/slice` with valid STL + valid settings → 200 with gcode URL, layerCount > 0.
- H4: `POST /api/slice` with valid STL but missing `settings` field → 200 (uses defaults).

## Section I — Export / Files
- I1: `GET /api/files/nonexistent.stl` → 404.
- I2: `GET /api/files/<valid stl>` → 200 with `model/stl` Content-Type.
- I3: `GET /api/export/obj/nonexistent.stl` → 404.
- I4: `GET /api/export/obj/<valid stl>` → 200 OBJ text starting with `# OBJ`.
- I5: `POST /api/export/zip` with valid ProjectState → 200 ZIP, downloads.

## Section J — OpenSCAD compile direct
- J1: Compile a valid SCAD string → STL non-empty.
- J2: Compile a broken SCAD string → AI fix loop runs, ultimately STL produced OR fails after 5 attempts with proper error.
- J3: Compile a truncated SCAD (unbalanced braces) → pre-fix triggered before compile.

## Section K — Provider fallback chain
- K1: With ANTHROPIC_API_KEY set but billing failed (simulated), call resolves via next provider.
- K2: First-token timeout: provider that hangs gets skipped after 30s.

## Section L — Frontend smoke
- L1: `npm run build` in frontend → success.
- L2: Dev server starts and serves index.html.
