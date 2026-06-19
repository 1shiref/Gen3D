# Gen3D — Full Setup Guide (Raspberry Pi → Printer → AI)

This guide takes you from a **blank SD card** to a working setup where you can:

1. Control a 3D printer from your browser (Klipper + Moonraker + Mainsail + camera), and
2. Generate 3D models from text or images with AI, slice them to G-code, and **send them
   straight to the printer** — all on the same Raspberry Pi.

It's written for beginners. Copy/paste the commands in order. Replace `<pi-ip>` with your
Pi's IP address (e.g. `192.168.1.50`) wherever you see it.

> **Already have Klipper/Mainsail running?** Skip to [Part B](#part-b--install-gen3d).

---

## Overview — what you're building

<img width="680" height="1020" alt="gen3d_hardware_flow_v4 (1)" src="https://github.com/user-attachments/assets/0c3372a1-44dd-4c4a-aaba-e282e2b8f695" />

- **Klipper** — printer firmware (runs on the Pi, talks to the printer board over USB).
- **Moonraker** — the API layer in front of Klipper (port `7125`).
- **Mainsail** — the web UI for the printer (port `80`, i.e. `http://<pi-ip>/`).
- **Crowsnest** — the webcam/streamer service (port `8080`, viewed at `/webcam/`).
- **Gen3D** — this project: AI model generator + slicer + "Send to Printer" (port `3001`).

This setup is **local-network only** — you reach everything from a browser on the same
Wi-Fi/LAN as the Pi. No accounts or port-forwarding required.

## Hardware you need

- Raspberry Pi 4 or 5 (2 GB+; 4 GB recommended) + power supply
- microSD card (16 GB+) + a way to write it from your computer
- A 3D printer with a USB-connectable control board (Klipper-supported)
- *(Optional)* Raspberry Pi camera or USB webcam for live monitoring
- Same Wi-Fi/LAN for the Pi and your computer

---

# Part A — Raspberry Pi + printer stack

## A1. Flash Raspberry Pi OS

1. Install **Raspberry Pi Imager**: https://www.raspberrypi.com/software/
2. Choose **Raspberry Pi OS (64-bit)** (Lite is fine — it's headless).
3. Click the gear / **Edit Settings** before writing and set:
   - **Hostname**: e.g. `gen3d`
   - **Username/password**: e.g. user `gen3d` (this guide assumes that username)
   - **Wi-Fi**: your SSID + password (and country)
   - **Enable SSH** (use password authentication)
4. Write the card, put it in the Pi, power on, wait ~2 minutes.
5. SSH in from your computer:
   ```bash
   ssh gen3d@<pi-ip>     # or ssh gen3d@gen3d.local
   ```
6. Update the system:
   ```bash
   sudo apt update && sudo apt full-upgrade -y
   sudo apt install -y git
   ```

## A2. Install Klipper + Moonraker + Mainsail + Crowsnest with KIAUH

[KIAUH](https://github.com/dw-0/kiauh) is a menu-driven installer that sets up the whole
stack for you.

```bash
cd ~
git clone https://github.com/dw-0/kiauh.git
./kiauh/kiauh.sh
```

In the KIAUH menu, choose **[1] Install**, then install in this order:

1. **Klipper** (accept defaults / 1 instance, Python 3)
2. **Moonraker**
3. **Mainsail**
4. **Crowsnest** (only if you have a camera)

When done, open **`http://<pi-ip>/`** in your browser — you should see Mainsail. It will
say the printer is disconnected until you flash and wire the MCU (next step).

## A3. Flash your printer's control board (MCU)

This is printer-specific. In short:

```bash
cd ~/klipper
make menuconfig      # pick your MCU (e.g. LPC1768 for SKR 1.4 Turbo), save & exit
make                 # builds out/klipper.bin (or klipper.elf.hex)
```

Then flash that firmware to your board (SD-card method or `make flash` — see the
[Klipper docs](https://www.klipper3d.org/Installation.html) for your board). Find the
board's serial after it's connected:

```bash
ls /dev/serial/by-id/*
```

## A4. Printer configuration

Your Klipper config lives in `~/printer_data/config/`. You can edit it directly in
Mainsail (**Machine** tab). The [`printer-config/`](../printer-config/) folder in this repo
contains **complete real-world reference files** (a CoreXY / SKR 1.4 Turbo / BLTouch
machine) — use them to see how a full config fits together, but **adapt every hardware
value to your printer** (see [printer-config/README.md](../printer-config/README.md)).

Minimum you must get right:
- `[mcu] serial:` → the path from `ls /dev/serial/by-id/*`
- Stepper pins, `rotation_distance`, `position_max` (your bed size)
- Probe type + offsets, and run `PID_CALIBRATE` for hotend & bed.

After editing, click **Save & Restart** in Mainsail. The printer should connect.

### Moonraker access (important for Gen3D)
Gen3D talks to Moonraker at `http://localhost:7125`. Moonraker already trusts localhost and
the local network via `[authorization] trusted_clients` (see the reference
[`moonraker.conf`](../printer-config/moonraker.conf)), so **no API key is needed** when
Gen3D runs on the same Pi.

### Camera (optional)
If you installed Crowsnest, the reference [`crowsnest.conf`](../printer-config/crowsnest.conf)
streams a Raspberry Pi camera on port `8080`. View it in Mainsail or directly at
`http://<pi-ip>/webcam/?action=stream`.

---

# Part B — Install Gen3D

## B1. Install Node.js (≥ 18)

```bash
# Install nvm, then Node 20 LTS
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
exec $SHELL
nvm install 20
node -v        # should print v20.x
```

## B2. Clone & install

```bash
cd ~
git clone https://github.com/1shiref/Gen3D.git gen3d
cd gen3d
npm install
```

## B3. Configure your API keys

```bash
cp .env.example backend/.env
nano backend/.env     # fill in at least one AI key (see the table below)
```

The `backend/.env` file is **gitignored** — your keys never leave the Pi.

---

## B4. Which API keys do I need?

Gen3D uses two kinds of AI:

- **A reasoning model** (Claude-class) for the natural-language mesh-edit planner & smart plans.
- **A mesh/image generator** for turning text/images into 3D.

You need **one** key from each kind to get the full experience. The mesh side even works
with **no key** (slower, via a public Hugging Face Space).

### Reasoning model (pick ONE — listed best → cheapest)

| Provider | Env var | Cost | Get a key |
|----------|---------|------|-----------|
| **Anthropic** (direct) | `ANTHROPIC_API_KEY` | Paid, best quality | https://console.anthropic.com |
| **OpenRouter → Claude** | `OPENROUTER_API_KEY` + `OPENROUTER_CLAUDE_MODEL` | Paid (pay-as-you-go) | https://openrouter.ai/keys |
| **AgentRouter** ("cloud") | `AGENTROUTER_API_KEY` | Gateway → Claude | your AgentRouter dashboard |
| OpenRouter (free models) | `OPENROUTER_API_KEY` + `ALLOW_WEAK_MODELS=true` | Free, lower quality | https://openrouter.ai/keys |
| Groq | `GROQ_API_KEY` + `ALLOW_WEAK_MODELS=true` | Free, fast, lower quality | https://console.groq.com |
| Ollama | *(none — local)* + `ALLOW_WEAK_MODELS=true` | Free, runs on the Pi/PC | https://ollama.com |

Gen3D tries these in a **6-tier fallback chain** automatically — the first configured,
working provider wins. The free/local tiers (4–6) are **off by default** so quality never
silently degrades; enable them with `ALLOW_WEAK_MODELS=true`. *"cloud"* in the project's
shorthand = AgentRouter, an Anthropic-compatible gateway to Claude.

### Mesh / image generation (image → 3D, and text → image → 3D)

| Provider | Env var | Cost | Get a key |
|----------|---------|------|-----------|
| **Hugging Face Space** (default) | *(none, or `HF_TOKEN`)* | Free, can be slow/queued | https://huggingface.co/settings/tokens |
| **fal.ai** (recommended) | `FAL_KEY` | Paid, fast & reliable | https://fal.ai |
| Replicate | `REPLICATE_API_TOKEN` | Paid | https://replicate.com |

> **Minimum viable setup:** one reasoning key (e.g. `ANTHROPIC_API_KEY`) + a `FAL_KEY`.
> Everything else is optional. Without any mesh key it still works via the keyless HF Space.

Every variable is documented inline in [`.env.example`](../.env.example).

---

## B5. Run Gen3D

### Quick test (development mode)
```bash
npm run dev
```
- Frontend: `http://<pi-ip>:5173`
- Backend API: `http://<pi-ip>:3001`

Check everything is wired up:
```bash
npm run check-deps          # reports AI providers + slicer status
```

### Production (single port, recommended on the Pi)
Build once; the backend then also serves the built frontend on `PORT` (default `3001`):
```bash
npm run build
node backend/dist/index.js
```
Open `http://<pi-ip>:3001`.

## B6. Auto-start on boot (systemd)

So Gen3D comes back automatically after a reboot or power cut:

```bash
sudo bash ~/gen3d/deploy/install-autostart.sh
```

This installs and enables [`deploy/gen3d.service`](../deploy/gen3d.service) (runs
`node backend/dist/index.js`). Useful commands:

```bash
journalctl -u gen3d -f          # live logs
sudo systemctl restart gen3d    # restart after pulling new code / editing .env
sudo systemctl status gen3d     # check it's running
```

Gen3D (`:3001`) and Mainsail (`:80`) run side by side — both reachable from your browser.

---

## How "Send to Printer" works

When you slice a model in Gen3D and click **Send to Printer**, the backend
([`backend/src/routes/print.route.ts`](../backend/src/routes/print.route.ts)) POSTs the
G-code to Moonraker's `/server/files/upload` endpoint (`MOONRAKER_URL`, default
`http://localhost:7125`). You can:

- **Save to Mainsail** — uploads only; the file appears under **G-Code Files** in Mainsail.
- **Save & Print now** — uploads *and* starts the print, then jumps you to Mainsail to watch.

Because Moonraker trusts localhost, no key is needed when Gen3D runs on the printer's Pi.
If Moonraker is on **another** host, set `MOONRAKER_URL=http://<other-host>:7125` in
`backend/.env` and make sure that host's IP is in Moonraker's `trusted_clients`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **"Could not reach the printer (Moonraker)"** (502) | Is Moonraker running? `sudo systemctl status moonraker`. Check `MOONRAKER_URL`. Confirm your IP is in `[authorization] trusted_clients`. |
| **"No AI providers configured"** on start | Add at least one key to `backend/.env` (see [B4](#b4--which-api-keys-do-i-need)). Restart Gen3D. |
| **Mesh generation is very slow / times out** | The keyless HF Space is queued. Add a `FAL_KEY` for fast generation, or raise `MESH_HF_TIMEOUT_MS`. |
| **Slicing fails / odd G-code** | Gen3D falls back to a built-in TS slicer. For best results set `SLICER_PATH` to a CuraEngine/PrusaSlicer binary. |
| **Port 80 / 3001 already in use** | Mainsail owns `:80`. Change Gen3D's `PORT` in `backend/.env` if it clashes with something else. |
| **Edits give low-quality plans** | You're on a weak (non-Claude) tier. Add a Claude-class key (Anthropic / OpenRouter-Claude / AgentRouter). |
| **Can't reach anything in the browser** | Confirm the Pi's IP (`hostname -I`) and that your computer is on the same network. |

See [USAGE.md](USAGE.md) for how to actually use the app once it's running.
