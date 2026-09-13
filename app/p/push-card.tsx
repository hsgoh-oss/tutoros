import { PushToggle } from "@/components/push/push-toggle";
import { pushPublicKey } from "@/lib/push/config";
import {
  isPortalPushSubscribed,
  removePortalPushSubscription,
  savePortalPushSubscription,
} from "./actions";

// 포털 홈의 「기기 알림」 카드(00026) — 이용약관 제12조 "포털 가입 뒤 일정·과제·리포트·결제 상태는
// PWA Push로 최소한 알릴 수 있다". 켜는 것은 사용자 행동이고 기본은 꺼짐이다(처리방침 10절).
// 알림톡·문자로 가는 안내와 같은 내용이 기기에도 뜬다. 어느 한쪽의 실패가 다른 쪽을 대신하지 않는다.

export function PortalPushCard() {
  return (
    <section
      aria-labelledby="portal-push-title"
      className="mb-6 rounded-card border border-line bg-white p-5"
    >
      <h2 id="portal-push-title" className="m-0 text-sm font-extrabold tracking-tight text-ink">
        기기 알림
      </h2>
      <p className="mt-1 mb-3 text-xs leading-relaxed text-muted">
        수업 일정·리포트·과제·결제 안내를 이 기기에서도 받습니다. 문자 안내는 그대로 오고, 언제든
        끌 수 있습니다.
      </p>
      <PushToggle
        publicKey={pushPublicKey()}
        save={savePortalPushSubscription}
        remove={removePortalPushSubscription}
        check={isPortalPushSubscribed}
        compact
      />
    </section>
  );
}
