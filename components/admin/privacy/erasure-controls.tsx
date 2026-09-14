"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { executeRetentionErasure, recordRetentionDestruction } from "@/app/admin/(protected)/privacy/actions";
import { buttonClass } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import type { RetentionRecord } from "@/lib/privacy/retention";

const SCOPE = {
  student_service: "학생 연락처·프로필, 일정·출결·수업·과제·AI 기록, 개인 자료와 포털 접근을 삭제합니다. 계약·신청·동의·결제·후기와 감사 증적은 각 보존기한에 따라 별도로 남습니다.",
  consultation_intake: "상담, 신청폼, 시범수업 결과와 대기 기록을 삭제합니다. 동의 증명은 별도 보존기한까지 남습니다.",
  consent_proof: "이 대상의 신청폼·동의 이력을 삭제합니다. 계약과 거래 증적은 별도 보존기한까지 남습니다.",
  payment_legal: "해당 결제와 결제사 수신 기록, 관련 계약·수업 묶음 증적을 삭제합니다. 관련 거래·계약의 보존기한이 모두 지나야 실행됩니다.",
  review_consent: "철회된 후기, 작성 초대와 첨부파일을 삭제하고 콘텐츠 백업에서도 제외합니다.",
};

export function ErasureControls({ record }: { record: RetentionRecord }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = record.erasure;
  const filesDone = !!job?.storageCompletedAt;
  async function submit(form: FormData) {
    setPending(true); setError(null);
    try {
      const result = await (filesDone ? recordRetentionDestruction : executeRetentionErasure)(form);
      if (!result.ok) setError(result.error ?? "처리에 실패했습니다.");
    } catch { setError("처리 결과를 확인하지 못했습니다. 현재 상태를 새로 불러온 뒤 다시 시도해 주세요."); }
    finally { setPending(false); router.refresh(); }
  }
  if (record.state !== "due" && !job) return <p className="text-sm text-muted">보존기한이 지난 뒤 파기할 수 있습니다.</p>;
  return <div className="space-y-3">
    {job && <p className="text-sm font-medium text-ink">{filesDone ? "원본·첨부파일 삭제 완료 · 외부 보관 확인 대기" : "원본 삭제 완료 · 첨부파일 처리 필요"}</p>}
    {!expanded && !job ? <button type="button" className={buttonClass("outline", "md")} onClick={() => setExpanded(true)}>파기 범위 확인</button> : <form action={submit} className="space-y-3">
      <input type="hidden" name="id" value={record.id} />
      <p className="text-sm leading-relaxed text-muted">{SCOPE[record.category]}</p>
      {filesDone ? <>
        <p className="text-sm text-muted">외부 처리자, 내려받은 사본과 DB 백업은 자동 삭제하지 않습니다. 삭제 또는 보존 만료와 복원 방지 조치를 확인해 주세요.{job.externalFileCount > 0 && ` 외부·이전 첨부 경로 ${job.externalFileCount}건도 확인 대상입니다.`}</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="externalChecked" required className="mt-1" />외부 보관과 백업의 처리를 확인했습니다.</label>
        <Field label="처리 근거" hint="처리자 회신 번호, 백업 만료·삭제 확인 등. 이름·연락처는 적지 마세요.">
          <Textarea name="note" minLength={10} maxLength={2000} required placeholder="확인한 보관처, 처리일과 확인 근거" />
        </Field>
      </> : <>
        <p className="text-sm text-rose-700">삭제한 원본은 되돌릴 수 없습니다. {record.subjectLabel} · {record.categoryLabel} 항목의 범위를 확인해 주세요.</p>
        <Field label="‘파기’를 입력해 확인" hint="원본과 파일을 삭제한 뒤 외부 보관 확인 단계로 이동합니다."><Input name="confirmation" required pattern="파기" autoComplete="off" /></Field>
      </>}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonClass("outline", "md")}>{pending ? "처리 중…" : filesDone ? "외부 확인 후 파기 완료" : job ? "첨부파일 삭제 재시도" : "원본·첨부파일 삭제"}</button>
        {!job && <button type="button" disabled={pending} onClick={() => { setExpanded(false); setError(null); }} className={buttonClass("ghost", "md")}>닫기</button>}
      </div>
    </form>}
  </div>;
}
