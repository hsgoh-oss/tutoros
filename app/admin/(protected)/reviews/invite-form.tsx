"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import type { StudentOption } from "@/lib/data/crm";
import { issueReviewInvitation, type ReviewLinkResult } from "./actions";
import { IssuedReviewLink } from "./issued-link";

// 작성 초대 발급 폼 — 후기 관리 > 작성 초대 보내기, 학생 상세 카드가 함께 쓴다.
// 학생을 고르면 이름·보호자 연락처를 채워 준다. 학생 목록에 없는 대상(옛 수강생)은 이름을 직접 적는다.
// 발급 게이트(S-01 "운영자가 대상·작성자 역할·요청 목적·공개범위 확인")는 아래 확인 체크박스가 담당하고,
// 실제 거부는 서버 액션이 한다.

export interface StudentPrefill extends StudentOption {
  isAdult: boolean;
  parentPhone: string | null;
  studentPhone: string | null;
}

export function ReviewInviteForm({
  students,
  fixedStudent,
  compact = false,
}: {
  /** 학생 선택지(전체 목록). fixedStudent가 있으면 쓰지 않는다. */
  students?: StudentPrefill[];
  /** 학생 상세에서 쓸 때 — 학생이 정해져 있어 선택하지 않는다. */
  fixedStudent?: StudentPrefill;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [studentId, setStudentId] = useState<string>(fixedStudent?.id ?? "");
  const [studentName, setStudentName] = useState<string>(fixedStudent?.name ?? "");
  const [authorRole, setAuthorRole] = useState<"student" | "parent">(fixedStudent?.isAdult ? "student" : "parent");
  const [authorName, setAuthorName] = useState<string>(fixedStudent?.isAdult ? fixedStudent.name : "");
  const [authorPhone, setAuthorPhone] = useState<string>((fixedStudent?.isAdult ? fixedStudent.studentPhone : fixedStudent?.parentPhone) ?? "");
  const [expiresDays, setExpiresDays] = useState<string>("14");
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<ReviewLinkResult | null>(null);

  const current: StudentPrefill | undefined =
    fixedStudent ?? students?.find((s) => s.id === studentId);

  const pickStudent = (id: string) => {
    setStudentId(id);
    const s = students?.find((x) => x.id === id);
    if (s) {
      setStudentName(s.name);
      const role = s.isAdult ? "student" : authorRole;
      setAuthorRole(role);
      setAuthorPhone((role === "student" ? s.studentPhone : s.parentPhone) ?? "");
      if (role === "student") setAuthorName(s.name);
    }
  };

  const pickRole = (role: "student" | "parent") => {
    setAuthorRole(role);
    if (!current) return;
    if (role === "student") {
      setAuthorName(current.name);
      setAuthorPhone(current.studentPhone ?? "");
    } else {
      setAuthorPhone(current.parentPhone ?? "");
    }
  };

  const submit = () => {
    if (!confirmed) {
      setResult({ ok: false, error: "대상·작성자·공개 범위 확인을 먼저 체크해 주세요." });
      return;
    }
    if (!window.confirm(`${studentName || "학생"} 건의 작성 링크를 ${authorName || "작성자"}님께 발송할까요?`)) return;
    const fd = new FormData();
    fd.set("studentId", studentId);
    fd.set("studentName", studentName);
    fd.set("authorRole", authorRole);
    fd.set("authorName", authorName);
    fd.set("authorPhone", authorPhone);
    fd.set("expiresDays", expiresDays);
    startTransition(async () => {
      const r = await issueReviewInvitation(fd);
      setResult(r);
      if (r.ok) {
        setConfirmed(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className={compact ? "grid gap-4" : "grid gap-5 md:grid-cols-2"}>
        {!fixedStudent && (
          <Field label="학생 선택" hint="목록에 없으면 아래 이름을 직접 입력">
            <Select value={studentId} onChange={(e) => pickStudent(e.target.value)} disabled={pending}>
              <option value="">직접 입력</option>
              {(students ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {!fixedStudent && (
          <Field label="대상 학생 이름" required>
            <Input
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="홍길동"
              disabled={pending}
            />
          </Field>
        )}
        <Field label="작성자" required>
          <Select
            value={authorRole}
            onChange={(e) => pickRole(e.target.value as "student" | "parent")}
            disabled={pending}
          >
            <option value="parent">보호자</option>
            <option value="student">학생 본인</option>
          </Select>
        </Field>
        <Field label="작성자 이름" required>
          <Input
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder={authorRole === "student" ? studentName || "학생 이름" : "보호자 이름"}
            disabled={pending}
          />
        </Field>
        <Field label="작성자 연락처" required hint="알림톡(미연결 시 문자)으로 작성 링크가 갑니다">
          <Input
            value={authorPhone}
            onChange={(e) => setAuthorPhone(e.target.value)}
            inputMode="numeric"
            placeholder="010-1234-5678"
            disabled={pending}
          />
        </Field>
        <Field label="링크 유효 기간(일)" hint="1~90일 · 기본 14일">
          <Input
            type="number"
            min={1}
            max={90}
            value={expiresDays}
            onChange={(e) => setExpiresDays(e.target.value)}
            disabled={pending}
          />
        </Field>
      </div>

      {/* S-01 게이트 — 대상·작성자 역할·요청 목적·공개범위를 운영자가 확인했다는 선언. */}
      <label className="flex cursor-pointer items-start gap-2 rounded-panel border border-line bg-soft p-3">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={pending}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
        />
        <span>
          <span className="block text-sm font-bold text-ink">
            대상 학생·작성자 관계·요청 목적·공개 범위를 확인했습니다
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            수업을 실제로 들은 학생(또는 그 보호자)에게만 보냅니다. 공개 여부는 작성자가 작성 화면에서
            건별로 선택하고, 제출본은 검토 후에만 게시됩니다.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !confirmed}
          onClick={submit}
          className={buttonClass("primary", "sm")}
        >
          {pending ? "발급 중..." : "작성 링크 발송"}
        </button>
      </div>

      {result && !result.ok && (
        <p className="text-sm font-bold text-rose-600">{result.error}</p>
      )}
      {result?.ok && result.link && <IssuedReviewLink link={result.link} warnings={result.warnings} />}
    </div>
  );
}
