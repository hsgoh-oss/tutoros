import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { resolveTenant } from "@/lib/tenant";
import { GraduationCap } from "lucide-react";
import { AdminThemeToggle } from "@/components/admin/theme";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "로그인" };

// 미들웨어가 ?next=로 원래 목적지를 전달한다 — /admin 내부 경로만 허용(오픈 리다이렉트 차단).
function safeNext(next: string | undefined): string {
  if (next && next.startsWith("/admin") && !next.startsWith("/admin/login")) {
    return next;
  }
  return "/admin/dashboard";
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destination = safeNext(next);

  if (await getAdminSession()) redirect(destination);

  const tenant = await resolveTenant();

  return (
    <div className="dash-login">
      <div className="dash-login-theme"><AdminThemeToggle /></div>
      <div className="dash-login-panel">
        <div className="mb-8">
          <span className="dash-login-mark"><GraduationCap size={24} aria-hidden="true" /></span>
          <p className="mt-6 text-xs text-muted">
            {tenant.brandName}
          </p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">관리자 로그인</h1>
          <p className="mt-2 text-sm text-muted">이메일로 받은 인증번호를 입력해 주세요.</p>
        </div>
        <LoginForm next={destination} />
      </div>
    </div>
  );
}
