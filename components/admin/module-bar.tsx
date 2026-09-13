"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { ADMIN_MODULES, ADMIN_TOP_BAR, activeModule } from "./nav-config";

// 상단 모듈 바 — 업무 단위 7개. 이 줄에서 "지금 무슨 일을 하는지"를 먼저 고르고,
// 좌측(sidebar.tsx)은 고른 모듈의 화면만 보여준다.
//
// 모듈을 누르면 그 모듈의 **첫 화면**으로 이동한다. 모듈 자체에는 경로가 없다 —
// 빈 모듈 랜딩 페이지를 만들면 클릭이 두 번(모듈 → 화면)이 되고, 그 중간 화면은 아무 정보도
// 주지 못한다. 넥사크로에서도 대분류는 보통 첫 하위 화면을 바로 연다.
//
// 모바일에서는 이 바가 가로 스크롤된다. 7개를 두 줄로 접으면 헤더가 화면 높이를 두 배로
// 먹어서, 좁은 화면에서 정작 내용이 안 보인다.

export function AdminModuleBar({
  brandName,
  email,
}: {
  brandName: string;
  email: string;
}) {
  const pathname = usePathname();
  const current = activeModule(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white">
      <div className={cn("flex items-center justify-between gap-4 px-5 md:px-6", ADMIN_TOP_BAR.brandRow)}>
        <p className="truncate text-sm font-semibold tracking-tight">
          {brandName}
          <span className="ml-2 text-xs font-medium text-muted">관리자</span>
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden max-w-[220px] truncate text-xs text-muted sm:inline">
            {email}
          </span>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="min-h-8 text-xs font-medium text-muted transition-colors hover:text-ink"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>

      {/* 모듈 탭 — 활성 탭은 밑줄로 표시한다. 배경 칩으로 하면 좌측 메뉴의 선택 표시(brand-50
          배경)와 같은 신호가 두 곳에서 경쟁해 어느 쪽이 현재 위치인지 흐려진다. */}
      <nav
        aria-label="업무 모듈"
        className={cn("overflow-x-auto px-5 md:px-6", ADMIN_TOP_BAR.tabRow)}
      >
        <ul className={cn("flex min-w-max items-stretch gap-1", ADMIN_TOP_BAR.tabRow)}>
          {ADMIN_MODULES.map((mod) => {
            const active = mod.key === current.key;
            return (
              <li key={mod.key}>
                <Link
                  href={mod.items[0].href}
                  title={mod.hint}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center border-b-2 px-3.5 text-[13px] tracking-tight transition-colors",
                    active
                      ? "border-brand-600 font-semibold text-brand-700"
                      : "border-transparent font-medium text-ink-soft hover:border-line-strong hover:text-ink",
                  )}
                >
                  {mod.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
