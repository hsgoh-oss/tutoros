import Link from "next/link";
import { PORTAL_ROLE_LABEL, type PortalRole } from "@/lib/portal/auth";
import type { PortalStudentRef } from "@/lib/portal/data";

// 역할·학생 전환 탭 (P-01 겸임 · P-04 여러 자녀).
//
// 전환은 전부 링크(쿼리 파라미터)다. 클라이언트 상태로 화면을 바꾸지 않는 이유가 곧 규칙이다:
// 역할·학생을 바꾸면 서버에서 새로 렌더되므로 이전 역할·이전 자녀의 데이터가 화면에 남을 수
// 없다(검수 18 "자녀 전환 후 이전 자녀 데이터가 남지 않는다"). 권한 판정도 매 요청 세션의
// active 관계로 다시 계산된다 — 회수된 관계는 다음 클릭부터 탭 자체가 사라진다.
//
// 역할을 바꿀 때 student 파라미터는 버린다. 역할마다 열 수 있는 학생 집합이 다르고,
// 이전 역할의 학생 id를 끌고 가면 "없는 조합"을 요청하는 링크가 된다(서버가 다시 첫 학생으로
// 되돌리지만, 애초에 그런 링크를 만들지 않는다).

const TAB_BASE =
  "rounded-full px-4 py-2 text-xs font-extrabold tracking-tight transition";
const TAB_ON = "bg-brand-600 text-white shadow-lift";
const TAB_OFF = "border border-line bg-white text-muted hover:text-ink";

export function RoleSwitcher({
  roles,
  current,
}: {
  roles: PortalRole[];
  current: PortalRole;
}) {
  // 역할이 하나뿐이면 전환할 것이 없다 — 탭을 그리지 않는다(겸임일 때만 나타난다).
  if (roles.length < 2) return null;
  return (
    <nav aria-label="역할 선택" className="mb-6 flex flex-wrap gap-2">
      {roles.map((role) => (
        <Link
          key={role}
          href={`/p?view=${role}`}
          aria-current={role === current ? "page" : undefined}
          className={`${TAB_BASE} ${role === current ? TAB_ON : TAB_OFF}`}
        >
          {PORTAL_ROLE_LABEL[role]}
        </Link>
      ))}
    </nav>
  );
}

export function StudentSwitcher({
  students,
  currentStudentId,
  view,
}: {
  students: PortalStudentRef[];
  currentStudentId: string;
  view: PortalRole;
}) {
  if (students.length < 2) return null;
  return (
    <nav aria-label="학생 선택" className="mb-6">
      <p className="mb-2 text-xs font-extrabold tracking-tight text-muted">
        학생 선택
      </p>
      <div className="flex flex-wrap gap-2">
        {students.map((s) => (
          <Link
            key={s.studentId}
            href={`/p?view=${view}&student=${s.studentId}`}
            aria-current={s.studentId === currentStudentId ? "page" : undefined}
            className={`${TAB_BASE} ${
              s.studentId === currentStudentId ? TAB_ON : TAB_OFF
            }`}
          >
            {s.studentName}
          </Link>
        ))}
      </div>
    </nav>
  );
}
