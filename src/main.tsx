// Must stay the first import: it times every renderer callback registered after it (TF-015).
import "./lib/workAttribution";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { markStartupRestoring } from "./lib/startupScreen";
import "./styles/global.css";

markStartupRestoring();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
