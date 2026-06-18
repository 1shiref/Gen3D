# Gen3D — AI-Powered 3D Model Generator & G-Code Exporter

Accept an image or text → AI generates a 3D mesh → edit → slice to G-code → print.

Generation runs neural image-to-3D models (Hunyuan3D-2 on Hugging Face, plus optional
fal.ai / Replicate). Text-only prompts are first turned into a reference image, then meshed.

## Quick Start

### 1. Prerequisites

- **Node.js** ≥ 18
- **Anthropic API Key** (for the natural-language mesh-edit planner): https://console.anthropic.com
- **Optional mesh providers** for faster/more reliable image-to-3D and text-to-image:
  - `FAL_KEY` (https://fal.ai) — recommended primary
  - `REPLICATE_API_TOKEN` (https://replicate.com)
  - `HF_TOKEN` (https://huggingface.co) — bigger free quota on the keyless Hugging Face Space

### 2. Clone & Install

```bash
cd gen3d
npm install
```

### 3. Configure Environment

```bash
cp .env.example backend/.env
# Edit backend/.env and add your ANTHROPIC_API_KEY
```

### 4. Run

```bash
npm run dev
```

Frontend: http://localhost:5173  
Backend API: http://localhost:3001

### 5. Check Dependencies

```bash
npm run check-deps
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| 3D Viewer | Three.js + React Three Fiber + Drei |
| State | Zustand |
| UI | Tailwind CSS + Radix UI |
| Backend | Node.js + Express + TypeScript |
| AI | Anthropic Claude API (mesh-edit planner) |
| 3D Generation | Neural image-to-3D (Hunyuan3D-2 / fal.ai / Replicate) |
| Slicer | CuraEngine / PrusaSlicer / TypeScript fallback |

---

## Features

- **Image → 3D**: Upload a photo, get a neural-generated mesh (multiple candidates to pick from)
- **Text → 3D**: Describe a shape — it's turned into a reference image, then meshed
- **Smart plan editing**: Describe a goal in plain English; the AI builds an ordered mesh-edit plan you can review, tweak, and run
- **Transform tools**: Scale, rotate, move, split, hollow, and more — directly on the mesh
- **Interactive viewer**: Orbit, zoom, wireframe, x-ray, measurement tool
- **G-code export**: Layer height, infill, supports, material, printer presets
- **Project management**: Save/load, export ZIP

---

## Generation

| Input | Pipeline |
|-------|----------|
| Image | Neural image-to-3D (Hunyuan3D-2 + any configured fal/Replicate models), one candidate per engine |
| Text  | Text → reference image (fal FLUX, keyless HF fallback) → neural image-to-3D |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Dependency check (slicer, AI providers) |
| GET | `/api/engines` | Available generation engines |
| POST | `/api/upload` | Upload images (multipart) |
| POST | `/api/generate` | Generate model candidates (SSE stream) |
| POST | `/api/plan-edit` | Plan natural-language mesh edits |
| POST | `/api/slice` | Slice STL to G-code |
| GET | `/api/files/:filename` | Serve STL/G-code files |
| GET | `/api/export/zip` | Download project ZIP |

---

## Project File Format (.t2p)

Projects are saved as `.t2p` JSON files containing the inputs, the current model, and settings. Export as ZIP includes the STL model(s) and G-code.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+G` | Generate model |
| `Ctrl+S` | Save project |
| `Ctrl+Z` | Undo edit |
| `Ctrl+E` | Export G-code |
| `?` | Show shortcuts |
