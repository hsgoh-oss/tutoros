import Link from "next/link";
import Image from "next/image";
import type { SiteSettings } from "@/lib/types";

export function SiteFooter({ settings }: { settings: SiteSettings }) {
  return (
    <footer className="bg-ink pb-28 pt-16 text-white md:pb-16">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-8">
        <div className="flex flex-col justify-between gap-10 md:flex-row">
          <div>
            <Link href="/" className="flex min-h-11 items-center gap-3" aria-label="홈으로">
              <Image
                src="/img/logo/symbol-white.png"
                alt=""
                width={40}
                height={40}
                className="h-10 w-10"
              />
              <span className="text-lg font-black tracking-tight">
                {settings.brandName}
              </span>
            </Link>
            <p className="mt-5 text-sm leading-relaxed text-white/60">
              {settings.bizName} · 대표 {settings.ceoName} · 사업자등록번호{" "}
              {settings.bizNo}
              <br />
              <a
                href={`mailto:${settings.email}`}
                className="inline-flex min-h-11 items-center underline-offset-2 hover:underline"
              >
                {settings.email}
              </a>{" "}
              | {settings.address}
              {settings.tutorReportNo && (
                <>
                  <br />
                  개인과외교습자 신고번호 {settings.tutorReportNo}
                </>
              )}
            </p>
            <p className="mt-4 text-xs text-white/40">
              © 2026 {settings.brandName}. All rights reserved.
            </p>
          </div>

          <div className="flex flex-col items-start gap-6 md:items-end">
            <div className="flex gap-3" aria-label="외부 채널">
              <a
                href={settings.kimProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="김과외 프로필 보기"
              >
                <Image
                  src="/img/footer-kim.png"
                  alt="김과외"
                  width={60}
                  height={60}
                  className="h-14 w-14 rounded-2xl"
                />
              </a>
              <a
                href={settings.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="인스타그램 보기"
              >
                <Image
                  src="/img/footer-insta.png"
                  alt="인스타그램"
                  width={60}
                  height={60}
                  className="h-14 w-14 rounded-2xl"
                />
              </a>
            </div>
            {/* 약관 링크는 모바일에서 자주 눌리는 법정 고지 — 각 링크에 44px 세로 히트영역 */}
            <nav
              aria-label="약관 및 정책"
              className="flex flex-wrap gap-x-5 text-sm font-semibold text-white/70"
            >
              <Link href="/terms" className="inline-flex min-h-11 items-center hover:text-white">
                이용약관
              </Link>
              <Link href="/privacy" className="inline-flex min-h-11 items-center hover:text-white">
                개인정보 처리방침
              </Link>
              <Link
                href="/refund-policy"
                className="inline-flex min-h-11 items-center hover:text-white"
              >
                환불 규정
              </Link>
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
