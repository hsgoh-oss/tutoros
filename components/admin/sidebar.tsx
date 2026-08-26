"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NavIcon, type NavIconName } from "./nav-icons";

const GROUPS = [
  {
    label: "사이트",
    items: [
      { href: "/admin/dashboard", label: "대시보드", icon: "dashboard" },
      { href: "/admin/dday", label: "D-day 관리", icon: "dday" },
      { href: "/admin/recruit", label: "모집 현황", icon: "recruit" },
      { href: "/admin/reviews", label: "후기 관리", icon: "review" },
      { href: "/admin/faq", label: "FAQ 관리", icon: "faq" },
      { href: "/admin/settings", label: "사이트 설정", icon: "settings" },
    ],
  },
  {
    label: "학생·상담 CRM",
    items: [
      { href: "/admin/consultations", label: "상담 관리", icon: "consult" },
      { href: "/admin/trials", label: "시범수업", icon: "trial" },
      { href: "/admin/enrollments", label: "정규 등록", icon: "enrollment" },
      { href: "/admin/students", label: "학생 관리", icon: "student" },
      { href: "/admin/packages", label: "수업 묶음", icon: "packages" },
      { href: "/admin/lessons", label: "수업 기록", icon: "lesson" },
      { href: "/admin/homework", label: "과제 관리", icon: "homework" },
      { href: "/admin/schedules", label: "일정 관리", icon: "schedule" },
      { href: "/admin/attendance", label: "출결·정정", icon: "attendance" },
      { href: "/admin/grades", label: "성적 관리", icon: "grade" },
      { href: "/admin/payments", label: "결제 관리", icon: "payment" },
      { href: "/admin/materials", label: "자료 관리", icon: "material" },
      { href: "/admin/reports", label: "AI 리포트", icon: "report" },
      { href: "/admin/messages", label: "메시지 발송", icon: "message" },
    ],
  },
] as const satisfies ReadonlyArray<{
  label: string;
  items: ReadonlyArray<{ href: string; label: string; icon: NavIconName }>;
}>;

export function AdminSidebar({
  brandName,
  email,
}: {
  brandName: string;
  email: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-5 px-3 pb-8" aria-label="관리자 메뉴">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wide text-muted">
            {group.label}
          </p>
          <ul className="flex flex-col gap-px">
            {group.items.map((item) => {
              const active = pathname.startsWith(item.href);
              const Icon = NavIcon[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium tracking-tight transition-colors",
                      active
                        ? "bg-brand-50 font-semibold text-brand-700"
                        : "text-ink-soft hover:bg-soft",
                    )}
                  >
                    {/* 아이콘은 스캔용 보조 신호라 글자보다 한 톤 옅게 둔다 — 선택된 항목만 같은 색. */}
                    <Icon
                      className={cn(
                        "shrink-0",
                        active ? "text-brand-600" : "text-muted",
                      )}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <form action="/api/auth/logout" method="post" className="px-2.5">
        <button
          type="submit"
          className="flex min-h-9 items-center text-[13px] font-medium text-muted hover:text-ink"
        >
          로그아웃
        </button>
      </form>
    </nav>
  );

  return (
    <>
      {/* 모바일 상단 바 */}
      <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b border-line bg-white px-5 py-3 md:hidden">
        <span className="text-sm font-semibold">{brandName} 관리자</span>
        <button
          type="button"
          className="min-h-9 rounded-md bg-soft px-3 text-sm font-semibold"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "닫기" : "메뉴"}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-white pt-16 md:hidden">
          {nav}
        </div>
      )}
      <div className="h-12 md:hidden" aria-hidden />

      {/* 데스크톱 사이드바 */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-line bg-white md:flex">
        <div className="border-b border-line px-5 py-4">
          <p className="text-sm font-semibold tracking-tight">{brandName}</p>
          <p className="mt-0.5 truncate text-xs text-muted">{email}</p>
        </div>
        <div className="pt-4">{nav}</div>
      </aside>
    </>
  );
}
