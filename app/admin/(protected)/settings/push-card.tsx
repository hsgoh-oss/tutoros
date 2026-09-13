import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/admin/crm/action-button";
import { PushToggle } from "@/components/push/push-toggle";
import { formatKDateTime } from "@/lib/data/crm";
import { pushPublicKey } from "@/lib/push/config";
import { describeUserAgent, listPushSubscriptions } from "@/lib/push/subscriptions";
import {
  isAdminPushSubscribed,
  removeAdminPushDevice,
  removeAdminPushSubscription,
  saveAdminPushSubscription,
  sendAdminTestPush,
} from "./actions";

// 운영자 설정의 「브라우저 푸시 알림」 카드(00026).
// 새 상담·신청서·후기 제출·과제 제출·학생 질문이 들어오면 켜 둔 기기에 바로 뜬다.
// 알림톡·문자를 대체하지 않는다 — 운영자에게 가는 문자(consult_admin_alert)는 그대로 나간다.

export async function AdminPushCard({
  tenantId,
  email,
}: {
  tenantId: string;
  email: string;
}) {
  const devices = await listPushSubscriptions(tenantId, { audience: "admin", adminEmail: email });

  return (
    <Card className="mt-8 max-w-3xl">
      <h2 className="text-lg font-semibold tracking-tight">브라우저 푸시 알림</h2>
      <p className="mt-1 mb-5 text-sm text-muted">
        새 상담 신청·신청서 제출·후기·사례 제출·과제 제출·학생 질문이 들어오면 켜 둔 기기에 바로
        알립니다. 기기마다 따로 켜야 하고, 문자 알림을 대체하지는 않습니다.
      </p>
      <PushToggle
        publicKey={pushPublicKey()}
        save={saveAdminPushSubscription}
        remove={removeAdminPushSubscription}
        check={isAdminPushSubscribed}
        sendTest={sendAdminTestPush}
        description="켜면 브라우저가 알림 권한을 묻습니다. 휴대폰은 홈 화면에 추가한 앱에서 켜는 것이 가장 안정적입니다."
      />

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="mb-3 text-xs font-semibold text-ink-soft">
          알림을 받는 기기 ({devices.filter((d) => !d.disabledAt).length})
        </h3>
        {devices.length === 0 ? (
          <p className="text-sm text-muted">아직 켜 둔 기기가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-0 last:pb-0"
              >
                <span className="text-sm">
                  <span className="font-bold text-ink">{describeUserAgent(d.userAgent)}</span>
                  <span className="ml-2 text-xs text-muted">
                    켬 {formatKDateTime(d.createdAt)}
                  </span>
                  {d.disabledAt && (
                    <Badge tone="warning" className="ml-2">
                      전달 불가
                    </Badge>
                  )}
                </span>
                <ActionButton
                  action={removeAdminPushDevice}
                  id={d.id}
                  label="해제"
                  tone="danger"
                  confirmText="이 기기의 알림 구독을 해제할까요? 그 기기에서 다시 켤 수 있습니다."
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
