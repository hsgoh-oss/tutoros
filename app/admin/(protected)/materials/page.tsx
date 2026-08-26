import Link from "next/link";
import { getAdminSession } from "@/lib/auth/session";
import { hasDb, listMaterials, formatKDate } from "@/lib/data/crm";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { DbBanner } from "@/components/admin/crm/db-banner";
import { EmptyState } from "@/components/admin/crm/empty-state";
import { ActionButton } from "@/components/admin/crm/action-button";
import { deleteMaterial } from "./actions";

export default async function MaterialsPage() {
  const session = await getAdminSession();
  const connected = hasDb();
  const materials = session ? await listMaterials(session.tenantId) : [];

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">자료 관리</h1>
        </div>
        <Link href="/admin/materials/new" className={buttonClass("primary", "sm")}>
          업로드
        </Link>
      </div>

      {!connected && <DbBanner />}

      {materials.length === 0 ? (
        <EmptyState
          title="등록된 자료가 없습니다"
          description="업로드 버튼으로 학생별 또는 전체 공유 자료를 추가할 수 있습니다."
          action={
            <Link href="/admin/materials/new" className={buttonClass("outline", "sm")}>
              업로드
            </Link>
          }
        />
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>자료명</Th>
                <Th>대상 학생</Th>
                <Th>공유 여부</Th>
                <Th>업로드일</Th>
                <Th>삭제</Th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <a
                      href={m.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-bold text-ink hover:text-brand-600"
                    >
                      {m.name}
                    </a>
                  </Td>
                  <Td>{m.studentName ?? "공유 자료"}</Td>
                  <Td>
                    <Badge tone={m.isShared ? "brand" : "soft"}>
                      {m.isShared ? "공유" : "개별"}
                    </Badge>
                  </Td>
                  <Td>{formatKDate(m.createdAt)}</Td>
                  <Td>
                    <ActionButton
                      action={deleteMaterial}
                      id={m.id}
                      label="삭제"
                      confirmText="이 자료를 삭제하시겠습니까?"
                      tone="danger"
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
