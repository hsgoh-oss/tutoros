import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { resolveTenant } from "@/lib/tenant";
import { Card } from "@/components/ui/card";
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
    <div className="flex min-h-screen items-center justify-center bg-soft px-5">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-2xl font-semibold tracking-tight text-ink">
            {tenant.brandName}
          </p>
          <p className="mt-1.5 text-sm text-muted">
            관리자 로그인 — 비밀번호 없이 이메일 인증번호로 로그인합니다.
          </p>
        </div>
        <Card className="p-6">
          <LoginForm next={destination} />
        </Card>
      </div>
    </div>
  );
}
