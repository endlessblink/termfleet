export type SystemPressureSnapshot = {
  cpuCount: number;
  loadAverage1m?: number | null;
  memTotalBytes?: number | null;
  memAvailableBytes?: number | null;
  swapTotalBytes?: number | null;
  swapFreeBytes?: number | null;
  swapUsedBytes?: number | null;
  cpuSomeAvg10?: number | null;
  memorySomeAvg10?: number | null;
  ioSomeAvg10?: number | null;
  procsRunning?: number | null;
  procsBlocked?: number | null;
};

export type SystemPressureSeverity = "normal" | "elevated" | "high";

export type SystemPressureSummary = {
  severity: SystemPressureSeverity;
  label: string;
  title: string;
};

const GIB = 1024 ** 3;

function fmtBytes(bytes?: number | null) {
  if (!Number.isFinite(bytes ?? NaN)) return null;
  return `${((bytes as number) / GIB).toFixed(1)}Gi`;
}

function fmtPercent(value?: number | null) {
  if (!Number.isFinite(value ?? NaN)) return null;
  return `${(value as number).toFixed(1)}%`;
}

export function classifySystemPressure(snapshot: SystemPressureSnapshot): SystemPressureSummary {
  const loadRatio = snapshot.cpuCount > 0 && Number.isFinite(snapshot.loadAverage1m ?? NaN)
    ? (snapshot.loadAverage1m as number) / snapshot.cpuCount
    : 0;
  const swapUsed = snapshot.swapUsedBytes ?? 0;
  const swapTotal = snapshot.swapTotalBytes ?? 0;
  const swapRatio = swapTotal > 0 ? swapUsed / swapTotal : 0;
  const blocked = snapshot.procsBlocked ?? 0;
  const ioAvg10 = snapshot.ioSomeAvg10 ?? 0;
  const memoryAvg10 = snapshot.memorySomeAvg10 ?? 0;
  const cpuAvg10 = snapshot.cpuSomeAvg10 ?? 0;

  const high =
    swapUsed >= 8 * GIB ||
    swapRatio >= 0.5 ||
    blocked >= 2 ||
    ioAvg10 >= 5 ||
    memoryAvg10 >= 1 ||
    loadRatio >= 1.5;
  const elevated =
    high ||
    swapUsed >= 2 * GIB ||
    swapRatio >= 0.25 ||
    blocked >= 1 ||
    ioAvg10 >= 2 ||
    memoryAvg10 >= 0.25 ||
    cpuAvg10 >= 40 ||
    loadRatio >= 1;

  const reasons = [
    swapUsed > 0 ? `swap ${fmtBytes(swapUsed)}` : null,
    blocked > 0 ? `${blocked} blocked` : null,
    ioAvg10 >= 1 ? `io ${fmtPercent(ioAvg10)}` : null,
    memoryAvg10 >= 0.1 ? `mem pressure ${fmtPercent(memoryAvg10)}` : null,
    loadRatio >= 1 ? `load ${(snapshot.loadAverage1m ?? 0).toFixed(1)}/${snapshot.cpuCount}` : null,
  ].filter(Boolean) as string[];

  if (high) {
    return {
      severity: "high",
      label: "system pressure high",
      title: reasons.length ? reasons.join(" · ") : "Host pressure is high",
    };
  }
  if (elevated) {
    return {
      severity: "elevated",
      label: "system pressure elevated",
      title: reasons.length ? reasons.join(" · ") : "Host pressure is elevated",
    };
  }
  return {
    severity: "normal",
    label: "system pressure normal",
    title: "Host pressure is normal",
  };
}
