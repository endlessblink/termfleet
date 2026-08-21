import { useCallback, useEffect, useState } from "react";
import { readCanonicalTasks, type CanonicalTask } from "../lib/canonicalAgentBoard";

export function useCanonicalTasks() {
  const [tasks, setTasks] = useState<CanonicalTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await readCanonicalTasks(true);
      setTasks(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the canonical queue");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { tasks, setTasks, error, loading, refresh };
}
