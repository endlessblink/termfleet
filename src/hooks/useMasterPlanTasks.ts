import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { masterPlanPath, parseMasterPlanTasks, type MasterPlanTask } from "../lib/masterPlanTasks";

export function useMasterPlanTasks(projectRoots: Array<string | null | undefined>) {
  const roots = useMemo(
    () => [...new Set(projectRoots.filter((root): root is string => Boolean(root?.trim())).map((root) => root.replace(/\/+$/, "")))],
    [projectRoots.join("\n")]
  );
  const rootsKey = roots.join("\n");
  const [tasksByRoot, setTasksByRoot] = useState<Record<string, MasterPlanTask[]>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const entries = await Promise.all(
        roots.map(async (root) => {
          try {
            const contents = await invoke<string>("fs_read_file", { path: masterPlanPath(root) });
            return [root, parseMasterPlanTasks(contents)] as const;
          } catch {
            return [root, []] as const;
          }
        })
      );

      if (!cancelled) setTasksByRoot(Object.fromEntries(entries));
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
