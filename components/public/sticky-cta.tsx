import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

// 하단 고정 버튼 — 모바일 전용 바(상담+카카오), 데스크톱은 우하단 플로팅.

export function StickyCta({ kakaoUrl }: { kakaoUrl: string }) {
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-70 flex gap-2.5 border-t border-line bg-white/95 px-4 py-3 backdrop-blur-md md:hidden">
        <a
          href={kakaoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass("ghost", "md", "flex-1")}
        >
          카카오톡 문의
        </a>
        <Link href="/consult" className={buttonClass("primary", "md", "flex-1")}>
          상담 신청
        </Link>
      </div>

      <div className="fixed right-8 bottom-8 z-70 hidden flex-col gap-3 md:flex">
        <a
          href={kakaoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass("white", "md")}
        >
          카카오톡 문의
        </a>
        <Link href="/consult" className={buttonClass("primary", "md")}>
          상담 신청
        </Link>
      </div>
    </>
  );
}
