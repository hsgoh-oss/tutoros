"use client";

import { useState } from "react";
import { requestPortalLink } from "@/lib/actions/portal-link";

// 링크 재발송 폼 — 비로그인 안내(app/p/page.tsx) 안에 붙는다.
//
// 포털에 비밀번호가 없으므로 "로그인 폼"이 아니다: 번호를 넣으면 그 번호로 링크를 보낼 뿐이고,
// 진입은 문자로 받은 링크를 눌러야 일어난다. 그래서 성공해도 화면이 바뀌지 않는다 —
// 안내 문구만 바뀐다.
//
// 응답 문구는 서버가 준 것을 그대로 쓴다. 등록 여부에 따라 화면이 다른 말을 하면 그 차이가
// 곧 조회 결과가 되기 때문에, 분기 문구를 클라이언트에서 만들지 않는다(lib/actions/portal-link.ts).
export function PortalLinkRequestForm() {
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestPortalLink(phone);
      if (result.ok) {
        setNotice(result.message);
        setPhone("");
      } else {
        setError(result.error);
      }
    } catch {
      setError("요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 border-t border-line pt-6 text-left">
      <label
        htmlFor="portal-link-phone"
        className="block text-xs font-bold tracking-tight text-ink-soft"
      >
        링크를 잃어버리셨나요?
      </label>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        등록하신 휴대전화 번호를 넣으시면 접속 링크를 문자로 다시 보내드립니다.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          id="portal-link-phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="010-0000-0000"
          className="min-h-11 min-w-0 flex-1 rounded-panel border border-line bg-white px-3 text-sm text-ink placeholder:text-faint focus:border-brand-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 shrink-0 rounded-panel bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? "보내는 중..." : "링크 받기"}
        </button>
      </div>
      {notice && (
        <p className="mt-3 text-xs leading-relaxed font-bold text-emerald-700">{notice}</p>
      )}
      {error && (
        <p className="mt-3 text-xs leading-relaxed font-bold text-rose-600">{error}</p>
      )}
    </form>
  );
}
