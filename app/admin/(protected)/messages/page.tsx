import { AdminPageHeader } from "@/components/admin/page-header";
import { getAdminSession } from "@/lib/auth/session";
import { formatKDateTime, hasDb, listStudents } from "@/lib/data/crm";
import {
  getNotifySummary,
  isNotificationStatus,
  listNotifications,
  type NotificationEntry,
  type NotificationStatus,
} from "@/lib/data/notifications";
import { notifyTypeLabel } from "@/lib/notify/templates";
import { isConfigured } from "@/lib/notify/solapi";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Field, Select, Textarea } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { FilterChips } from "@/components/admin/crm/filter-chips";
import { Toolbar } from "@/components/admin/crm/toolbar";
import { ActionButton } from "@/components/admin/crm/action-button";
import { resendNotification, sendCustomMessage, sendReEnrollmentNotice } from "./actions";

// 발송 상태 표시 — 라벨과 색은 "지금 사람이 손대야 하나"를 기준으로 고른다.
// sending(발송 시도 중)은 성공이 아니라 **결과 불명**이라 경고 톤이다(00013 주석 참조).
const STATUS_LABEL: Record<NotificationStatus, string> = {
  queued: "대기",
  sending: "발송 중",
  sent: "발송됨",
  failed: "실패",
};

const STATUS_TONE: Record<
  NotificationStatus,
  "brand" | "soft" | "success" | "warning" | "danger"
> = {
  queued: "soft",
  sending: "warning",
  sent: "success",
  failed: "danger",
};

const STATUS_FILTERS = (Object.keys(STATUS_LABEL) as NotificationStatus[]).map((v) => ({
  value: v,
  label: STATUS_LABEL[v],
}));

/** 발송 현황 한 칸 — 숫자와 그 숫자가 뜻하는 상태. */
function NotifyStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-panel border border-line px-4 py-3">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/**
 * 본문 미리보기 — 표 한 칸에 들어갈 만큼만.
 * 포털 초대처럼 링크가 곧 로그인 자격인 본문은 발송 성공 시 send.ts가 이미 지우지만,
 * 실패로 남아 있는 건에는 원문이 남아 있다. 그래서 여기서도 링크는 잘라 낸다.
 */
