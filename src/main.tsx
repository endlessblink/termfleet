// Must stay the first imports: every localStorage write goes through the storage
// governor, and the work recorder times every renderer callback registered after it (TF-015).
import "./lib/storageGovernorInstall";
import "./lib/workAttribution";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { markStartupRestoring } from "./lib/startupScreen";
import { installRendererStallTelemetry } from "./lib/rendererStallTelemetry";
import "./styles/global.css";

markStartupRestoring();
installRendererStallTelemetry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
