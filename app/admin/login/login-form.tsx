"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { requestLoginOtp, verifyLoginOtp } from "./actions";

const RESEND_INTERVAL_S = 60;

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
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
    const result = await requestLoginOtp(email);
    setPending(false);
    if (result.ok) {
      setStep("code");
      setDevCode(result.devCode ?? null);
      setResendLeft(RESEND_INTERVAL_S);
    } else {
      setError(result.error ?? "인증번호 발급에 실패했습니다.");
    }
  }

  async function verify() {
    setPending(true);
    setError(null);
    const result = await verifyLoginOtp(email, code);
    setPending(false);
    if (result.ok) {
      router.push(next);
      router.refresh();
    } else {
      setError(result.error ?? "인증에 실패했습니다.");
    }
  }

  if (step === "email") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendOtp();
        }}
        className="space-y-5"
      >
        <Field label="관리자 이메일" required>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
          />
        </Field>
        {error && <p className="text-sm font-bold text-rose-600">{error}</p>}
        <button
          type="submit"
          disabled={pending || !email.trim()}
          className={buttonClass("primary", "md", "w-full")}
        >
          {pending ? "발송 중..." : "인증번호 받기"}
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
      className="space-y-5"
    >
      <p className="text-sm leading-relaxed text-muted">
        <span className="font-bold text-ink">{email}</span> 로 발송된 6자리
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
          autoFocus
        />
      </Field>
      {error && <p className="text-sm font-bold text-rose-600">{error}</p>}
      <button
        type="submit"
        disabled={pending || code.length !== 6}
        className={buttonClass("primary", "md", "w-full")}
      >
        {pending ? "확인 중..." : "로그인"}
      </button>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => {
            setStep("email");
            setCode("");
            setError(null);
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
  );
}
