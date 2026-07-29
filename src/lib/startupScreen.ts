const STARTUP_SCREEN_ID = "termfleet-startup";
const STARTUP_EXIT_MS = 160;
const STARTUP_SLOW_MS = 6_000;

let slowStartupTimer = 0;

function startupScreen() {
  return document.getElementById(STARTUP_SCREEN_ID);
}

function appRoot() {
  return document.getElementById("root");
}

export function markStartupRestoring() {
  const screen = startupScreen();
  if (!screen) return;

  screen.dataset.startupState = "restoring";
  const status = screen.querySelector<HTMLElement>(".termfleet-startup__status");
  if (status) status.textContent = "Restoring workspace";

  slowStartupTimer = window.setTimeout(() => {
    const currentScreen = startupScreen();
    if (!currentScreen || currentScreen.dataset.startupState === "ready") return;
    currentScreen.dataset.startupSlow = "true";
    currentScreen.setAttribute("aria-label", "Restoring workspace");
  }, STARTUP_SLOW_MS);
}

export function dismissStartupScreen() {
  if (slowStartupTimer) {
    window.clearTimeout(slowStartupTimer);
    slowStartupTimer = 0;
  }

  const root = appRoot();
  root?.removeAttribute("inert");
  root?.removeAttribute("aria-hidden");

  const screen = startupScreen();
  if (!screen) return;

  screen.dataset.startupState = "ready";
  screen.setAttribute("aria-hidden", "true");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    screen.remove();
    return;
  }

  window.setTimeout(() => screen.remove(), STARTUP_EXIT_MS);
}
