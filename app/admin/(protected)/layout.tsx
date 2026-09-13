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
      <div className="flex">
        <AdminSidebar />
        <div className="min-w-0 flex-1">
          <main className="mx-auto w-full max-w-7xl px-5 py-8 md:px-10">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
