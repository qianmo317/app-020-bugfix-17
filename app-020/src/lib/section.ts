import type { Floor } from '../model';

/**
 * 竖向疏散剖面（楼栋页）：把各层安全出口按全楼统一的水平参照系归一化到同一轨道。
 * 所有楼层共用同一 [minX, maxX] 做线性映射 —— 同一物理 x 在每条轨道上都落在同一竖线，
 * 上下连着同一部楼梯的出口因此上下对齐；宽度不同的楼层能看出真实的水平错位
 * （如塔楼出口落在裙房中段），而不是各自拉伸占满轨道。
 */

export type ExitMark = { code: string; pct: number };
export type FloorExitTrack = { floorId: string; level: number; exits: ExitMark[] };

export type XRange = { minX: number; maxX: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 全楼水平参照范围（mm）：取各层房间多边形顶点与安全出口 x 的并集。
 * 出口画在墙外一点点也计入范围，不会被钳到轨道端点。
 * 整楼无房间且无出口时返回 null。
 */
export function buildingXRangeMm(floors: Floor[]): XRange | null {
  let minX = Infinity;
  let maxX = -Infinity;
  const eat = (x: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  };
  for (const f of floors) {
    for (const r of f.rooms) for (const p of r.polygon) eat(p.x);
    for (const fac of f.facilities) if (fac.kind === 'exit') eat(fac.x);
  }
  return minX <= maxX ? { minX, maxX } : null;
}

/**
 * 物理 x(mm) → 轨道百分比。range 为 null 或跨度为 0（全楼只有一个点）时落在中点。
 * padPct 在轨道两端各留边距，避免出口点压到轨道圆角外；边距是共享映射的一部分，
 * 不影响跨层对齐。
 */
export function exitTrackPct(xMm: number, range: XRange | null, padPct = 3): number {
  if (!range) return 50;
  const span = range.maxX - range.minX;
  if (span <= 0) return 50;
  return clamp(padPct + ((xMm - range.minX) / span) * (100 - 2 * padPct), 0, 100);
}

/** 各楼层轨道的出口标记：只取安全出口（kind === 'exit'），pct 用全楼共享参照系 */
export function verticalSectionTracks(floors: Floor[], padPct = 3): FloorExitTrack[] {
  const range = buildingXRangeMm(floors);
  return floors.map((f) => ({
    floorId: f.id,
    level: f.level,
    exits: f.facilities
      .filter((fac) => fac.kind === 'exit')
      .map((fac) => ({ code: fac.code, pct: exitTrackPct(fac.x, range, padPct) })),
  }));
}
