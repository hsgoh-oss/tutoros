"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NavIcon } from "./nav-icons";
import { ADMIN_TOP_BAR, activeModule, activeNavItem } from "./nav-config";

// 좌측 하위 메뉴 — 상단에서 고른 모듈의 화면만 보여준다(module-bar.tsx와 한 쌍).
//
// 예전에는 여기에 22개가 전부 쌓여 있었다. 이제 한 번에 보이는 건 1~5개다.
// 목록이 짧아진 만큼 각 항목을 크게 두지 않는다 — 짧은 목록은 크기가 아니라 위치로 기억되고,
// 남는 세로 공간은 내용이 쓰는 편이 낫다.
//
// 모바일에는 세로 사이드바를 두지 않는다. 대신 같은 목록을 상단 모듈 바 아래 가로 줄로 깐다:
// 항목이 다섯 개 이하라 대개 한 줄에 들어가고, 햄버거를 눌러 오버레이를 여는 것보다
// "지금 모듈에 뭐가 있는지"가 늘 보이는 편이 낫다.

export function AdminSidebar() {
  const pathname = usePathname();
  const current = activeModule(pathname);
  const item = activeNavItem(pathname);

  // 화면이 하나뿐인 모듈(홈)에서는 아무것도 그리지 않는다. 항목 하나짜리 목록은 고를 것이
  // 없어서 길잡이 노릇을 못 하고, 상단 바가 이미 "지금 홈에 있다"를 말하고 있다.
  // 그 208px은 대시보드가 쓰는 편이 낫다.
  if (current.items.length <= 1) return null;

  const isActive = (href: string) => item?.href === href;

  return (
    <>
      {/* 모바일 — 상단 모듈 바 바로 아래 붙는 가로 줄 */}
      <nav
        aria-label={`${current.label} 메뉴`}
        className={cn(
          "sticky z-30 overflow-x-auto border-b border-line bg-white px-5 md:hidden",
          ADMIN_TOP_BAR.stickyTop,
        )}
      >
        <ul className="flex min-w-max items-center gap-1 py-2">
          {current.items.map((navItem) => {
            const active = isActive(navItem.href);
            const Icon = NavIcon[navItem.icon];
            return (
              <li key={navItem.href}>
                <Link
                  href={navItem.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-[13px] tracking-tight transition-colors",
                    active
                      ? "bg-brand-50 font-semibold text-brand-700"
                      : "font-medium text-ink-soft hover:bg-soft",
                  )}
                >
                  <Icon
                    className={cn("shrink-0", active ? "text-brand-600" : "text-muted")}
                  />
                  {navItem.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 데스크톱 — 세로 사이드바. 상단 바 높이만큼 내려 붙는다. */}
      <aside
        className={cn(
          "sticky hidden w-52 shrink-0 flex-col overflow-y-auto border-r border-line bg-white md:flex",
          ADMIN_TOP_BAR.stickyTop,
          ADMIN_TOP_BAR.belowHeight,
        )}
      >
        <nav aria-label={`${current.label} 메뉴`} className="px-3 py-4">
          <p className="px-2.5 pb-2 text-[11px] font-semibold tracking-wide text-muted">
            {current.label}
          </p>
          <ul className="flex flex-col gap-px">
            {current.items.map((navItem) => {
              const active = isActive(navItem.href);
              const Icon = NavIcon[navItem.icon];
              return (
                <li key={navItem.href}>
                  <Link
                    href={navItem.href}
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
                      className={cn("shrink-0", active ? "text-brand-600" : "text-muted")}
                    />
                    {navItem.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </>
  );
}
