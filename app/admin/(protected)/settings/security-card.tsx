"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { replaceOperator, requestOperatorOtp, revokeAllMySessions } from "./actions";

const RESEND_INTERVAL_S = 60; // issueOtp의 60초 재발송 제한과 동일

// 관리자 보안 카드 — ① 전 세션 로그아웃 ② 운영자 이메일 교체(새 이메일 OTP 검증).
// 두 동작 모두 성공 시 현재 세션이 회수되므로 로그인 화면으로 보낸다(reauth).
export function SecurityCard({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();

  /* ---------- 전 세션 로그아웃 ---------- */
  const [revokePending, setRevokePending] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  async function revokeAll() {
    if (!window.confirm("모든 기기에서 로그아웃됩니다(현재 세션 포함). 계속할까요?")) {
      return;
    }
    setRevokePending(true);
    setRevokeError(null);
    const result = await revokeAllMySessions();
    if (result.ok && result.reauth) {
      router.push("/admin/login");
      router.refresh();
      return;
    }
    setRevokePending(false);
    setRevokeError(result.error ?? "전 세션 로그아웃에 실패했습니다.");
  }

  /* ---------- 운영자 이메일 교체 ---------- */
  const [step, setStep] = useState<"email" | "code">("email");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendLeft, setResendLeft] = useState(0);

  useEffect(() => {
    if (resendLeft <= 0) return;
    const timer = setInterval(() => setResendLeft((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [resendLeft]);

  async function sendOtp() {
    setPending(true);
    setError(null);
    const result = await requestOperatorOtp(newEmail);
    setPending(false);
    if (result.ok) {
      setStep("code");
      setDevCode(result.devCode ?? null);
      setResendLeft(RESEND_INTERVAL_S);
    } else {
      setError(result.error ?? "인증번호 발급에 실패했습니다.");
    }
  }

  async function replace() {
    setPending(true);
    setError(null);
    const result = await replaceOperator(newEmail, code);
    if (result.ok && result.reauth) {
      // 교체 완료 — 현 세션은 회수됐다. 새 이메일로 재로그인.
      router.push("/admin/login");
      router.refresh();
      return;
    }
    setPending(false);
    setError(result.error ?? "운영자 교체에 실패했습니다.");
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-[15px] font-black text-ink">전 세션 로그아웃</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          기기 분실·세션 탈취가 의심되면 모든 기기의 로그인을 즉시 무효화합니다.
          현재 세션도 함께 종료되어 다시 로그인해야 합니다.
        </p>
        {revokeError && (
          <p className="mt-3 text-sm font-bold text-rose-600">{revokeError}</p>
        )}
        <button
          type="button"
          disabled={revokePending}
          onClick={() => void revokeAll()}
          className={buttonClass("outline", "md", "mt-4")}
        >
          {revokePending ? "회수 중..." : "모든 기기에서 로그아웃"}
        </button>
      </div>

      <div className="border-t border-line pt-8">
        <h3 className="text-[15px] font-black text-ink">운영자 이메일 교체</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          현재 운영자 <span className="font-bold text-ink">{currentEmail}</span> 를 새
          이메일로 교체합니다. 새 이메일로 발송된 인증번호를 확인하면 즉시 교체되며,
          기존 이메일의 모든 세션이 종료됩니다(새 이메일로 재로그인 필요).
        </p>

        {step === "email" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendOtp();
            }}
            className="mt-4 max-w-md space-y-5"
          >
            <Field label="새 운영자 이메일" required>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="new-operator@example.com"
                autoComplete="email"
              />
            </Field>
            {error && <p className="text-sm font-bold text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={pending || !newEmail.trim()}
              className={buttonClass("primary", "md")}
            >
              {pending ? "발송 중..." : "인증번호 발송"}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void replace();
            }}
            className="mt-4 max-w-md space-y-5"
          >
            <p className="text-sm leading-relaxed text-muted">
              <span className="font-bold text-ink">{newEmail}</span> 로 발송된 6자리
              인증번호를 입력해 주세요. (유효 시간 10분)
            </p>
            {devCode && (
              <p className="rounded-panel border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
                개발 모드 인증번호: {devCode}
              </p>
            )}
            <Field label="인증번호" required>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="000000"
                autoComplete="one-time-code"
              />
            </Field>
            {error && <p className="text-sm font-bold text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={pending || code.length !== 6}
              className={buttonClass("primary", "md")}
            >
              {pending ? "교체 중..." : "운영자 교체"}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                  setDevCode(null);
                }}
                className="flex min-h-11 items-center font-bold text-muted hover:text-ink"
              >
                이메일 다시 입력
              </button>
              <button
                type="button"
                disabled={pending || resendLeft > 0}
                onClick={() => void sendOtp()}
                className="flex min-h-11 items-center font-bold text-brand-700 hover:underline disabled:text-muted disabled:no-underline"
              >
                {resendLeft > 0 ? `재발송 (${resendLeft}초)` : "인증번호 재발송"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