function preview(message: string): string {
  const withoutLink = message.replace(/https?:\/\/\S+/g, "[링크]");
  return withoutLink.length > 60 ? `${withoutLink.slice(0, 60)}…` : withoutLink;
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const status: NotificationStatus | undefined =
    statusParam && isNotificationStatus(statusParam) ? statusParam : undefined;

  const session = await getAdminSession();
  const connected = hasDb();
  const students = session ? await listStudents(session.tenantId) : [];

  const solapiConfigured = isConfigured();
  const [summary, notifications] = session
    ? await Promise.all([
        getNotifySummary(session.tenantId, solapiConfigured),
        listNotifications(session.tenantId, { status }),
      ])
    : [null, [] as NotificationEntry[]];

  const studentOptions = (
    <>
      <option value="">학생 선택</option>
      {students.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </>
  );

  return (
    <div className="dash-page">
      <AdminPageHeader>
        <h1 className="text-xl font-semibold tracking-tight">메시지 발송</h1>
        <p className="mt-1 text-sm text-muted">
          학생·학부모에게 개별 안내를 보내거나 재등록 안내(광고)를 발송합니다. 알림톡 우선,
          실패 시 SMS로 폴백됩니다.
        </p>
      </AdminPageHeader>

      {!connected && <DbBanner />}

      {students.length === 0 ? (
        <EmptyState
          title="등록된 학생이 없습니다"
          description="학생을 등록하면 개별 메시지를 발송할 수 있습니다."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="text-sm font-semibold text-ink-soft">개별 메시지</h2>
            <p className="mt-1 mb-4 text-sm text-muted">
              선택한 학생의 학부모(또는 학생 본인)에게 직접 작성한 안내를 발송합니다.
            </p>
            <SubmitForm action={sendCustomMessage} submitLabel="메시지 발송">
              <div className="space-y-4">
                <Field label="학생">
                  <Select name="studentId" required defaultValue="">
                    {studentOptions}
                  </Select>
                </Field>
                <Field label="수신 대상">
                  <Select name="recipient" defaultValue="parent">
                    <option value="parent">학부모</option>
                    <option value="student">학생 본인</option>
                  </Select>
                </Field>
                <Field label="메시지">
                  <Textarea
                    name="message"
                    required
                    placeholder="보낼 안내 문구를 입력해 주세요."
                  />
                </Field>
              </div>
            </SubmitForm>
          </Card>

          <Card>
            <h2 className="text-sm font-semibold text-ink-soft">재등록 안내 (광고)</h2>
            <p className="mt-1 mb-4 text-sm text-muted">
              <strong className="text-ink-soft">마케팅 수신동의</strong>가 있는 학부모에게만
              발송됩니다. (광고) 표기·야간(21~08시) 발송 금지가 자동 적용됩니다.
            </p>
            <SubmitForm action={sendReEnrollmentNotice} submitLabel="재등록 안내 발송">
              <Field label="학생">
                <Select name="studentId" required defaultValue="">
                  {studentOptions}
                </Select>
              </Field>
            </SubmitForm>
          </Card>
        </div>
      )}

      {/* ── 발송 현황 ─────────────────────────────────────────────
          "안 갔다"와 "아직 안 갔다"를 구분하는 화면. 대시보드 '오늘 업무'는 사람이 손대야
          하는 것만 올리므로(N-02 업무/전달 분리), 정상·대기 건은 여기서만 보인다. */}
      <div className="mt-10">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">발송 현황</h2>
            <p className="mt-1 text-sm text-muted">
              솔라피(알림톡·SMS)로 나간 모든 안내의 상태입니다. 최근 100건까지 표시합니다.
            </p>
          </div>
        </div>

        {!solapiConfigured && (
          <p className="mb-4 rounded-panel border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
            솔라피가 설정되지 않았습니다(API 키·시크릿·발신번호 중 누락). 지금 발생하는 안내는
            발송되지 않고 &lsquo;대기&rsquo;로 쌓입니다 — 설정하면 큐에 쌓인 건부터 이어서 나갑니다.
          </p>
        )}

        {summary && (
          <div className="mb-5 grid gap-3 sm:grid-cols-4">
            <NotifyStat
              label="대기"
              value={`${summary.queued}건`}
              hint={solapiConfigured ? "매시 크론이 재시도" : "솔라피 미설정"}
            />
            <NotifyStat
              label="발송 중"
              value={`${summary.sending}건`}
              hint={summary.sending > 0 ? "결과 불명 — 성공 아님" : "없음"}
            />
            <NotifyStat label="발송됨" value={`${summary.sent}건`} hint="최근 30일" />
            <NotifyStat
              label="실패"
              value={`${summary.failed}건`}
              hint={summary.failed > 0 ? "아래에서 재발송" : "없음"}
            />
          </div>
        )}

        <Toolbar>
          <FilterChips
            basePath="/admin/messages"
            paramKey="status"
            options={STATUS_FILTERS}
            current={status}
          />
        </Toolbar>

        {notifications.length === 0 ? (
          <EmptyState
            title="발송 이력이 없습니다"
            description={
              status
                ? "이 상태의 발송 건이 없습니다. 필터를 '전체'로 바꿔 보세요."
                : "상담 접수·수업 리마인더·리포트 등 안내가 나가면 이곳에 기록됩니다."
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>발생 시각</Th>
                  <Th>종류</Th>
                  <Th>대상</Th>
                  <Th>내용</Th>
                  <Th>채널</Th>
                  <Th>상태</Th>
                  <Th>발송 시각</Th>
                  <Th>관리</Th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((n) => (
                  <tr key={n.id}>
                    <Td>{formatKDateTime(n.createdAt)}</Td>
                    <Td className="font-bold text-ink">
                      {notifyTypeLabel(n.type)}
                      {n.isAd && (
                        <Badge tone="warning" className="ml-2">
                          광고
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      {n.studentName ?? "—"}
                      <span className="block text-xs text-muted">{n.phone}</span>
                    </Td>
                    <Td className="text-xs text-muted">{preview(n.message)}</Td>
                    <Td>{n.channel === "alimtalk" ? "알림톡" : "SMS"}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[n.status]}>{STATUS_LABEL[n.status]}</Badge>
                      {n.retryCount > 0 && (
                        <span className="ml-2 text-xs text-muted">시도 {n.retryCount}회</span>
                      )}
                      {n.error && (
                        <span className="block text-xs text-rose-600">{n.error}</span>
                      )}
                    </Td>
                    <Td>{n.sentAt ? formatKDateTime(n.sentAt) : "—"}</Td>
                    <Td>
                      {/* 재발송은 실패·대기 건만. 'sending'은 결과 불명이라 다시 보내면
                          이중 발송이 되고, 'sent'는 같은 안내를 두 번 보내는 일이다. */}
                      {n.status === "failed" || n.status === "queued" ? (
                        <ActionButton
                          action={resendNotification}
                          id={n.id}
                          label="재발송"
                          confirmText="이 안내를 다시 발송합니다. 계속할까요?"
                        />
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </div>
    </div>
  );
}
