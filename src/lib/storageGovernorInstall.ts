import { invoke } from "@tauri-apps/api/core";
import { GAMIFICATION_STORAGE_KEY } from "./gamification";
import { installStorageGovernor, setStorageFullHandler } from "./storageGovernor";

// A deferred write that finds storage full frees retired quest profiles (the
// known space hog: every older `termfleet.gamification.*` record) and retries
// once, as the quest panel does inline for its own synchronous saves.
setStorageFullHandler(() => {
  if (typeof window === "undefined") return;
  const storage = window.localStorage;
  const retired: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && key.startsWith("termfleet.gamification.") && key !== GAMIFICATION_STORAGE_KEY) retired.push(key);
  }
  retired.forEach((key) => storage.removeItem(key));
});

// Imported first from main.tsx so every localStorage write in the app — including
// ones made while other modules load — passes through the storage governor.
// Coalesced keys are logged (key name, size, skipped count only) so a component
// that saves too often shows up in the geometry log as `storage-coalesced`.
installStorageGovernor((event) => {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    void invoke("terminal_geometry_log", {
      line: JSON.stringify({ t: Date.now(), kind: "storage-coalesced", ...event }),
    }).catch(() => {
      // Diagnostics must never interfere with the app.
    });
  } catch {
    // Ignore synchronous bridge failures too.
  }
});
