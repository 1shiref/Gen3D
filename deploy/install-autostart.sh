#!/usr/bin/env bash
# Installs Gen3D as a systemd service so it auto-starts on boot.
# Run with: sudo bash /home/gen3d/gen3d/deploy/install-autostart.sh
set -euo pipefail

SERVICE_SRC="/home/gen3d/gen3d/deploy/gen3d.service"
SERVICE_DST="/etc/systemd/system/gen3d.service"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root:  sudo bash $0" >&2
  exit 1
fi

echo "Installing $SERVICE_DST ..."
cp "$SERVICE_SRC" "$SERVICE_DST"

echo "Reloading systemd ..."
systemctl daemon-reload

echo "Enabling gen3d to start on boot ..."
systemctl enable gen3d.service

echo "Starting gen3d now ..."
systemctl restart gen3d.service

sleep 2
systemctl --no-pager --full status gen3d.service || true

echo
echo "Done. Gen3D will now start automatically on boot."
echo "Check logs anytime with:  journalctl -u gen3d -f"
