"use client";

import { useState } from "react";

export type ConsultationPoint = { date: string; count: number };

export function ConsultationChart({ points, connected }: { points: ConsultationPoint[]; connected: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const total = points.reduce((sum, point) => sum + point.count, 0);
  const max = Math.max(1, ...points.map((point) => point.count));
  const width = 1000;
  const height = 220;
  const coordinates = points.map((point, index) => ({ x: index / Math.max(1, points.length - 1) * width, y: height - 16 - point.count / max * (height - 44) }));
  const path = coordinates.map((point, index) => {
    if (!index) return `M ${point.x} ${point.y}`;
    const previous = coordinates[index - 1];
    const midpoint = (previous.x + point.x) / 2;
    return `C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`;
  }).join(" ");
  const labelIndexes = Array.from({ length: 5 }, (_, index) => Math.round(index * (points.length - 1) / 4));

  return <section className="dash-chart" aria-label="상담 접수 추이">
    <div className="dash-chart-heading">
      <div><h2>최근 {points.length}일 상담 접수</h2><strong>{connected ? `${total}건` : "—"}</strong></div>
      <span className="text-xs text-muted">일별 접수 건수</span>
    </div>
    <div className="dash-chart-plot" tabIndex={0} role="group" aria-label="일별 상담 접수. 좌우 방향키로 날짜를 확인할 수 있습니다."
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        setActive(Math.max(0, Math.min(points.length - 1, Math.round((event.clientX - bounds.left) / bounds.width * (points.length - 1)))));
      }}
      onPointerLeave={() => setActive(null)} onBlur={() => setActive(null)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          setActive((index) => Math.max(0, Math.min(points.length - 1, (index ?? 0) + (event.key === "ArrowRight" ? 1 : -1))));
        }
      }}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={connected ? `${points.length}일간 총 ${total}건 접수` : "데이터베이스 연결 필요"}>
        {coordinates.map((point, index) => <line key={index} x1={point.x} x2={point.x} y1={0} y2={height} className="dash-chart-grid" />)}
        {connected && total > 0 && <path d={`${path} L ${width} ${height} L 0 ${height} Z`} className="dash-chart-area" />}
        {connected && <path d={path} className="dash-chart-line" />}
        {active !== null && connected && <line x1={coordinates[active].x} x2={coordinates[active].x} y1={0} y2={height} stroke="var(--color-brand-600)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
      </svg>
      {active !== null && connected && <div className="dash-chart-tooltip" role="status">{points[active].date.replaceAll("-", ".")} · {points[active].count}건</div>}
      {(!connected || total === 0) && <p className="dash-chart-empty">{connected ? "이 기간에 접수된 상담이 없습니다" : "데이터베이스 연결 후 확인할 수 있습니다"}</p>}
    </div>
    <div className="dash-chart-labels">{labelIndexes.map((index) => <span key={points[index].date} style={{ left: `${index / (points.length - 1) * 100}%` }}>{Number(points[index].date.slice(5, 7))}월 {Number(points[index].date.slice(8))}일</span>)}</div>
  </section>;
}
