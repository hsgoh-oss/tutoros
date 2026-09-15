import Link from "next/link";
import Image from "next/image";
import type { SiteSettings } from "@/lib/types";

// 공개 사이트 푸터.
//
// 세 단으로 선다: 브랜드(로고·슬로건·법정 고지) · 문의(외부 채널을 아이콘이 아니라 글자로) · 약관·정책.
// 아이콘을 글자로 바꾼 이유: 김과외·인스타그램 로고는 그 서비스를 아는 사람에게만 뜻이 통하고,
// 카카오톡 채널은 아예 아이콘이 없었다. "문의" 아래 세 줄의 이름은 누구에게나 같은 뜻이다.
// 값이 없는 고지 행은 아예 그리지 않는다: 비어 있는 "신고번호:" 는 없는 것보다 나쁘다.
//
// 어두운 바탕용 흰 워드마크 원본을 비율 그대로 표시한다.

/** 공정거래위원회 사업자정보 조회 — 사업자등록번호(하이픈 제거)로 질의한다. */
function ftcLookupUrl(bizNo: string) {
  const digits = bizNo.replace(/\D/g, "");
  return `https://www.ftc.go.kr/bizCommPop.do?wrkr_no=${digits}`;
}

const linkClass = "inline-flex min-h-11 items-center text-[14px] font-bold text-white/80 hover:text-white";

export function SiteFooter({ settings }: { settings: SiteSettings }) {
  const contactLinks = [
    { href: settings.kimProfileUrl, label: "김과외 프로필" },
    { href: settings.instagramUrl, label: "인스타그램" },
    { href: settings.kakaoUrl, label: "카카오톡 채널" },
  ].filter((item) => Boolean(item.href));

  return (
    // 모바일 하단 고정 CTA 바가 마지막 줄을 가리지 않도록 아래쪽에 여유를 준다.
    <footer className="bg-ink pt-14 pb-[calc(6rem+env(safe-area-inset-bottom))] text-white md:pb-14">
      <div className="axm-measure grid gap-10 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-12">
        {/* ── 브랜드 · 법정 고지 ─────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          {/* 접근 이름은 로고 alt + 슬로건 텍스트 그대로 — aria-label을 따로 두면 보이는 글자와
              어긋나 "label-content-name-mismatch"가 된다. */}
          <Link href="/" className="inline-flex w-fit max-w-full flex-col gap-2.5 py-1">
            <Image
              src="/img/logo/footer-wordmark-white.png"
              alt={settings.brandName}
              width={4101}
              height={372}
              sizes="(max-width: 767px) 288px, 320px"
              className="h-auto w-72 max-w-full md:w-80"
            />
            <span className="text-[13.5px] font-bold tracking-[-0.02em] text-white/70">
              {settings.tagline}
            </span>
          </Link>

          <div className="space-y-0.5 text-[13.5px] leading-[1.9] text-white/75">
            <p className="m-0">
              상호: {settings.bizName} <span aria-hidden="true">|</span> 대표자:{" "}
              {settings.ceoName} <span aria-hidden="true">|</span> 사업자등록번호:{" "}
              {settings.bizNo}
            </p>
            {settings.commerceNo && (
              <p className="m-0">
                통신판매업 신고번호: {settings.commerceNo}{" "}
                <a
                  href={ftcLookupUrl(settings.bizNo)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-white"
                >
                  사업자정보 확인
                </a>
              </p>
            )}
            {settings.tutorReportNo && (
              <p className="m-0">개인과외교습자 신고번호: {settings.tutorReportNo}</p>
            )}
            <p className="m-0">주소: {settings.address}</p>
            <p className="m-0">
              {settings.phone && (
                <>
                  전화:{" "}
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

          <p className="m-0 text-xs text-white/60">
            © 2026 {settings.brandName}. All rights reserved.
          </p>
        </div>

        {/* ── 문의 — 외부 채널을 글자로 ───────────────────────────── */}
        <nav aria-label="문의" className="flex flex-col">
          <p className="axm-label axm-label-dark m-0 mb-2">문의</p>
          <ul className="m-0 list-none p-0">
            {contactLinks.map((item) => (
              <li key={item.label}>
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClass}
                >
                  {item.label}
                  <span aria-hidden="true" className="ml-1 text-white/40">
                    ↗
                  </span>
                </a>
              </li>
            ))}
            <li>
              <Link href="/apply" className={linkClass}>
                상담 신청
              </Link>
            </li>
          </ul>
        </nav>

        {/* ── 약관·정책 ────────────────────────────────────────────── */}
        <nav aria-label="약관 및 정책" className="flex flex-col">
          <p className="axm-label axm-label-dark m-0 mb-2">약관·정책</p>
          <ul className="m-0 list-none p-0">
            <li>
              <Link href="/terms" className={linkClass}>
                이용약관
              </Link>
            </li>
            <li>
              <Link href="/lesson-policy" className={linkClass}>
                수업 운영 정책
              </Link>
            </li>
            <li>
              <Link href="/privacy" className={linkClass}>
                개인정보 처리방침
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
