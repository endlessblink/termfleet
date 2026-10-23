// Must stay the first imports: every localStorage write goes through the storage
// governor, and the work recorder times every renderer callback registered after it (TF-015).
import "./lib/storageGovernorInstall";
import "./lib/workAttribution";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { markStartupRestoring } from "./lib/startupScreen";
import { installRendererStallTelemetry } from "./lib/rendererStallTelemetry";
import { installFileDropGuard } from "./lib/fileDropGuard";
import "./styles/global.css";

const rootElement = document.getElementById("root")!;

if (import.meta.env.DEV && window.location.hash === "#ui-gallery") {
  // Dev-only primitives gallery (design step 1.5): dynamic import keeps it out of
  // the production bundle, and it never touches the workspace or the daemon.
  rootElement.removeAttribute("inert");
  rootElement.removeAttribute("aria-hidden");
  document.getElementById("termfleet-startup")?.remove();
  void import("./ui/Gallery").then(({ default: Gallery }) => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <Gallery />
      </React.StrictMode>
    );
  });
} else {
  markStartupRestoring();
  installRendererStallTelemetry();
  installFileDropGuard();

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
