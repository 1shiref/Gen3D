# Reference Klipper configuration

These are **my machine's** working config files, committed as a reference so you can see
a complete, real-world Klipper + Moonraker + Crowsnest setup. **Do not flash or load them
blindly** — pin maps, drivers, board, serial IDs, bed size and probe offsets are all
specific to this printer.

On a real install these files live in `~/printer_data/config/`. Copy the ideas, not the
file, and adapt every hardware value to your own machine.

## What this printer is
- **Kinematics:** CoreXY
- **Control board:** BTT SKR 1.4 Turbo (MCU `lpc1768`), TMC2208 drivers
- **Bed:** ~300 × 300 mm (bed mesh probed 20,20 → 258,290)
- **Probe:** BLTouch (`safe_z_home`, 5×5 `bed_mesh`)
- **Sensors:** EPCOS 100K thermistors (hotend + bed)
- **Camera:** Raspberry Pi camera (IMX219) via Crowsnest `camera-streamer` on port 8080

## Files
| File | Purpose |
|------|---------|
| `printer.cfg` | Top-level include + auto-generated `SAVE_CONFIG` block (bed mesh, etc.) |
| `printer_normal.cfg` | Main hardware config — single-Z print mode (active) |
| `printer_service_dual_z.cfg` | Alternate hardware config — dual-Z service mode |
| `moonraker.conf` | Moonraker API server, trusted clients, update_manager, timelapse |
| `crowsnest.conf` | Webcam streamer (Pi camera, 1280×720 @ 15 fps, port 8080) |
| `mainsail.cfg` | Stock Mainsail macros/UI helpers (from `mainsail-config`) |
| `timelapse.cfg` | moonraker-timelapse macros |

## Must-change before using on your printer
1. **`[mcu] serial:`** in `printer_normal.cfg` — find yours with
   `ls /dev/serial/by-id/*`.
2. **Pin map / drivers / board** — match your control board.
3. **`position_max`, bed_mesh `mesh_min`/`mesh_max`** — your bed size.
4. **Probe type & offsets** (`[bltouch]`, `x_offset`/`y_offset`/`z_offset`).
5. **PID values** — run `PID_CALIBRATE` for your hotend/bed; don't reuse mine.
6. **`[mcu]` firmware** — build/flash Klipper for your board first.

## Moonraker ↔ Gen3D
`moonraker.conf` already trusts the local network and `localhost` under
`[authorization] trusted_clients`, so Gen3D's **Send to Printer** can POST G-code to
Moonraker (`http://localhost:7125`) with no API key. See [../docs/SETUP.md](../docs/SETUP.md).
