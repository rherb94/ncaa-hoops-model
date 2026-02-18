export function computeModelSpread(
  homePR: number,
  awayPR: number,
  hca: number
) {
  // Compute expected home margin
  const homeMargin = homePR + hca - awayPR;

  // Convert margin to "home spread" convention:
  // home favored => negative spread
  return round(-homeMargin);
}

export function computeEdge(modelSpread: number, vegasSpread?: number) {
  if (vegasSpread === undefined) return undefined;
  return round(modelSpread - vegasSpread);
}

export function computeSignal(edge?: number): "STRONG" | "LEAN" | "NONE" {
  if (edge === undefined) return "NONE";
  const a = Math.abs(edge);
  if (a >= 5) return "STRONG";
  if (a >= 3) return "LEAN";
  return "NONE";
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}
