import { useState } from 'react';
import type { BuildingKind, Facility, Pt } from '../model';
import { addFloor, deleteFloor, updateBuilding, useStore } from '../store/store';
import { floorLabel } from '../store/id';
import { bboxOf } from '../lib/geometry';
import { Link } from '../router';

const KIND_LABELS: Record<BuildingKind, string> = {
  office: '办公楼',
  retail: '商业',
  factory: '厂房',
  school: '学校',
};

export function BuildingPage({ buildingId }: { buildingId: string }) {
  const building = useStore((s) => s.buildings.find((b) => b.id === buildingId));
  const floors = useStore((s) => s.floors);
  const [level, setLevel] = useState(1);

  if (!building) return <div className="page">建筑不存在。<Link to="/">返回首页</Link></div>;
  const bfs = building.floors.map((id) => floors[id]).filter(Boolean);

  // 竖向疏散：各层图纸共用同一套毫米坐标，按整栋楼的水平范围统一归一化，
  // 只画安全出口；同一部楼梯在各层的出口绝对 x 相同，归一化后落在同一条竖线上。
  const exitByFloor = new Map<string, Facility[]>();
  const refPolys: Pt[][] = [];
  for (const f of bfs) {
    const exits = f.facilities.filter((x) => x.kind === 'exit');
    exitByFloor.set(f.id, exits);
    for (const r of f.rooms) refPolys.push(r.polygon);
    for (const e of exits) refPolys.push([{ x: e.x, y: e.y }]);
  }

  type ExitMark = { code: string; pct: number };
  const GUIDE_TOL_PCT = 1; // 水平差 ≤1% 视为同一部楼梯，共用一条对齐线
  const bb = refPolys.length > 0 ? bboxOf(refPolys) : null;
  const span = bb && bb.maxX > bb.minX ? bb.maxX - bb.minX : 1;
  const toPct = (x: number) => (bb ? ((x - bb.minX) / span) * 100 : 0);
  let guides: number[] = [];
  const exitMarks = bfs.map((floor) => {
    const exits: ExitMark[] = (exitByFloor.get(floor.id) ?? []).map((e) => ({ code: e.code, pct: toPct(e.x) }));
    // 全部楼层的出口统一归组：同一条楼梯在任一楼层出現都画出贯穿对齐线
    for (const m of exits) {
      if (!guides.some((g) => Math.abs(g - m.pct) <= GUIDE_TOL_PCT)) guides.push(m.pct);
    }
    return { floor, exits };
  });
  guides.sort((a, b) => a - b);

  return (
    <div className="page">
      <div className="toolbar">
        <input
          value={building.name}
          onChange={(e) => updateBuilding(building.id, { name: e.target.value })}
          style={{ fontWeight: 600 }}
        />
        <select value={building.kind} onChange={(e) => updateBuilding(building.id, { kind: e.target.value as BuildingKind })}>
          {Object.entries(KIND_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <span className="hint">建筑类别决定校验规则（在「规则」页调整）</span>
      </div>

      <h2>楼层</h2>
      <div className="toolbar">
        <input type="number" value={level} onChange={(e) => setLevel(Number(e.target.value))} style={{ width: 80 }} />
        <button onClick={() => addFloor(building.id, level)}>添加楼层</button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>楼层</th>
            <th>房间</th>
            <th>设施</th>
            <th>疏散最远</th>
            <th>结论</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {bfs.map((f) => {
            const v = f.lastValidation;
            return (
              <tr key={f.id}>
                <td>
                  <Link to={`/floor/${f.id}`}>{floorLabel(f.level)}</Link>
                </td>
                <td>{f.rooms.length}</td>
                <td>{f.facilities.length}</td>
                <td>{v?.travelWorstM != null ? `${v.travelWorstM.toFixed(1)}m` : '—'}</td>
                <td>
                  {v ? (
                    <span className={`badge ${v.pass ? 'st-ok' : 'st-damaged'}`}>
                      {v.pass ? '合规' : `${v.items.filter((i) => i.severity === 'error').length} 项超限`}
                    </span>
                  ) : (
                    <span className="hint">未校验</span>
                  )}
                </td>
                <td>
                  <Link className="btn" to={`/floor/${f.id}`}>编辑</Link>{' '}
                  <Link className="btn" to={`/floor/${f.id}/print`}>出图</Link>{' '}
                  <button
                    className="danger"
                    onClick={() => confirm(`删除 ${floorLabel(f.level)}？`) && deleteFloor(f.id)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            );
          })}
          {bfs.length === 0 && (
            <tr>
              <td colSpan={6} className="hint">暂无楼层，先添加一个</td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>竖向疏散（楼梯间）</h2>
      <p className="hint">横向按整栋楼统一比例显示各层安全出口——同一竖线上的出口即同一部竖向疏散楼梯。</p>
      <div className="section">
        <div className="exitstack">
          <div className="exitguides" aria-hidden>
            {guides.map((pct) => (
              <span key={pct} className="exitguide" style={{ left: `${pct}%` }} />
            ))}
          </div>
          {exitMarks.map(({ floor, exits }) => (
            <div key={floor.id} className="exitrow">
              <span className="exitlabel">{floorLabel(floor.level)}</span>
              <div className="exittrack">
                {exits.map((e) => (
                  <span key={e.code} className="exitdot" style={{ left: `${e.pct}%` }} title={e.code}>
                    EXIT
                  </span>
                ))}
                {exits.length === 0 && <span className="hint exitempty">本层无安全出口</span>}
              </div>
            </div>
          ))}
        </div>
        {exitMarks.length === 0 && <span className="hint">无楼层</span>}
      </div>
    </div>
  );
}
