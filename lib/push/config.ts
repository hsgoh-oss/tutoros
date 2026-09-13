// 웹 푸시(VAPID) 설정 — 서버·클라이언트가 같은 공개키를 본다.
//
// 키는 환경변수 셋이다:
//   NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY — 브라우저 구독(applicationServerKey)에 쓰는 공개키. 클라이언트에 노출된다.
//   WEB_PUSH_PRIVATE_KEY            — 서버 서명용 비밀키. 절대 클라이언트로 내려보내지 않는다.
//   WEB_PUSH_SUBJECT                — 푸시 서비스에 알리는 연락처(mailto: 또는 https:). 없으면 사이트 URL.
// 키 생성: `node -e "console.log(require('web-push').generateVAPIDKeys())"` — 한 번 만들면 바꾸지 않는다.
// 바꾸면 기존 구독이 전부 무효가 된다(푸시 서비스가 서명 불일치로 거부).

export function pushPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY || null;
}

/** 서버가 발송할 수 있는 상태인지 — 공개키·비밀키가 모두 있어야 한다. */
export function isPushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY);
}

export function pushSubject(): string {
  return (
    process.env.WEB_PUSH_SUBJECT ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://axiommathlab.kr"
  );
}
