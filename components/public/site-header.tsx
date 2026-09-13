"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";

/** 주 경로 — 설득에 직접 기여하는 화면만 1등급에 둔다. */
const PRIMARY_NAV = [
  { href: "/classes", label: "수업 안내" },
  { href: "/tutor", label: "튜터 소개" },
  { href: "/p", label: "포털" },
] as const;

/**
 * 근거 경로 — 신뢰에는 기여하지만 직접 전환 경로는 아니다.
 * 데스크톱 헤더에서는 빼고 본문(홈 04 EVIDENCE)·푸터에서 진입한다.
 * 모바일 메뉴에서만 "참고 자료"로 묶어 노출한다.
 */
const SECONDARY_NAV = [
  { href: "/case", label: "성적 향상 사례" },
  { href: "/reviews", label: "후기" },
  { href: "/faq", label: "자주 묻는 질문" },
] as const;

const CTA = { href: "/apply", label: "상담 신청" } as const;

function isCurrentPath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader({ kakaoUrl }: { kakaoUrl: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 열린 동안: 첫 항목으로 포커스 이동, 배경 스크롤 잠금, Esc 닫기, Tab 순환 가둠,
  // 데스크톱 폭으로 넓어지면 자동 닫기(패널이 남아 본문을 가리는 것을 막는다).
  //
  // 스크롤 잠금은 html에 건다(globals.css .axm-menu-open). 예전엔 body overflow:hidden뿐이라
  // iOS Safari에서 메뉴를 열고 손가락을 움직이면 뒤 본문이 같이 스크롤됐다. 패널은 아래에서
  // 고정 오버레이 스크롤 컨테이너로 두어 손가락 움직임이 패널 밖으로 새지 않게 한다.
  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    document.documentElement.classList.add("axm-menu-open");
    // preventScroll: 고정 패널 안의 링크에 포커스를 주면 Chrome이 문서를 그 링크의 흐름상 위치로
    // 스크롤해 버린다(메뉴를 열었을 뿐인데 본문이 위로 튄다). 패널은 이미 화면 안에 있다.
    panel?.querySelector<HTMLElement>("a,button")?.focus({ preventScroll: true });

    const desktop = window.matchMedia("(min-width: 768px)");
    const onViewportChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        window.requestAnimationFrame(() =>
          toggleRef.current?.focus({ preventScroll: true }),
        );
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>("a[href],button:not([disabled])"),
      ).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onViewportChange);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onViewportChange);
      document.documentElement.classList.remove("axm-menu-open");
    };
  }, [open]);

  return (
    <>
    <header className="sticky top-0 z-60 border-b border-line bg-white/96 backdrop-blur-lg">
      <div className="axm-measure flex h-[72px] items-center justify-between gap-6">
        {/* block+py로 44px 히트영역 — flex로 감싸면 next/image가 종횡비 경고를 낸다. */}
        <Link
          href="/"
          aria-label="AXIOM MATH LAB 메인으로 이동"
          onClick={() => setOpen(false)}
          className="block py-2"
        >
          <Image
            src="/img/logo/header-axiom.png"
            alt="AXIOM MATH LAB"
            width={190}
            height={40}
            priority
            className="h-auto w-36 md:w-[178px]"
          />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="주요 메뉴">
          {PRIMARY_NAV.map((item) => {
            const current = isCurrentPath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center text-[15px] font-extrabold tracking-[-0.025em] transition-colors",
                  current ? "text-brand-600" : "text-ink-soft hover:text-brand-600",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <Link href={CTA.href} className={buttonClass("primary", "sm")}>
            {CTA.label}
          </Link>
        </nav>

        <button
          ref={toggleRef}
          type="button"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong px-4 text-sm font-extrabold text-ink-soft md:hidden"
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "닫기" : "메뉴"}
        </button>
      </div>
    </header>

      {/* 고정 오버레이 — 헤더(72px) 아래 화면 전체를 덮는 스크롤 컨테이너. header 밖에 두는 이유:
          header의 backdrop-filter가 fixed 자손의 기준 상자(containing block)가 되어 위치가 깨진다.
          overscroll-contain으로 끝에 닿아도 본문으로 스크롤이 이어지지 않고,
          안쪽 min-h를 화면보다 1px 크게 두어 항목이 적어도 항상 "패널이 스크롤되는" 상태를 유지한다
          (스크롤할 게 없으면 iOS가 제스처를 본문에 넘긴다). */}
      <div
        ref={panelRef}
        id="site-menu"
        className="fixed inset-x-0 top-[72px] bottom-0 z-60 overflow-y-auto overscroll-contain border-t border-line bg-white [touch-action:pan-y] md:hidden"
        hidden={!open}
      >
        <nav
          className="axm-measure min-h-[calc(100%+1px)] py-4 pb-[calc(2rem+env(safe-area-inset-bottom))]"
          aria-label="전체 메뉴"
        >
          <ul>
            {PRIMARY_NAV.map((item) => {
              const current = isCurrentPath(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "block border-b border-line py-4 text-base font-extrabold tracking-[-0.025em]",
                      current ? "text-brand-600" : "text-ink",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <p className="axm-label mt-6">참고 자료</p>
          <ul>
            {SECONDARY_NAV.map((item) => {
              const current = isCurrentPath(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "block border-b border-line py-3.5 text-[15px] font-bold tracking-[-0.02em]",
                      current ? "text-brand-600" : "text-muted",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 flex flex-col gap-2.5">
            <Link
              href={CTA.href}
              onClick={() => setOpen(false)}
              className={buttonClass("primary", "md")}
            >
              {CTA.label}하기
            </Link>
            <a
              href={kakaoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("outline", "md")}
            >
              카카오톡 문의
            </a>
          </div>
        </nav>
      </div>
    </>
  );
}
