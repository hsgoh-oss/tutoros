import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { resolveTenant } from "@/lib/tenant";
import { AdminModuleBar } from "@/components/admin/module-bar";
import { AdminSidebar } from "@/components/admin/sidebar";

// 관리자 셸 — 상단 모듈 바(업무 단위) + 좌측 하위 메뉴(그 모듈의 화면).
//
// 메뉴 22개를 한 장에 세로로 쌓던 구조를 두 단으로 나눈 결과다. 라우팅은 그대로이므로
// 이 파일이 하는 일도 그대로다: 세션 확인 → 테넌트 확인 → 껍데기 렌더.
export default async function AdminProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  const tenant = await resolveTenant();

  return (
    <div className="min-h-screen bg-soft">
      <AdminModuleBar brandName={tenant.brandName} email={session.email} />
      {/* 모바일은 세로(하위 메뉴 줄 → 본문), 데스크톱은 가로(사이드바 | 본문).
          flex 한 줄로 두면 모바일의 가로 메뉴 줄이 사이드바 자리(형제 flex 항목)에 들어가
          본문을 화면 밖으로 밀어낸다 — 실제로 학생 관리가 빈 화면으로 보였다. */}
      <div className="flex flex-col md:flex-row">
        <AdminSidebar />
        <div className="min-w-0 flex-1">
          <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-10 md:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
