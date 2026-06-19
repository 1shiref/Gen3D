# Gen3D — AI-Powered 3D Model Generator & G-Code Exporter

Accept an image or text → AI generates a 3D mesh → edit → slice to G-code → **send straight
to your 3D printer**. Designed to run on a Raspberry Pi alongside the Klipper printer stack
(Klipper + Moonraker + Mainsail + Crowsnest camera).

Generation runs AI image-to-3D models (Hunyuan3D-2 on Hugging Face, plus optional
fal.ai / Replicate). Text-only prompts are first turned into a reference image using Flux, then meshed.

## 📖 Documentation

- **[Full Setup Guide](docs/SETUP.md)** — start here. From a blank SD card → Raspberry Pi
  OS → Klipper/Moonraker/Mainsail/Crowsnest → Gen3D → API keys → auto-start on boot.
- **[Usage Guide](docs/USAGE.md)** — how to generate, edit, slice, and print.
- **[Reference printer configs](printer-config/)** — a real-world Klipper config to adapt.

## Architecture

<img width="1360" height="2040" alt="gen3d_hardware_flow_v4 (1)" src="https://github.com/user-attachments/assets/0c3372a1-44dd-4c4a-aaba-e282e2b8f695" />


## Quick Start (app only)

> For the complete Pi + printer setup, follow **[docs/SETUP.md](docs/SETUP.md)**.

### 1. Prerequisites

- **Node.js** ≥ 18
- **One AI reasoning key** (for the mesh-edit planner): Anthropic, OpenRouter→Claude, or
  AgentRouter. Free/local tiers (OpenRouter-free, Groq, Ollama) also work with
  `ALLOW_WEAK_MODELS=true`.
- **Optional mesh providers** for faster/more reliable image-to-3D and text-to-image:
  - `FAL_KEY` (https://fal.ai) — recommended primary
  - `REPLICATE_API_TOKEN` (https://replicate.com)
  - `HF_TOKEN` (https://huggingface.co) — bigger free quota on the keyless Hugging Face Space
- *(For printing)* a reachable **Moonraker** instance (`MOONRAKER_URL`, default
  `http://localhost:7125`).

### 2. Clone & Install

```bash
git clone https://github.com/1shiref/Gen3D.git gen3d
cd gen3d
npm install
```

### 3. Configure Environment

```bash
cp .env.example backend/.env
# Edit backend/.env and add at least one AI key (see comments in the file).
```

### 4. Run

```bash
npm run dev          # dev: frontend :5173 + backend :3001
# or production (backend also serves the built frontend on PORT):
npm run build && node backend/dist/index.js
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
| AI (reasoning) | Claude via Anthropic / OpenRouter / AgentRouter, with Groq · Ollama fallbacks |
| 3D Generation | Neural image-to-3D (Hunyuan3D-2 / fal.ai / Replicate) |
| Slicer | CuraEngine / PrusaSlicer / TypeScript fallback |
| Printing | Moonraker / Klipper (Send to Printer); Mainsail UI |

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
| POST | `/api/print` | Send sliced G-code to the printer (Moonraker) |
| GET | `/api/files/:filename` | Serve STL/G-code files |
| GET | `/api/export/zip` | Download project ZIP |

---

## Run on Boot (Raspberry Pi)

Install Gen3D as a systemd service so it auto-starts:

```bash
sudo bash deploy/install-autostart.sh   # installs deploy/gen3d.service
journalctl -u gen3d -f                   # live logs
sudo systemctl restart gen3d             # after pulling new code / editing .env
```

See [docs/SETUP.md](docs/SETUP.md) for the full Raspberry Pi + printer walkthrough.

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
