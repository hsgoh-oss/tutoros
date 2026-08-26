"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 상시 CTA.
 *
 * 모바일은 하단 고정 바 하나(상담 신청 + 카카오), 데스크톱은 우하단 카카오 원형 버튼 하나다.
 * 데스크톱에서 상담 신청을 띄우지 않는 이유는 헤더가 이미 그 행동을 들고 있기 때문이다 —
 * 같은 화면에 같은 이름의 주 행동을 두 번 두지 않는다.
 *
 * 상담 신청 자체가 목적인 화면에서는 전부 숨긴다.
 */
const SUPPRESSED_PREFIXES = ["/apply", "/status", "/f"] as const;

function KakaoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="h-6 w-6">
      <path
        d="M12 3.9c-4.9 0-8.9 3.2-8.9 7.1 0 2.5 1.7 4.7 4.2 6l-1 3.6c-.1.3.3.6.6.4l4.2-2.8c.3 0 .6.1.9.1 4.9 0 8.9-3.2 8.9-7.1S16.9 3.9 12 3.9Z"
        fill="currentColor"
      />
      <circle cx="8.8" cy="11.2" r="0.8" fill="#FEE500" />
      <circle cx="12" cy="11.2" r="0.8" fill="#FEE500" />
      <circle cx="15.2" cy="11.2" r="0.8" fill="#FEE500" />
    </svg>
  );
}

export function FloatingCtas({ kakaoUrl }: { kakaoUrl: string }) {
  const pathname = usePathname();
  const suppressed = SUPPRESSED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  return (
    <>
      {/* 모바일 상시 전환 경로 — 화면당 주 행동은 하나뿐이다.
          상담 신청이 목적인 화면에서는 이 바만 숨긴다. 카카오 문의는 폼을 쓰다 막혔을 때의
          유일한 탈출구라 어디서든 남는다. */}
      <div hidden={suppressed} className="fixed inset-x-0 bottom-0 z-70 flex gap-2 border-t border-line bg-white px-[var(--gutter)] py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] print:hidden md:hidden">
        <Link
          href="/apply"
          className="flex min-h-11 flex-1 items-center justify-center rounded-[var(--radius-control)] border border-brand-600 bg-brand-600 text-[15px] font-extrabold tracking-[-0.025em] text-white"
        >
          상담 신청하기
        </Link>
        <a
          href={kakaoUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="카카오톡으로 문의하기 (새 창)"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)] border border-kakao bg-kakao text-kakao-ink"
        >
          <KakaoIcon />
        </a>
      </div>

      <a
        href={kakaoUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="카카오톡으로 문의하기 (새 창)"
        title="카카오톡 문의하기"
        className="fixed right-[max(16px,env(safe-area-inset-right))] bottom-[max(18px,env(safe-area-inset-bottom))] z-70 hidden h-11 w-11 place-items-center rounded-full border border-kakao bg-kakao text-kakao-ink print:hidden md:grid"
      >
        <KakaoIcon />
      </a>
    </>
  );
}
