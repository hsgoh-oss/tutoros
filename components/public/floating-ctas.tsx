"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 상시 CTA — 모바일 하단 고정 바 하나(상담 신청).
 *
 * 카카오톡 플로팅 버튼은 없앴다(2026-09): 데스크톱 우하단 원형 버튼과 모바일 바의 카카오 아이콘 모두.
 * 카카오톡 채널은 푸터 「문의」에 글자 링크로 있고, 모바일 메뉴에도 버튼이 남는다 —
 * 화면 위에 떠 있는 것은 주 행동(상담 신청) 하나면 된다.
 *
 * 데스크톱은 헤더가 이미 그 행동을 들고 있으므로 아무것도 띄우지 않는다.
 * 상담 신청·작성 링크 자체가 목적인 화면(/apply·/status·/f·/w)에서는 바를 숨긴다.
 */
const SUPPRESSED_PREFIXES = ["/apply", "/status", "/f", "/w"] as const;

export function FloatingCtas() {
  const pathname = usePathname();
  const suppressed = SUPPRESSED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  return (
    <div
      hidden={suppressed}
      className="fixed inset-x-0 bottom-0 z-70 border-t border-line bg-white px-[var(--gutter)] py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] print:hidden md:hidden"
    >
      <Link
        href="/apply"
        className="flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-brand-600 bg-brand-600 text-[15px] font-extrabold tracking-[-0.025em] text-white"
      >
        상담 신청하기
      </Link>
    </div>
  );
}
