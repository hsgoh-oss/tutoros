import type { NavIconName } from "./nav-icons";

// 관리자 메뉴 구성 — 상단 모듈 바(module-bar.tsx)와 좌측 하위 메뉴(sidebar.tsx)의 단일 원천.
//
// 왜 두 단으로 나눴나: 메뉴가 22개가 되면서 사이드바 한 장에 전부 세로로 쌓였다. 그 길이는
// 스크롤 문제가 아니라 **찾기 문제**다 — 22개가 같은 무게로 나열돼 있으면 지금 하려는 일이
// 어디 있는지 매번 처음부터 훑어야 한다. 업무 단위(모듈)를 먼저 고르게 하면 한 번에 보이는
// 항목이 1~5개로 줄고, 나머지는 "지금 하는 일이 아닌 것"으로 시야에서 사라진다.
//
// 묶는 기준은 화면의 성격이 아니라 **업무 흐름**이다: 학생이 들어오고(유입) → 수업하고(수업)
// → 학생별로 쌓이고(학생) → 돈이 오가고(정산). 사이트·운영은 학생과 무관한 뒷단이라 뒤에 둔다.
//
// 라우팅은 그대로다. 이 파일은 링크를 어떻게 묶어 보여줄지만 정하고, 각 화면의 경로·권한·동작은
// 하나도 바뀌지 않는다(넥사크로식 MDI 작업 탭을 도입하지 않은 이유도 이것이다 — 탭 상태를
// 클라이언트가 들고 있으면 뒤로가기·새로고침·딥링크가 전부 다르게 동작한다).

/**
 * 상단 모듈 바의 치수 — 바 자신과 그 아래 붙는 요소가 **같은 숫자**를 써야 한다.
 *
 * 처음엔 바 높이를 내용이 정하게 두고(패딩만 지정) 아래 요소에 어림값을 넣었다가 4px이 어긋났다.
 * 스크롤하면 그 틈으로 본문이 비쳐 지나간다. 폰트 지표에 따라 1~2px씩 또 달라지므로,
 * 높이를 명시하고 합계를 여기 한 번만 적는다: 44(브랜드 줄) + 40(탭 줄) + 1(아래 테두리) = 85.
 *
 * Tailwind는 소스에 그대로 적힌 클래스 문자열만 생성하므로, 조립하지 않고 완성형으로 둔다.
 */
export const ADMIN_TOP_BAR = {
  brandRow: "h-11",
  tabRow: "h-10",
  /** 바 아래에 sticky로 붙는 요소의 top */
  stickyTop: "top-[85px]",
  /** 바를 뺀 남은 화면 높이 */
  belowHeight: "h-[calc(100vh-85px)]",
} as const;

export interface AdminNavItem {
  href: string;
  label: string;
  icon: NavIconName;
}

export interface AdminModule {
  key: string;
  label: string;
  /** 상단 바에서 모듈 이름 아래 깔리는 한 줄 설명(툴팁). */
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
    label: "유입",
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
 * 상단 바가 아무것도 선택되지 않은 채로 떠 있으면 "어디에 있는지" 알 수 없다.
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
