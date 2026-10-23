// Files dragged from the file manager reach the page itself (the bot chat box takes
// them, Noam 2026-10-23: "want to drag these here"). Anywhere that does not take files,
// a drop must never replace the whole app with that file.
const carriesFiles = (event: DragEvent): boolean => {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes("Files") || types.includes("text/uri-list");
};

export function installFileDropGuard(target: Window = window): void {
  target.addEventListener("dragover", (event) => {
    if (!carriesFiles(event) || event.defaultPrevented) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  });
  target.addEventListener("drop", (event) => {
    if (carriesFiles(event)) event.preventDefault();
  });
}
