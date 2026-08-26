import type { SVGProps } from "react";

/**
 * 관리자 메뉴 아이콘 — 24 그리드·stroke 1.5·currentColor로 통일한 인라인 SVG.
 *
 * 왜 이미지가 아니라 SVG인가: 메뉴 아이콘은 18px에서 읽혀야 하고 20개가 한 줄에 세로로 붙는다.
 * 굵기·끝단 처리·광학 크기가 조금만 어긋나도 "제각각 만든 것"처럼 보여서, 아이콘이 없느니만
 * 못한 결과가 된다. 래스터 이미지는 이 정렬을 보장할 수 없고 hover/active 색도 따라오지 않는다.
 * currentColor를 쓰면 링크 색이 바뀔 때 아이콘도 같이 바뀐다.
 *
 * 그림은 이름을 그대로 옮기지 않는다 — 20개가 서로 구별되는 것이 우선이라,
 * 비슷해질 만한 것들(수업 기록/과제, 정규 등록/출결)은 실루엣을 일부러 다르게 뒀다.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

const dot = (cx: number, cy: number) => (
  <circle cx={cx} cy={cy} r={1.4} fill="currentColor" stroke="none" />
);

export const NavIcon = {
  dashboard: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
    </Svg>
  ),
  dday: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      {dot(12, 15.5)}
    </Svg>
  ),
  recruit: (p: IconProps) => (
    <Svg {...p}>
      <path d="M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
      <circle cx="8.5" cy="7.5" r="3.5" />
      <path d="M18.5 7.5v6M21.5 10.5h-6" />
    </Svg>
  ),
  review: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />
    </Svg>
  ),
  faq: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-.9.8-.9 1.4v.4" />
      {dot(12, 16.8)}
    </Svg>
  ),
  settings: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 7.5h9M18.5 7.5H20M4 16.5h3.5M13 16.5H20" />
      <circle cx="15.5" cy="7.5" r="2.4" />
      <circle cx="10" cy="16.5" r="2.4" />
    </Svg>
  ),
  consult: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.6 3.6V16h-.9A.5.5 0 0 1 4 15.5z" />
    </Svg>
  ),
  trial: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9.5 3v6.4L4.7 17.1A2 2 0 0 0 6.4 20h11.2a2 2 0 0 0 1.7-2.9L14.5 9.4V3" />
      <path d="M8 3h8M7.6 14h8.8" />
    </Svg>
  ),
  enrollment: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9 4.5H7.5A2.5 2.5 0 0 0 5 7v11a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V7a2.5 2.5 0 0 0-2.5-2.5H15" />
      <rect x="9" y="2.5" width="6" height="4" rx="1.2" />
      <path d="M9.3 13.3l2.1 2.1 3.6-3.8" />
    </Svg>
  ),
  student: (p: IconProps) => (
    <Svg {...p}>
      <path d="M15.5 20.5v-1.5a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4v1.5" />
      <circle cx="9.5" cy="7.5" r="3.5" />
      <path d="M21 20.5v-1.5a4 4 0 0 0-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6" />
    </Svg>
  ),
  packages: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3l8.5 4.4L12 11.8 3.5 7.4z" />
      <path d="M3.8 12.2L12 16.4l8.2-4.2M3.8 16.6L12 20.8l8.2-4.2" />
    </Svg>
  ),
  lesson: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v14.5H6.5A2.5 2.5 0 0 0 4 20z" />
      <path d="M4 20a2.5 2.5 0 0 1 2.5-2.5H19V21H6.5" />
      <path d="M8 7.5h7" />
    </Svg>
  ),
  homework: (p: IconProps) => (
    <Svg {...p}>
      <path d="M11.5 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-5" />
      <path d="M17.6 3.4a2.05 2.05 0 0 1 2.9 2.9L13 13.8l-3.9 1 1-3.9z" />
    </Svg>
  ),
  schedule: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <path d="M7.5 13.5h3v3h-3z" />
    </Svg>
  ),
  attendance: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <path d="M8 12.3l2.9 2.9L16.4 9" />
    </Svg>
  ),
  grade: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 3.5v16a1 1 0 0 0 1 1h15.5" />
      <path d="M7.5 15.8l3.6-4.2 3 2.6 4.6-5.7" />
    </Svg>
  ),
  payment: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M7 14.5h3.5" />
    </Svg>
  ),
  material: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h2.7a2 2 0 0 1 1.6.8l1 1.4h6.7A2.5 2.5 0 0 1 21 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-12A2.5 2.5 0 0 1 4 17.5z" />
    </Svg>
  ),
  report: (p: IconProps) => (
    <Svg {...p}>
      <path d="M13.2 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8.8z" />
      <path d="M13.2 3v4.3A1.5 1.5 0 0 0 14.7 8.8H19" />
      <path d="M10 12.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </Svg>
  ),
  message: (p: IconProps) => (
    <Svg {...p}>
      <path d="M20.5 3.5L10 14" />
      <path d="M20.5 3.5l-6.7 17.2-3.8-7.2-7.2-3.8z" />
    </Svg>
  ),
} as const;

export type NavIconName = keyof typeof NavIcon;
