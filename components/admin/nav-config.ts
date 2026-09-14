import type { NavIconName } from "./nav-icons";

// Shared navigation for the sidebar, menu search and active-page matching.
export interface AdminNavItem {
  href: string;
  label: string;
  icon: NavIconName;
}

export interface AdminModule {
  key: string;
  label: string;
  /** 메뉴 그룹이 다루는 업무 범위. */
  hint: string;
  items: readonly AdminNavItem[];
}

export const ADMIN_MODULES = [
  {
    key: "home",
    label: "홈",
    hint: "오늘 업무와 전체 현황",
    items: [{ href: "/admin/dashboard", label: "대시보드", icon: "dashboard" }],
  },
  {
    key: "intake",
    label: "상담·등록",
    hint: "상담 신청부터 정규 등록까지",
    items: [
      { href: "/admin/consultations", label: "상담 관리", icon: "consult" },
      { href: "/admin/trials", label: "시범수업", icon: "trial" },
      { href: "/admin/enrollments", label: "정규 등록", icon: "enrollment" },
      { href: "/admin/recruit", label: "모집 현황", icon: "recruit" },
    ],
  },
  {
    key: "lesson",
    label: "수업",
    hint: "일정·회차·출결·과제",
    items: [
      { href: "/admin/schedules", label: "수업 캘린더", icon: "schedule" },
      { href: "/admin/packages", label: "수업 묶음", icon: "packages" },
      { href: "/admin/lessons", label: "수업 기록", icon: "lesson" },
      { href: "/admin/attendance", label: "출결·정정", icon: "attendance" },
      { href: "/admin/homework", label: "과제 관리", icon: "homework" },
    ],
  },
  {
    key: "student",
    label: "학생",
    hint: "학생별로 쌓이는 기록",
    items: [
      { href: "/admin/students", label: "학생 관리", icon: "student" },
      { href: "/admin/grades", label: "성적 관리", icon: "grade" },
      { href: "/admin/reports", label: "AI 리포트", icon: "report" },
      { href: "/admin/materials", label: "자료 관리", icon: "material" },
    ],
  },
  {
    key: "money",
    label: "정산",
    hint: "청구·수납과 안내 발송",
    items: [
      { href: "/admin/payments", label: "결제 관리", icon: "payment" },
      { href: "/admin/messages", label: "메시지 발송", icon: "message" },
    ],
  },
  {
    key: "site",
    label: "사이트",
    hint: "공개 사이트에 나가는 것",
    items: [
      { href: "/admin/dday", label: "입시 캘린더", icon: "dday" },
      { href: "/admin/reviews", label: "후기·사례 관리", icon: "review" },
      { href: "/admin/faq", label: "FAQ 관리", icon: "faq" },
      { href: "/admin/settings", label: "사이트 설정", icon: "settings" },
    ],
  },
  {
    key: "ops",
    label: "운영",
    hint: "개인정보·감사 기록",
    items: [
      { href: "/admin/privacy", label: "개인정보 보존", icon: "privacy" },
      { href: "/admin/activity", label: "변경 이력", icon: "activity" },
    ],
  },
] as const satisfies readonly AdminModule[];

export type AdminModuleKey = (typeof ADMIN_MODULES)[number]["key"];

/**
 * 지금 경로가 속한 메뉴 항목. **가장 긴 href가 이긴다.**
 *
 * 단순 startsWith 첫 일치로 잡으면 상세·하위 경로에서 엉뚱한 항목이 켜진다. 지금은 접두사가
 * 겹치는 쌍이 없지만(예: /admin/reports vs /admin/recruit), 나중에 /admin/lessons/plans 같은
 * 경로가 생겨도 규칙이 버티도록 길이 우선으로 둔다.
 */
export function activeNavItem(pathname: string): AdminNavItem | null {
  let best: AdminNavItem | null = null;
  for (const mod of ADMIN_MODULES) {
    for (const item of mod.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        if (!best || item.href.length > best.href.length) best = item;
      }
    }
  }
  return best;
}

/**
 * 지금 열어야 할 모듈. 어느 항목에도 걸리지 않으면(/admin 진입 직후 등) 첫 모듈로 둔다 —
 * 사이드바는 대시보드를 기본 위치로 표시한다.
 */
export function activeModule(pathname: string): AdminModule {
  const item = activeNavItem(pathname);
  if (item) {
    const found = ADMIN_MODULES.find((m) =>
      m.items.some((i) => i.href === item.href),
    );
    if (found) return found;
  }
  return ADMIN_MODULES[0];
}
