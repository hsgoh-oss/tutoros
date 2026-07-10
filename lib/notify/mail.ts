// 트랜잭션 메일 — Resend API. 로그인 OTP 발송 전용(W4). 서버 전용 — 키는 클라이언트 노출 금지.
// RESEND_API_KEY + MAIL_FROM 환경변수 필요. 미설정 시 호출부(lib/auth/session.ts)가 폴백한다.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export interface MailResult {
  ok: boolean;
  error?: string;
}

export async function sendOtpMail(email: string, code: string): Promise<MailResult> {
  if (!isMailConfigured()) {
    return { ok: false, error: "메일 서비스가 설정되지 않았습니다." };
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: email,
        subject: "[TUTOR OS] 로그인 인증번호",
        html: `<p>인증번호는 <strong>${code}</strong> 입니다.</p><p>10분 이내에 입력해 주세요.</p>`,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      console.error("[mail] send failed", res.status, body);
      return { ok: false, error: "인증 메일 발송에 실패했습니다." };
    }
    return { ok: true };
  } catch (err) {
    console.error("[mail] send error", err);
    return { ok: false, error: "메일 서비스 호출 중 오류가 발생했습니다." };
  }
}
