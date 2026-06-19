/**
 * Switch the user to Mainsail (port 80 of the same host as Gen3D).
 *
 * Uses a named window ("mainsail") so an already-open Mainsail tab is reused and
 * focused instead of being duplicated; if none exists a new tab opens. This
 * mirrors how Mainsail's navi sidebar link returns to Gen3D via target="gen3d"
 * (see frontend/src/main.tsx, which sets window.name = "gen3d"). The Mainsail tab
 * is tagged window.name = "mainsail" via an nginx sub_filter so this can find it.
 *
 * Tab reuse only works while the two tabs share a browsing context group — i.e.
 * one was opened from the other via these buttons. Two independently opened tabs
 * cannot find each other (a browser security limit with no JS workaround).
 */
export function goToMainsail(): void {
  const url = `//${location.hostname}/`; // Mainsail on port 80
  const win = window.open(url, "mainsail");
  if (win) win.focus();
  else window.location.href = url; // popup blocked → same-tab fallback
}
