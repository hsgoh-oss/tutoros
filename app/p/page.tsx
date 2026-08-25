import {
  PORTAL_ROLE_LABEL,
  getPortalSession,
  isPortalRole,
  type PortalRole,
} from "@/lib/portal/auth";
import { studentsForRole } from "@/lib/portal/data";
import {
  RoleSwitcher,
  StudentSwitcher,
} from "@/components/portal/role-switcher";
import { StudentView } from "./student-view";
import { GuardianView } from "./guardian-view";
import { PayerView } from "./payer-view";
import { ContractorView } from "./contractor-view";

// 역할별 포털 홈 (P-02 로그인 → 역할별 포털 · P-03~P-05 역할 뷰).
//
// 이 페이지가 하는 일은 셋뿐이다: ① 세션 확인 ② 역할·학생 선택 ③ 역할 뷰 하나 실행.
// 조회는 전부 역할 뷰 안에서 일어나고, 각 조회 함수는 세션의 active 관계로 다시 게이트된다
// (화면 선택과 권한 판정이 같은 곳에 있으면 한쪽만 고쳐도 권한이 새기 때문에 분리한다).
//
// ⚠️ 역할 분기의 규칙(검수 17·19): 아래 분기는 배타적이다 — 선택된 역할의 뷰 하나만 실행된다.
// 학생·보호자 뷰를 렌더할 때 payer-view 모듈의 코드(=금전 조회)는 한 줄도 실행되지 않고,
// 반대로 납부자 뷰는 학습 조회 모듈을 부르지 않는다. 역할 뷰를 한 파일에 합치거나 공통 조회를
// 이 파일로 끌어올리지 말 것 — 그 순간 "학생 뷰에 금전 쿼리가 없다"는 보장이 사라진다.
//
// 세션 없음·링크 무효는 같은 안내로 수렴한다(P-02 "계정 존재를 노출하지 않는 확인").

/** 역할 탭 순서 — 학습(본인) → 보호 → 금전 → 계약. 기본 뷰도 이 순서의 첫 역할이다. */
const ROLE_ORDER: PortalRole[] = ["student", "guardian", "payer", "contractor"];

const ROLE_INTRO: Record<PortalRole, string> = {
  student:
    "선생님이 승인한 리포트와 배부된 과제를 확인하고, 과제 제출과 질문을 남길 수 있어요.",
  guardian: "연결된 학생의 일정·리포트·과제 현황을 확인할 수 있어요.",
  payer: "청구·수납·환불 상태를 확인할 수 있어요.",
  contractor: "계약 관련 화면은 준비 중입니다.",
};

type SearchParams = Record<string, string | string[] | undefined>;

/** 쿼리 파라미터 하나만 취한다(배열로 오면 무시 — 화면 선택은 단일 값이어야 한다). */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * 비로그인 안내 — 쿠키 없음·만료·회수·관계 종료·무효 링크가 전부 여기로 온다.
 * 문구는 고정 문자열이다: URL로 넘어온 코드(e)로 분기만 하고 URL의 텍스트를 그리지 않는다.
 */
function SignedOutNotice({ reason }: { reason: string | undefined }) {
  const message =
    reason === "link"
      ? "지금은 이 링크로 접속할 수 없습니다. 잠시 후 다시 시도해 보시고, 계속 열리지 않으면 담당 선생님께 새 초대를 요청해 주세요."
      : reason === "out"
        ? "로그아웃했습니다. 다시 이용하시려면 받으신 초대 링크로 접속해 주세요."
        : "받으신 초대 링크로 접속해 주세요. 링크가 없거나 열리지 않으면 담당 선생님께 요청해 주세요.";
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-5 py-12">
      <div className="w-full rounded-card border border-line bg-white p-8 text-center shadow-card">
        <p className="text-sm font-extrabold tracking-tight text-brand-600">
          학습 포털
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{message}</p>
        <p className="mt-6 text-xs font-bold tracking-tight text-muted">
          TUTOR OS
        </p>
      </div>
    </main>
  );
}

export default async function PortalRolePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await getPortalSession();
  if (!session) return <SignedOutNotice reason={one(params.e)} />;

  // 열 수 있는 역할 = 지금 살아 있는 active 관계의 역할. 회수된 관계는 세션 조회 단계에서
  // 이미 빠져 있으므로 탭에도 나타나지 않는다(검수 21 — 다음 요청부터 접근 차단).
  const roles = ROLE_ORDER.filter((role) =>
    session.relations.some((r) => r.role === role),
  );
  const wantedView = one(params.view);
  const view: PortalRole =
    wantedView && isPortalRole(wantedView) && roles.includes(wantedView)
      ? wantedView
      : roles[0];

  // 이 역할로 열 수 있는 학생만(검수 18). 요청된 student가 목록에 없으면 조용히 첫 학생으로
  // 되돌린다 — "그 학생은 볼 수 없습니다"라고 알리면 존재를 알려 주는 셈이 된다.
  const students = studentsForRole(session, view);
  const wantedStudent = one(params.student);
  const student =
    students.find((s) => s.studentId === wantedStudent) ?? students[0];
  if (!student) return <SignedOutNotice reason={undefined} />;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-5 py-12">
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-extrabold tracking-tight text-brand-600">
              학습 포털 · {PORTAL_ROLE_LABEL[view]}
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-ink">
              {session.contactName}님
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {ROLE_INTRO[view]} 이 링크는 본인만 사용해 주세요.
            </p>
          </div>
          {/* 로그아웃은 POST — 세션 행 회수 + 쿠키 삭제(app/p/logout/route.ts). */}
          <form action="/p/logout" method="post">
            <button
              type="submit"
              className="rounded-full border border-line bg-white px-4 py-2 text-xs font-extrabold tracking-tight text-muted hover:text-ink"
            >
              로그아웃
            </button>
          </form>
        </div>
      </header>

      <RoleSwitcher roles={roles} current={view} />
      <StudentSwitcher
        students={students}
        currentStudentId={student.studentId}
        view={view}
      />

      {view === "student" && (
        <StudentView
          session={session}
          studentId={student.studentId}
          studentName={student.studentName}
        />
      )}
      {view === "guardian" && (
        <GuardianView
          session={session}
          studentId={student.studentId}
          studentName={student.studentName}
        />
      )}
      {view === "payer" && (
        <PayerView
          session={session}
          studentId={student.studentId}
          studentName={student.studentName}
        />
      )}
      {view === "contractor" && (
        <ContractorView studentName={student.studentName} />
      )}

      <footer className="mt-10 text-center text-xs font-bold tracking-tight text-muted">
        TUTOR OS
      </footer>
    </main>
  );
}
