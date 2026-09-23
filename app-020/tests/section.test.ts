/**
 * 竖向疏散剖面（楼栋页轨道）—— 修复前 Building.tsx 把「全部设施」按硬编码
 * x/400（即 40m 宽、原点 x=0 的轨道）画到带子上：楼层不足 40m 时点全挤在左边一截；
 * 各层没有共享的水平参照，同一部楼梯的上下出口对不齐；灭火器/消火栓/指示灯混在出口里。
 * 这里固定新行为：轨道上只画安全出口；全楼统一 [minX,maxX] 线性映射 ——
 * 同一物理 x 在每层都落在同一竖线，宽度不同的楼层保持真实水平错位。
 */
import { describe, it, expect } from 'vitest';
import { buildingXRangeMm, exitTrackPct, verticalSectionTracks } from '../src/lib/section';
import type { Floor, Room } from '../src/model';
import { mkFloor, mkRoom, rect } from './helpers';
import type { FacSpec } from './helpers';

function floorWith(id: string, level: number, rooms: Room[], facs: FacSpec[]): Floor {
  const { floor } = mkFloor(rooms, facs);
  return { ...floor, id, level };
}

describe('竖向疏散剖面轨道', () => {
  it('V1 轨道上只出现安全出口，其他设施类型不上带子', () => {
    const f = floorWith('f1', 1, [mkRoom('走道', 'corridor', rect(0, 0, 20, 2))], [
      { kind: 'exit', x: 1, y: 1 },
      { kind: 'extinguisher', x: 5, y: 1 },
      { kind: 'hydrant', x: 8, y: 1 },
      { kind: 'exit_sign', x: 10, y: 1 },
      { kind: 'emergency_light', x: 12, y: 1 },
      { kind: 'sprinkler', x: 14, y: 1 },
      { kind: 'exit', x: 19, y: 1 },
    ]);
    const [t] = verticalSectionTracks([f]);
    expect(t.exits.map((e) => e.code)).toEqual(['exit-0', 'exit-6']);
  });

  it('V2 同一物理 x 跨层落在同一竖线（宽度不同的楼层也对齐）', () => {
    // 裙房 1F：0–80m，出口在 30m / 50m；塔楼 2F：30–50m，出口同在 30m / 50m（同一部楼梯）
    const podium = floorWith('f1', 1, [mkRoom('走道', 'corridor', rect(0, 0, 80, 2))], [
      { kind: 'exit', x: 30, y: 1 },
      { kind: 'exit', x: 50, y: 1 },
    ]);
    const tower = floorWith('f2', 2, [mkRoom('走道', 'corridor', rect(30, 0, 20, 2))], [
      { kind: 'exit', x: 30, y: 1 },
      { kind: 'exit', x: 50, y: 1 },
    ]);
    const [t1, t2] = verticalSectionTracks([podium, tower]);
    expect(t2.exits[0].pct).toBeCloseTo(t1.exits[0].pct, 10);
    expect(t2.exits[1].pct).toBeCloseTo(t1.exits[1].pct, 10);
    // 塔楼出口落在裙房中段（共享参照系），而不是各自拉伸占满轨道两端
    expect(t1.exits[0].pct).toBeCloseTo(3 + (30 / 80) * 94, 6);
    expect(t1.exits[1].pct).toBeCloseTo(3 + (50 / 80) * 94, 6);
  });

  it('V3 窄楼层的点沿整条轨道铺开，不再挤在左边一小截', () => {
    // 12m 宽的楼：旧实现 x/400 下两个出口在 1.25% 与 28.75%，全挤在左三分之一
    const narrow = floorWith('f1', 1, [mkRoom('走道', 'corridor', rect(0, 0, 12, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 11.5, y: 1 },
    ]);
    const [t] = verticalSectionTracks([narrow]);
    expect(t.exits[0].pct).toBeCloseTo(3 + (0.5 / 12) * 94, 6);
    expect(t.exits[1].pct).toBeCloseTo(3 + (11.5 / 12) * 94, 6);
    expect(t.exits[1].pct - t.exits[0].pct).toBeGreaterThan(80);
  });

  it('V4 出口画在房间外一点点也计入参照范围，百分比不越界', () => {
    const f = floorWith('f1', 1, [mkRoom('走道', 'corridor', rect(0, 0, 10, 2))], [
      { kind: 'exit', x: -0.5, y: 1 },
      { kind: 'exit', x: 10.6, y: 1 },
    ]);
    expect(buildingXRangeMm([f])).toEqual({ minX: -500, maxX: 10600 });
    const [t] = verticalSectionTracks([f]);
    expect(t.exits[0].pct).toBeCloseTo(3, 6);
    expect(t.exits[1].pct).toBeCloseTo(97, 6);
    for (const e of t.exits) {
      expect(e.pct).toBeGreaterThanOrEqual(0);
      expect(e.pct).toBeLessThanOrEqual(100);
    }
  });

  it('V5 参照范围只由房间与出口决定，其他设施不把轨道拉偏', () => {
    // 100m 处的灭火器不应参与定标：范围仍是房间的 0–10m
    const f = floorWith('f1', 1, [mkRoom('走道', 'corridor', rect(0, 0, 10, 2))], [
      { kind: 'exit', x: 1, y: 1 },
      { kind: 'extinguisher', x: 100, y: 1 },
    ]);
    expect(buildingXRangeMm([f])).toEqual({ minX: 0, maxX: 10000 });
  });

  it('V6 退化输入：无楼层 / 楼层无房间无出口，不抛异常不出 NaN', () => {
    expect(verticalSectionTracks([])).toEqual([]);
    const empty = floorWith('f1', 1, [], []);
    expect(buildingXRangeMm([empty])).toBeNull();
    expect(verticalSectionTracks([empty])).toEqual([{ floorId: 'f1', level: 1, exits: [] }]);
  });

  it('V7 全楼只有一个出口（跨度为 0）时落在中点 50%', () => {
    const f = floorWith('f1', 1, [], [{ kind: 'exit', x: 7, y: 1 }]);
    const [t] = verticalSectionTracks([f]);
    expect(t.exits[0].pct).toBe(50);
  });

  it('V8 exitTrackPct：端点落在 pad 处，中点落在 50%，空范围/零跨度落中点', () => {
    expect(exitTrackPct(0, null)).toBe(50);
    expect(exitTrackPct(5000, { minX: 5000, maxX: 5000 })).toBe(50);
    expect(exitTrackPct(0, { minX: 0, maxX: 40000 })).toBe(3);
    expect(exitTrackPct(40000, { minX: 0, maxX: 40000 })).toBe(97);
    expect(exitTrackPct(20000, { minX: 0, maxX: 40000 })).toBe(50);
    expect(exitTrackPct(0, { minX: 0, maxX: 40000 }, 0)).toBe(0);
  });
});
