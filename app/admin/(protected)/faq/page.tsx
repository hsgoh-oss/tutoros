import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb, listFaqs, formatKDateTime } from "@/lib/data/crm";
import { listBackups } from "@/lib/data/backup";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { ActionButton } from "@/components/admin/crm/action-button";
import { deleteFaq, moveFaqDown, moveFaqUp, restoreFaqsBackup } from "./actions";

export default async function FaqPage() {
  const session = await getAdminSession();
  const connected = hasDb();
  const faqs = session ? await listFaqs(session.tenantId) : [];
  const backups = session ? await listBackups(session.tenantId, "faqs") : [];

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">FAQ 관리</h1>
          <p className="mt-1 text-sm text-muted">
            공개 사이트에 노출되는 자주 묻는 질문을 관리합니다.
          </p>
        </div>
        <Link href="/admin/faq/new" className={buttonClass("primary", "sm")}>
          신규 등록
        </Link>
      </div>

      {!connected && <DbBanner />}

      {faqs.length === 0 ? (
        <EmptyState
          title="등록된 FAQ가 없습니다"
          description="신규 등록 버튼으로 자주 묻는 질문을 추가할 수 있습니다."
          action={
            <Link href="/admin/faq/new" className={buttonClass("outline", "sm")}>
              신규 등록
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>카테고리</Th>
                <Th>질문</Th>
                <Th>순서</Th>
                <Th>삭제</Th>
              </tr>
            </thead>
            <tbody>
              {faqs.map((f, i) => (
                <tr key={f.id}>
                  <Td>
                    <Badge tone="soft">{f.category}</Badge>
                  </Td>
                  <Td>
                    <Link
                      href={`/admin/faq/${f.id}`}
                      className="font-bold text-ink hover:text-brand-600"
                    >
                      {f.question}
                    </Link>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <ActionButton
                        action={moveFaqUp}
                        id={f.id}
                        label="위로"
                        className={i === 0 ? "pointer-events-none opacity-30" : undefined}
                      />
                      <ActionButton
                        action={moveFaqDown}
                        id={f.id}
                        label="아래로"
                        className={
                          i === faqs.length - 1 ? "pointer-events-none opacity-30" : undefined
                        }
                      />
                    </div>
                  </Td>
                  <Td>
                    <ActionButton
                      action={deleteFaq}
                      id={f.id}
                      label="삭제"
                      confirmText="이 FAQ를 삭제하시겠습니까?"
                      tone="danger"
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {backups.length > 0 && (
        <Card className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">백업 이력 (최근 12개)</h2>
          <ul className="space-y-2">
            {backups.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between border-b border-line pb-2 last:border-0 last:pb-0"
              >
                <span className="text-sm text-muted">{formatKDateTime(b.createdAt)}</span>
                <ActionButton
                  action={restoreFaqsBackup}
                  id={b.id}
                  label="이 시점으로 복원"
                  confirmText="현재 FAQ 전체가 이 백업 시점으로 교체됩니다. 계속하시겠습니까?"
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
