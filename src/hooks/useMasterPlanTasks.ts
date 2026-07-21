import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  cachedMasterPlanTasks,
  masterPlanPath,
  masterPlanTaskMapsEqual,
  type MasterPlanTask,
  type MasterPlanTaskCacheEntry,
} from "../lib/masterPlanTasks";

export function useMasterPlanTasks(projectRoots: Array<string | null | undefined>) {
  const roots = useMemo(
    () => [...new Set(projectRoots.filter((root): root is string => Boolean(root?.trim())).map((root) => root.replace(/\/+$/, "")))],
    [projectRoots.join("\n")]
  );
  const rootsKey = roots.join("\n");
  const [tasksByRoot, setTasksByRoot] = useState<Record<string, MasterPlanTask[]>>({});
  const taskCacheRef = useRef<Record<string, MasterPlanTaskCacheEntry>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const entries = await Promise.all(
        roots.map(async (root) => {
          try {
            const contents = await invoke<string>("fs_read_file", { path: masterPlanPath(root) });
            const cached = cachedMasterPlanTasks(taskCacheRef.current[root], contents);
            taskCacheRef.current[root] = cached;
            return [root, cached.tasks] as const;
          } catch {
            return [root, []] as const;
          }
        })
      );

      if (!cancelled) {
        const next = Object.fromEntries(entries);
        setTasksByRoot((previous) => masterPlanTaskMapsEqual(previous, next) ? previous : next);
      }
    }

    void load();
    const interval = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [rootsKey]);

  return tasksByRoot;
}
