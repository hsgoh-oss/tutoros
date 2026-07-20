import { Card } from "@/components/ui/card";

// 성적 추이 라인 차트 — 외부 라이브러리 없이 인라인 SVG. 백분위>등급>원점수 순으로 지표 자동 선택.

export interface GradeTrendPoint {
  examName: string;
  examDate: string | null;
  percentile: number | null;
  grade: string | null;
  rawScore: number | null;
}

const W = 680;
const H = 280;
const M = { top: 24, right: 20, bottom: 44, left: 48 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

const LINE_COLOR = "#2b5ce6";
const GRID_COLOR = "#e6ebf3";
const AXIS_COLOR = "#c9d2e3";
const TEXT_COLOR = "#667085";

interface Metric {
  label: string;
  invert: boolean; // 등급처럼 값이 작을수록 좋은 지표는 반전해 위쪽에 배치
  format: (value: number) => string;
  points: { name: string; date: string | null; display: number }[];
}

/** 값이 2개 이상 존재하는 첫 지표를 백분위 → 등급 → 원점수 순으로 고른다. */
function pickMetric(grades: GradeTrendPoint[]): Metric | null {
  const pct = grades.filter((g) => g.percentile != null);
  if (pct.length >= 2) {
    return {
      label: "백분위",
      invert: false,
      format: (v) => `${Math.round(v)}`,
      points: pct.map((g) => ({
        name: g.examName,
        date: g.examDate,
        display: g.percentile as number,
      })),
    };
  }

  const gr = grades
    .map((g) => ({ g, num: g.grade != null ? Number.parseFloat(g.grade) : NaN }))
    .filter((x) => Number.isFinite(x.num));
  if (gr.length >= 2) {
    return {
      label: "등급",
      invert: true,
      format: (v) => `${Math.round(v)}등급`,
      points: gr.map((x) => ({
        name: x.g.examName,
        date: x.g.examDate,
        display: x.num,
      })),
    };
  }

  const raw = grades.filter((g) => g.rawScore != null);
  if (raw.length >= 2) {
    return {
      label: "원점수",
      invert: false,
      format: (v) => `${Math.round(v)}점`,
      points: raw.map((g) => ({
        name: g.examName,
        date: g.examDate,
        display: g.rawScore as number,
      })),
    };
  }

  return null;
}

function shortName(name: string): string {
  return name.length > 6 ? `${name.slice(0, 6)}…` : name;
}

function shortDate(date: string | null): string {
  // "2026-03-15" → "3/15"
  if (!date) return "";
  const parts = date.slice(0, 10).split("-");
  if (parts.length < 3) return date;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

export function GradeTrend({ grades }: { grades: GradeTrendPoint[] }) {
  const metric = pickMetric(grades);

  if (!metric || metric.points.length < 2) {
    return (
      <Card className="mb-6">
        <p className="text-center text-sm text-muted">
          추이를 표시할 데이터가 부족합니다.
        </p>
      </Card>
    );
  }

  const { points, invert } = metric;
  const n = points.length;
  const displays = points.map((p) => p.display);

  // 라벨용 실제 도메인(rawLo~rawHi)과 플로팅용 패딩 도메인(plotLo~plotHi)을 분리.
  const rawLo = Math.min(...displays);
  const rawHi = Math.max(...displays);
  let lo = rawLo;
  let hi = rawHi;
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.12;
  const plotLo = lo - pad;
  const plotHi = hi + pad;

  const x = (i: number) => M.left + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = (display: number) => {
    const t = (display - plotLo) / (plotHi - plotLo);
    const frac = invert ? t : 1 - t;
    return M.top + frac * PLOT_H;
  };

  const polyline = points.map((p, i) => `${x(i)},${y(p.display)}`).join(" ");

  const tickCount = rawLo === rawHi ? 1 : 4;
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    tickCount === 1 ? rawLo : rawLo + ((rawHi - rawLo) * i) / (tickCount - 1),
  );

  // x축 라벨이 너무 촘촘하지 않도록 최대 ~8개만 표기.
  const labelStep = Math.ceil(n / 8);

  const first = points[0];
  const last = points[n - 1];
  const improved = invert ? last.display < first.display : last.display > first.display;
  const worsened = invert ? last.display > first.display : last.display < first.display;
  const trendWord = improved ? "향상되는" : worsened ? "하락하는" : "유지되는";
  const ariaLabel = `${metric.label} 추이 차트. 시험 ${n}개, ${metric.format(
    first.display,
  )}에서 ${metric.format(last.display)}로 ${trendWord} 추세.`;

  return (
    <Card className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-black tracking-tight">성적 추이</h2>
        <span className="text-xs font-bold text-muted">{metric.label} 기준</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full"
      >
        {/* y축 그리드 + 눈금 라벨 */}
        {ticks.map((t, i) => {
          const ty = y(t);
          return (
            <g key={`tick-${i}`}>
              <line
                x1={M.left}
                y1={ty}
                x2={W - M.right}
                y2={ty}
                stroke={GRID_COLOR}
                strokeWidth={1}
              />
              <text
                x={M.left - 8}
                y={ty}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fill={TEXT_COLOR}
              >
                {metric.format(t)}
              </text>
            </g>
          );
        })}

        <line
          x1={M.left}
          y1={M.top}
          x2={M.left}
          y2={M.top + PLOT_H}
          stroke={AXIS_COLOR}
          strokeWidth={1}
        />
        <line
          x1={M.left}
          y1={M.top + PLOT_H}
          x2={W - M.right}
          y2={M.top + PLOT_H}
          stroke={AXIS_COLOR}
          strokeWidth={1}
        />

        <polyline
          points={polyline}
          fill="none"
          stroke={LINE_COLOR}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* 데이터 점 + x축 라벨 */}
        {points.map((p, i) => {
          const px = x(i);
          const py = y(p.display);
          const showLabel = i % labelStep === 0 || i === n - 1;
          const date = shortDate(p.date);
          return (
            <g key={`pt-${i}`}>
              <circle cx={px} cy={py} r={3.5} fill="#ffffff" stroke={LINE_COLOR} strokeWidth={2} />
              {showLabel && (
                <text
                  x={px}
                  y={M.top + PLOT_H + 16}
                  textAnchor="middle"
                  fontSize={10}
                  fill={TEXT_COLOR}
                >
                  <tspan x={px}>{shortName(p.name)}</tspan>
                  {date && (
                    <tspan x={px} dy={12}>
                      {date}
                    </tspan>
                  )}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Card>
  );
}
