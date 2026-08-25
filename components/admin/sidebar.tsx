"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const GROUPS = [
  {
    label: "사이트",
    items: [
      { href: "/admin/dashboard", label: "대시보드" },
      { href: "/admin/dday", label: "D-day 관리" },
      { href: "/admin/recruit", label: "모집 현황" },
      { href: "/admin/reviews", label: "후기 관리" },
      { href: "/admin/faq", label: "FAQ 관리" },
      { href: "/admin/settings", label: "사이트 설정" },
    ],
  },
  {
    label: "학생·상담 CRM",
    items: [
      { href: "/admin/consultations", label: "상담 관리" },
      { href: "/admin/trials", label: "시범수업" },
      { href: "/admin/enrollments", label: "정규 등록" },
      { href: "/admin/students", label: "학생 관리" },
      { href: "/admin/packages", label: "수업 묶음" },
      { href: "/admin/lessons", label: "수업 기록" },
      { href: "/admin/homework", label: "과제 관리" },
      { href: "/admin/schedules", label: "일정 관리" },
      { href: "/admin/attendance", label: "출결·정정" },
      { href: "/admin/grades", label: "성적 관리" },
      { href: "/admin/payments", label: "결제 관리" },
      { href: "/admin/materials", label: "자료 관리" },
      { href: "/admin/reports", label: "AI 리포트" },
      { href: "/admin/messages", label: "메시지 발송" },
    ],
  },
] as const;

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
    <nav className="flex flex-col gap-6 px-4 pb-8" aria-label="관리자 메뉴">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-2 text-[11px] font-black tracking-wide text-muted">
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex min-h-11 items-center rounded-xl px-3 text-sm font-bold tracking-tight text-ink-soft transition-colors hover:bg-soft",
                    pathname.startsWith(item.href) &&
                      "bg-brand-50 text-brand-700",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <form action="/api/auth/logout" method="post" className="px-3">
        <button
          type="submit"
          className="flex min-h-11 items-center text-sm font-bold text-muted hover:text-ink"
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
        <span className="text-sm font-black">{brandName} 관리자</span>
        <button
          type="button"
          className="min-h-11 rounded-xl bg-soft px-3.5 text-sm font-extrabold"
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
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-white md:flex">
        <div className="px-7 py-7">
          <p className="text-base font-black tracking-tight">{brandName}</p>
          <p className="mt-1 truncate text-xs text-muted">{email}</p>
        </div>
        {nav}
      </aside>
    </>
  );
}
