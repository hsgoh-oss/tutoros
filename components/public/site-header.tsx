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
  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("a,button")?.focus();
    document.body.classList.add("axm-menu-open");

    const desktop = window.matchMedia("(min-width: 768px)");
    const onViewportChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        window.requestAnimationFrame(() => toggleRef.current?.focus());
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
      document.body.classList.remove("axm-menu-open");
    };
  }, [open]);

  return (
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

      <div
        ref={panelRef}
        id="site-menu"
        className="border-t border-line bg-white md:hidden"
        hidden={!open}
      >
        <nav className="axm-measure py-4" aria-label="전체 메뉴">
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
    </header>
  );
}
