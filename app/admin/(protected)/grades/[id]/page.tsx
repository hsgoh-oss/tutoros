import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { getGrade, listStudentOptions, formatKDateTime } from "@/lib/data/crm";
import { listAdjustments, type Adjustment } from "@/lib/data/adjustments";
import { Card } from "@/components/ui/card";
import { Field, Textarea, Input } from "@/components/ui/form";
import { SubmitForm } from "@/components/admin/crm/submit-form";
import { ActionButton } from "@/components/admin/crm/action-button";
import { updateGrade, deleteGrade, generateExamReport } from "../actions";
import { GradeFormFields } from "../grade-form-fields";

// A-06 안내: 정정·삭제는 이미 발송된 리포트를 자동으로 바꾸지 않는다 —
// 영향 갱신은 리포트 재생성 → 재승인 → 재발송으로 이뤄진다(원 결과 유지 → 새 결과본 → 재승인 → 영향 갱신).
const REPORT_IMPACT_NOTICE =
  "정정·삭제해도 이미 발송된 리포트는 자동으로 바뀌지 않습니다. 영향이 있으면 시험 리포트를 다시 생성해 재승인 후 발송으로 갱신하세요.";

/** 조정 이력의 전후 값(jsonb)에서 사람이 읽을 변경 요약을 만든다 — 알 수 없는 형태면 빈 배열. */
function summarizeChange(adj: Adjustment): string[] {
  const before = (adj.before ?? {}) as Record<string, unknown>;
  const after = (adj.after ?? {}) as Record<string, unknown>;
  if ("deleted_at" in after) return ["결과 철회(소프트 삭제)"];
  const fields: { key: string; label: string }[] = [
    { key: "exam_name", label: "시험명" },
    { key: "exam_date", label: "시험일" },
    { key: "raw_score", label: "원점수" },
    { key: "percentile", label: "백분위" },
    { key: "grade", label: "등급" },
  ];
  const lines: string[] = [];
  for (const { key, label } of fields) {
    const b = before[key];
    const a = after[key];
    if (b === a) continue;
    lines.push(`${label} ${b ?? "-"} → ${a ?? "-"}`);
  }
  return lines;
}

export default async function GradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAdminSession();
  if (!session) notFound();

  const grade = await getGrade(session.tenantId, id);
  if (!grade) notFound();

  const [studentOptions, adjustments] = await Promise.all([
    listStudentOptions(session.tenantId),
    // 이 성적의 조정 이력(A-06) — 정정·철회가 언제·누가·왜 있었는지 최근순.
    listAdjustments(session.tenantId, "grade_record", grade.id),
  ]);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{grade.examName}</h1>
          <p className="mt-1 text-sm text-muted">
            성적을 정정하거나 철회합니다. 모든 정정·철회는 사유와 함께 이력으로 남습니다.
          </p>
        </div>
        <Link
          href="/admin/grades"
          className="text-sm font-bold text-muted hover:text-ink"
        >
          ← 목록으로
        </Link>
      </div>

      <Card className="max-w-3xl">
        <SubmitForm action={updateGrade} submitLabel="정정 저장" pendingLabel="정정 중...">
          <input type="hidden" name="id" value={grade.id} />
          <GradeFormFields studentOptions={studentOptions} record={grade} />
          <div className="mt-5">
            <Field label="정정 사유" required hint={REPORT_IMPACT_NOTICE}>
              <Textarea
                name="reason"
                required
                placeholder="예: 채점 오류 정정 — 3번 문항 부분점수 반영"
              />
            </Field>
          </div>
        </SubmitForm>
        <div className="mt-6 flex flex-wrap items-center gap-5 border-t border-line pt-4">
          <ActionButton
            action={generateExamReport}
            id={grade.id}
            label="시험 리포트 생성"
            pendingLabel="생성 중..."
            confirmText="이 시험 성적으로 학부모용·학생용 리포트 초안을 생성하시겠습니까? (AI 참고용, 발송 전 검토 필요)"
            redirectTo={`/admin/reports?student=${grade.studentId}`}
          />
        </div>
      </Card>

      {/* A-06 조정 이력 — 원 결과는 덮어써 사라지지 않고, 무엇이 어떤 값에서 어떤 값으로 왜 바뀌었는지 남는다. */}
      <Card className="mt-6 max-w-3xl">
        <h2 className="text-sm font-semibold tracking-tight">조정 이력</h2>
        {adjustments.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            조정 이력이 없습니다. 정정·철회 시 사유와 변경 전후 값이 여기에 기록됩니다.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {adjustments.map((adj) => {
              const changes = summarizeChange(adj);
              return (
                <li key={adj.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-bold text-ink">
                      {formatKDateTime(adj.createdAt)}
                    </span>
                    <span className="text-muted">{adj.actorEmail ?? "-"}</span>
                  </div>
                  <p className="mt-1 text-ink-soft">사유: {adj.reason}</p>
                  {changes.length > 0 && (
                    <p className="mt-1 text-xs text-muted">{changes.join(" · ")}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* A-06 철회 — 물리 삭제 대신 deleted_at 스탬프. 사유 필수, 목록·조회에서 제외된다. */}
      <Card className="mt-6 max-w-3xl border-rose-200">
        <h2 className="text-sm font-semibold tracking-tight text-rose-600">
          성적 삭제(철회)
        </h2>
        <p className="mt-2 text-sm text-muted">
          원 결과는 지워지지 않고 철회 표시와 함께 이력으로 보존되며, 목록·조회에서
          제외됩니다. {REPORT_IMPACT_NOTICE}
        </p>
        <SubmitForm
          action={deleteGrade}
          submitLabel="성적 삭제(철회)"
          pendingLabel="철회 중..."
          redirectTo="/admin/grades"
          className="mt-4"
        >
          <input type="hidden" name="id" value={grade.id} />
          <Field label="삭제(철회) 사유" required>
            <Input
              name="reason"
              required
              placeholder="예: 중복 등록된 성적 — 원본 기록만 유지"
            />
          </Field>
        </SubmitForm>
      </Card>
    </div>
  );
}
