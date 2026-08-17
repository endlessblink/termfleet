type RenderTask = () => void;

const FRAME_BUDGET_MS = 8;
const pendingTasks = new Map<string, RenderTask>();
let frameHandle: number | null = null;

function flush() {
  frameHandle = null;
  const startedAt = performance.now();

  for (const [key, task] of [...pendingTasks]) {
    pendingTasks.delete(key);
    task();
    if (performance.now() - startedAt >= FRAME_BUDGET_MS) break;
  }

  if (pendingTasks.size > 0) {
    frameHandle = window.requestAnimationFrame(flush);
  }
}

export function scheduleCanvasRender(key: string, task: RenderTask) {
  pendingTasks.set(key, task);
  if (frameHandle === null) {
    frameHandle = window.requestAnimationFrame(flush);
  }
}

export function pendingCanvasRenderCount() {
  return pendingTasks.size;
}
