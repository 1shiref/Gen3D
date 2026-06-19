# Gen3D — How to Use It

Once Gen3D is running (see [SETUP.md](SETUP.md)), open it in your browser:
`http://<pi-ip>:3001` (production) or `http://<pi-ip>:5173` (dev).

The flow is: **describe or upload → pick a model → edit → slice → print.**

---

## 1. Generate a model

**From text:** type a description (e.g. *"a low-poly fox sitting"*) and Generate. Gen3D
turns the prompt into a reference image, then meshes it.

**From an image:** upload a photo (drag-and-drop or the upload button) and Generate. Each
generation engine produces a candidate — **pick the one you like best** from the candidates.

> Tip: simple, well-lit, single-object images on a plain background give the cleanest meshes.

## 2. Edit the model

- **Smart plan editing** — describe a goal in plain English (e.g. *"hollow it out and add a
  flat base"*). The AI builds an ordered, reviewable edit plan; tweak the steps, then run it.
- **Transform tools** — scale, rotate, move, split, hollow, and more, applied directly to the
  mesh.
- **Viewer** — orbit, zoom, toggle wireframe / x-ray, and measure. Undo with `Ctrl+Z`.

## 3. Slice to G-code

Open the **Export** panel and set your print settings:
- Layer height, infill %, supports on/off, material, and a printer preset.

Slice to produce G-code. (Gen3D uses CuraEngine/PrusaSlicer if `SLICER_PATH` is set,
otherwise a built-in TypeScript slicer.)

## 4. Print it

After slicing, click **Send to Printer**:
- **Save to Mainsail** — uploads the G-code to your printer's **G-Code Files** to start later.
- **Save & Print now** — uploads *and* starts the print, then opens Mainsail to monitor.

You can jump to the printer UI any time; Gen3D and Mainsail link back to each other.

## 5. Save your work

- **Save project** (`Ctrl+S`) → a `.t2p` file (inputs + current model + settings).
- **Export ZIP** → the project plus its STL model(s) and G-code.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+G` | Generate model |
| `Ctrl+S` | Save project |
| `Ctrl+Z` | Undo edit |
| `Ctrl+E` | Export G-code |
| `?` | Show shortcuts |

## API endpoints (for the curious / integrations)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Dependency check (slicer, AI providers) |
| GET | `/api/engines` | Available generation engines |
| POST | `/api/upload` | Upload images (multipart) |
| POST | `/api/generate` | Generate model candidates (SSE stream) |
| POST | `/api/plan-edit` | Plan natural-language mesh edits |
| POST | `/api/slice` | Slice STL to G-code |
| POST | `/api/print` | Send sliced G-code to the printer (Moonraker) |
| GET | `/api/files/:filename` | Serve STL/G-code files |
| GET | `/api/export/zip` | Download project ZIP |

Stuck? See the [Troubleshooting](SETUP.md#troubleshooting) section in the setup guide.
