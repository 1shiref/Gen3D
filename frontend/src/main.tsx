import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Tag this tab so Mainsail's "Gen3D" sidebar link (target="gen3d") reuses and
// focuses it instead of opening a duplicate on every click.
window.name = "gen3d";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
