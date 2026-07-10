"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";

const NAV = [
  { href: "/tutor", label: "튜터 소개" },
  { href: "/classes", label: "수업 안내" },
  { href: "/reviews", label: "수강 후기" },
  { href: "/faq", label: "FAQ" },
] as const;

export function SiteHeader({ kakaoUrl }: { kakaoUrl: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-60 border-b border-line/85 bg-white/88 backdrop-blur-lg backdrop-saturate-150">
      <div className="mx-auto flex h-[74px] w-full max-w-7xl items-center justify-between gap-6 px-6 md:px-8">
        {/* 로고 이미지 높이는 31px이라 세로 패딩으로 44px 히트영역을 만든다(모바일 탭타깃).
            flex 컨테이너로 만들면 next/image가 종횡비 수정으로 오인해 경고를 낸다 — block+py로 처리. */}
        <Link
          href="/"
          aria-label="AXIOM MATH LAB 홈으로"
          onClick={() => setOpen(false)}
          className="block py-2"
        >
          <Image
            src="/img/logo/header-axiom.png"
            alt="AXIOM MATH LAB"
            width={190}
            height={40}
            priority
            className="h-auto w-40 md:w-[190px]"
          />
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="주요 메뉴">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                // min-w-11: 짧은 라벨(FAQ)도 44px 탭타깃 확보 — 태블릿(768)도 터치 기기다
                "relative inline-flex min-w-11 justify-center py-6 text-[15px] font-extrabold tracking-tight text-ink transition-colors hover:text-brand-600",
                pathname === item.href &&
                  "text-brand-600 after:absolute after:inset-x-0 after:bottom-4 after:h-0.5 after:rounded-full after:bg-brand-600",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <a
            href={kakaoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass("ghost", "sm")}
          >
            카카오톡 문의
          </a>
          <Link href="/consult" className={buttonClass("primary", "sm")}>
            상담 신청
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex min-h-12 items-center rounded-panel bg-soft px-4 text-sm font-extrabold md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "닫기" : "메뉴"}
        </button>
      </div>

      {open && (
        <nav
          id="mobile-menu"
          aria-label="모바일 메뉴"
          className="border-t border-line bg-white px-6 py-4 md:hidden"
        >
          <ul className="flex flex-col">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "block border-b border-line py-4 text-base font-extrabold",
                    pathname === item.href && "text-brand-600",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex gap-3 py-4">
            <a
              href={kakaoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("ghost", "md", "flex-1")}
            >
              카카오톡
            </a>
            <Link
              href="/consult"
              onClick={() => setOpen(false)}
              className={buttonClass("primary", "md", "flex-1")}
            >
              상담 신청
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
