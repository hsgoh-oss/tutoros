import Link from "next/link";
import Image from "next/image";
import type { SiteSettings } from "@/lib/types";

// 정본(axiom-platform)의 푸터 — 법정 고지를 한 줄씩 끊어 읽히게 두고, 채널과 약관을 반대편에 세운다.
// 값이 없는 고지 행은 아예 그리지 않는다: 비어 있는 "신고번호:" 는 없는 것보다 나쁘다.

/** 공정거래위원회 사업자정보 조회 — 사업자등록번호(하이픈 제거)로 질의한다. */
function ftcLookupUrl(bizNo: string) {
  const digits = bizNo.replace(/\D/g, "");
  return `https://www.ftc.go.kr/www/selectBizCommList.do?key=254&searchCnd=BRNO&searchKrwd=${digits}`;
}

export function SiteFooter({ settings }: { settings: SiteSettings }) {
  return (
    // 모바일 하단 고정 CTA 바가 마지막 줄을 가리지 않도록 아래쪽에 여유를 준다.
    <footer className="bg-ink pt-14 pb-[calc(6rem+env(safe-area-inset-bottom))] text-white md:pb-14">
      <div className="axm-measure flex flex-col justify-between gap-10 md:flex-row md:gap-16">
        <div className="flex flex-col gap-5">
          <Link
            href="/"
            className="flex min-h-11 items-center gap-3"
            aria-label={`${settings.brandName} 메인으로 이동`}
          >
            <Image
              src="/img/logo/symbol-white.png"
              alt=""
              aria-hidden="true"
              width={40}
              height={40}
              className="h-9 w-9"
            />
            <span className="text-lg font-extrabold tracking-[-0.03em]">
              {settings.brandName}
            </span>
          </Link>

          <div className="space-y-1 text-[13.5px] leading-[1.9] text-white/72">
            <p>
              {settings.bizName} <span aria-hidden="true">|</span> 대표자:{" "}
              {settings.ceoName} <span aria-hidden="true">|</span> 사업자등록번호:{" "}
              {settings.bizNo}
            </p>
            {settings.commerceNo && (
              <p>
                통신판매업신고: {settings.commerceNo}{" "}
                <a
                  href={ftcLookupUrl(settings.bizNo)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-white"
                >
                  사업자정보확인
                </a>
              </p>
            )}
            {settings.tutorReportNo && (
              <p>개인과외교습자 신고번호: {settings.tutorReportNo}</p>
            )}
            <p>주소: {settings.address}</p>
            <p>
              {settings.phone && (
                <>
                  전화번호:{" "}
                  <a
                    href={`tel:${settings.phone.replace(/\D/g, "")}`}
                    className="inline-flex min-h-11 items-center hover:text-white"
                  >
                    {settings.phone}
                  </a>{" "}
                  <span aria-hidden="true">|</span>{" "}
                </>
              )}
              이메일:{" "}
              <a
                href={`mailto:${settings.email}`}
                className="inline-flex min-h-11 items-center hover:text-white"
              >
                {settings.email}
              </a>
            </p>
          </div>

          <p className="text-xs text-white/45">
            © 2026 {settings.brandName}. All rights reserved.
          </p>
        </div>

        <div className="flex flex-col items-start gap-6 md:items-end">
          <div className="flex gap-3" aria-label="외부 채널 바로가기">
            <a
              href={settings.kimProfileUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="김과외 프로필 보기"
              title="김과외 프로필 보기"
            >
              <Image
                src="/img/footer-kim.png"
                alt=""
                aria-hidden="true"
                width={60}
                height={60}
                className="h-11 w-11 rounded-[var(--radius-panel)]"
              />
            </a>
            <a
              href={settings.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="인스타그램 보기"
              title="인스타그램 보기"
            >
              <Image
                src="/img/footer-insta.png"
                alt=""
                aria-hidden="true"
                width={60}
                height={60}
                className="h-11 w-11 rounded-[var(--radius-panel)]"
              />
            </a>
          </div>

          {/* 법정 고지 링크 — 모바일에서 자주 눌리므로 각 링크에 44px 세로 히트영역을 준다. */}
          <nav
            aria-label="약관 및 정책"
            className="flex flex-wrap gap-x-5 text-[13.5px] font-bold text-white/72"
          >
            <Link
              href="/terms"
              className="inline-flex min-h-11 items-center hover:text-white"
            >
              이용약관
            </Link>
            <Link
              href="/lesson-policy"
              className="inline-flex min-h-11 items-center hover:text-white"
            >
              수업 운영 정책
            </Link>
            <Link
              href="/privacy"
              className="inline-flex min-h-11 items-center hover:text-white"
            >
              개인정보 처리방침
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
