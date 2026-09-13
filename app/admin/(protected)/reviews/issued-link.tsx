"use client";

import { useState } from "react";

/**
 * 방금 발급된 작성 링크 — 이 화면을 벗어나면 다시 볼 수 없다(review_invitations에는 해시만 남는다).
 * 다시 필요하면 재발급(링크 회전)뿐이고, 그때 이전 링크는 무효가 된다.
 * (상담 신청폼 카드의 IssuedLink와 같은 패턴 — 모듈이 달라 별도 파일로 둔다.)
 */
export function IssuedReviewLink({ link, warnings }: { link: string; warnings?: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-panel border border-brand-100 bg-brand-50 p-3">
      <p className="text-xs font-bold text-brand-700">
        작성 링크가 발급되었습니다. 새로고침하면 다시 볼 수 없으니 지금 복사해 두세요.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-panel border border-line bg-white px-3 py-2 text-xs text-ink-soft"
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // 클립보드 접근 불가 — 직접 선택·복사할 수 있으므로 조용히 무시한다.
            }
          }}
          className="min-h-11 shrink-0 rounded-panel bg-brand-600 px-3 text-xs font-bold text-white hover:bg-brand-700"
        >
          {copied ? "복사됨" : "링크 복사"}
        </button>
      </div>
      {warnings && warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {warnings.map((w) => (
            <li key={w} className="text-xs font-bold text-amber-700">
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
