"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import {
  FREQ_OPTIONS,
  HOURS_OPTIONS,
  SUBJECT_OPTIONS,
} from "@/components/public/consult/schema";
import {
  intakeFormSchema,
  type IntakeFormInput,
  type IntakeFormValues,
  type IntakeKind,
} from "@/components/public/intake/schema";
import { submitIntakeForm } from "@/app/f/[token]/actions";

// 신청폼 작성 화면(공개) — T-01 시범 신청폼 · R-01 정규 신청폼.
// 상담 폼(components/public/consult/consult-form.tsx)의 구조·동의·오류 표시 관례를 그대로 따른다.
//
// 두 종류를 한 컴포넌트로 렌더한다: 공통 항목(학생·학년·과목·희망 일정·연락처·요청사항)은 같고,
// 정규 폼만 관계(보호자·계약자·납부자)와 수업 조건 희망을 더 묻는다. 종류는 링크가 정하며
// 화면에서 바꿀 수 없다 — 서버도 클라가 보낸 kind를 버리고 DB 값으로 재검증한다.

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  const tailStart = digits.length - 4;
  return `${digits.slice(0, 3)}-${digits.slice(3, tailStart)}-${digits.slice(tailStart)}`;
}

/** 오류 메시지 한 줄 — id는 입력의 aria-describedby와 짝을 이룬다. */
function ErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className="mt-1.5 text-xs font-semibold text-rose-600"
    >
      {message}
    </p>
  );
}

export function IntakeForm({
  token,
  kind,
  recipientName,
}: {
  /** 링크 원문 토큰 — 제출 시 서버가 해시해 폼을 다시 찾는다(폼 id는 화면에 두지 않는다). */
  token: string;
  kind: IntakeKind;
  /** 상담 접수자 이름(있으면 인사말) — 연락처 등 나머지 상담 정보는 내려받지 않는다. */
  recipientName: string | null;
}) {
  const isRegular = kind === "regular";
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "success">(
    "idle",
  );
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<IntakeFormInput, unknown, IntakeFormValues>({
    resolver: zodResolver(intakeFormSchema),
    defaultValues: {
      kind,
      studentName: "",
      grade: "",
      subject: undefined,
      preferredSchedule: "",
      contactPhone: "",
      note: "",
      studentPhone: "",
      guardianName: "",
      guardianPhone: "",
      // 기본값은 "같은 사람" — 보호자 한 사람이 계약·납부까지 맡는 경우가 가장 흔하다.
      // 다르면 체크를 풀어 각각 입력한다(R-02 학습 접근과 금전 접근의 분리).
      contractorSameAsGuardian: true,
      contractorName: "",
      contractorPhone: "",
      payerSameAsContractor: true,
      payerName: "",
      payerPhone: "",
      hours: undefined,
      freq: undefined,
      classType: "unspecified",
      privacyConsent: false,
      marketingConsent: false,
    },
  });

  const contractorSame = watch("contractorSameAsGuardian");
  const payerSame = watch("payerSameAsContractor");

  async function onSubmit(values: IntakeFormValues) {
    setSubmitState("submitting");
    setServerError(null);
    try {
      const result = await submitIntakeForm(token, values);
      if (result.ok) {
        setAlreadySubmitted(result.already);
        setSubmitState("success");
      } else {
        setSubmitState("idle");
        setServerError(result.error);
      }
    } catch {
      // 전송 자체가 실패(네트워크 등) — 작성한 내용은 폼에 그대로 남는다.
      setSubmitState("idle");
      setServerError(
        "제출하지 못했습니다. 잠시 후 다시 시도해 주세요. 계속 실패하면 담당 선생님께 알려 주세요.",
      );
    }
  }

  if (submitState === "success") {
    return (
      <Card role="status" aria-live="polite" className="flex flex-col items-start gap-5 p-10">
        <p className="text-sm font-extrabold text-brand-600">제출 완료</p>
        <h2 className="text-2xl font-black tracking-tight text-ink">
          제출되었습니다. 확인 후 연락드립니다
        </h2>
        {alreadySubmitted && (
          // 중복 제출은 최초 제출 결과로 수렴한다(T-01 예외) — 내용을 덮어쓰지 않는다.
          <p className="rounded-panel bg-soft px-4 py-3 text-sm font-semibold leading-relaxed text-ink-soft">
            이미 제출되었습니다. 먼저 제출하신 내용으로 검토가 진행되며, 이번
            작성 내용은 저장되지 않았습니다. 수정이 필요하시면 담당 선생님께
            말씀해 주세요.
          </p>
        )}
        {/* 검수 8 — 폼 제출만으로 일정이 확정되지 않는다. 성공 화면에서 명시한다. */}
        <p className="text-[15px] leading-[1.86] tracking-tight text-muted">
          이 제출만으로 수업 일정이 확정되지는 않습니다. 담당 선생님이 내용을
          확인한 뒤 일정{isRegular ? "·결제·계약" : "과 결제 여부"}를 안내드리고,
          합의된 다음에 확정됩니다.
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-8">
      <Card className="space-y-6 p-8">
        <div>
          <h2 className="text-lg font-black tracking-tight text-ink">
            {isRegular ? "정규수업 신청" : "시범수업 신청"}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {recipientName ? `${recipientName}님, ` : ""}아래 내용을 작성해
            주시면 담당 선생님이 확인 후 연락드립니다.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Field label="학생 이름" required>
            <Input
              {...register("studentName")}
              placeholder="홍길동"
              aria-invalid={errors.studentName ? true : undefined}
              aria-describedby={errors.studentName ? "intake-studentname-error" : undefined}
            />
            <ErrorText id="intake-studentname-error" message={errors.studentName?.message} />
          </Field>

          <Field label="학년" required hint="예: 고2, 중3, 재수">
            <Input
              {...register("grade")}
              placeholder="고2"
              aria-invalid={errors.grade ? true : undefined}
              aria-describedby={errors.grade ? "intake-grade-error" : undefined}
            />
            <ErrorText id="intake-grade-error" message={errors.grade?.message} />
          </Field>

          <Field label="과목" required>
            <Select
              {...register("subject")}
              aria-invalid={errors.subject ? true : undefined}
              aria-describedby={errors.subject ? "intake-subject-error" : undefined}
            >
              <option value="">선택해 주세요</option>
              {SUBJECT_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <ErrorText id="intake-subject-error" message={errors.subject?.message} />
          </Field>

          <Field label="연락처" required hint="연락 받으실 번호 (010-1234-5678)">
            <Controller
              control={control}
              name="contactPhone"
              render={({ field }) => (
                <Input
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(formatPhone(e.target.value))}
                  onBlur={field.onBlur}
                  inputMode="numeric"
                  placeholder="010-1234-5678"
                  aria-invalid={errors.contactPhone ? true : undefined}
                  aria-describedby={errors.contactPhone ? "intake-contactphone-error" : undefined}
                />
              )}
            />
            <ErrorText id="intake-contactphone-error" message={errors.contactPhone?.message} />
          </Field>
        </div>

        <Field
          label="희망 일정"
          required
          hint="가능한 요일·시간대를 자유롭게 적어 주세요. 확정은 확인 후 안내드립니다."
        >
          <Textarea
            {...register("preferredSchedule")}
            placeholder="예: 평일 저녁 7시 이후, 토요일 오전도 가능합니다."
            aria-invalid={errors.preferredSchedule ? true : undefined}
            aria-describedby={
              errors.preferredSchedule ? "intake-schedule-error" : undefined
            }
          />
          <ErrorText id="intake-schedule-error" message={errors.preferredSchedule?.message} />
        </Field>

        <Field label="요청사항">
          <Textarea
            {...register("note")}
            placeholder="현재 학습 상황, 목표, 미리 알아 두면 좋을 점을 자유롭게 남겨 주세요."
          />
        </Field>
      </Card>

      {isRegular && (
        <>
          {/* R-02 관계 확인 — 학생·보호자·계약자·납부자. 같은 사람이면 '동일' 체크로 연결한다. */}
          <Card className="space-y-6 p-8">
            <div>
              <h2 className="text-lg font-black tracking-tight text-ink">
                관계 정보
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                학습 안내를 받으실 분(보호자)과 계약·납부를 맡으실 분을
                확인합니다. 같은 분이면 아래 &lsquo;동일&rsquo;을 그대로 두세요.
              </p>
            </div>

            <Field label="학생 연락처" hint="학생 본인 번호가 없으면 비워 두세요">
              <Controller
                control={control}
                name="studentPhone"
                render={({ field }) => (
                  <Input
                    value={typeof field.value === "string" ? field.value : ""}
                    onChange={(e) => field.onChange(formatPhone(e.target.value))}
                    onBlur={field.onBlur}
                    inputMode="numeric"
                    placeholder="010-1234-5678"
                    aria-invalid={errors.studentPhone ? true : undefined}
                    aria-describedby={
                      errors.studentPhone ? "intake-studentphone-error" : undefined
                    }
                  />
                )}
              />
              <ErrorText id="intake-studentphone-error" message={errors.studentPhone?.message} />
            </Field>

            <div className="grid gap-5 border-t border-line pt-6 md:grid-cols-2">
              <Field label="보호자 성명" required>
                <Input
                  {...register("guardianName")}
                  placeholder="보호자 이름"
                  aria-invalid={errors.guardianName ? true : undefined}
                  aria-describedby={
                    errors.guardianName ? "intake-guardianname-error" : undefined
                  }
                />
                <ErrorText id="intake-guardianname-error" message={errors.guardianName?.message} />
              </Field>
              <Field label="보호자 연락처" required hint="010-1234-5678">
                <Controller
                  control={control}
                  name="guardianPhone"
                  render={({ field }) => (
                    <Input
                      value={typeof field.value === "string" ? field.value : ""}
                      onChange={(e) => field.onChange(formatPhone(e.target.value))}
                      onBlur={field.onBlur}
                      inputMode="numeric"
                      placeholder="010-1234-5678"
                      aria-invalid={errors.guardianPhone ? true : undefined}
                      aria-describedby={
                        errors.guardianPhone ? "intake-guardianphone-error" : undefined
                      }
                    />
                  )}
                />
                <ErrorText id="intake-guardianphone-error" message={errors.guardianPhone?.message} />
              </Field>
            </div>

            <div className="space-y-5 border-t border-line pt-6">
              <label className="flex min-h-12 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
                  {...register("contractorSameAsGuardian")}
                />
                <span className="text-sm font-bold text-ink-soft">
                  계약자가 보호자와 동일합니다
                </span>
              </label>

              {!contractorSame && (
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="계약자 성명" required>
                    <Input
                      {...register("contractorName")}
                      placeholder="계약자 이름"
                      aria-invalid={errors.contractorName ? true : undefined}
                      aria-describedby={
                        errors.contractorName ? "intake-contractorname-error" : undefined
                      }
                    />
                    <ErrorText
                      id="intake-contractorname-error"
                      message={errors.contractorName?.message}
                    />
                  </Field>
                  <Field label="계약자 연락처" required hint="010-1234-5678">
                    <Controller
                      control={control}
                      name="contractorPhone"
                      render={({ field }) => (
                        <Input
                          value={typeof field.value === "string" ? field.value : ""}
                          onChange={(e) => field.onChange(formatPhone(e.target.value))}
                          onBlur={field.onBlur}
                          inputMode="numeric"
                          placeholder="010-1234-5678"
                          aria-invalid={errors.contractorPhone ? true : undefined}
                          aria-describedby={
                            errors.contractorPhone
                              ? "intake-contractorphone-error"
                              : undefined
                          }
                        />
                      )}
                    />
                    <ErrorText
                      id="intake-contractorphone-error"
                      message={errors.contractorPhone?.message}
                    />
                  </Field>
                </div>
              )}

              <label className="flex min-h-12 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
                  {...register("payerSameAsContractor")}
                />
                <span className="text-sm font-bold text-ink-soft">
                  납부자가 계약자와 동일합니다
                </span>
              </label>

              {!payerSame && (
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="납부자 성명" required>
                    <Input
                      {...register("payerName")}
                      placeholder="납부자 이름"
                      aria-invalid={errors.payerName ? true : undefined}
                      aria-describedby={
                        errors.payerName ? "intake-payername-error" : undefined
                      }
                    />
                    <ErrorText id="intake-payername-error" message={errors.payerName?.message} />
                  </Field>
                  <Field label="납부자 연락처" required hint="010-1234-5678">
                    <Controller
                      control={control}
                      name="payerPhone"
                      render={({ field }) => (
                        <Input
                          value={typeof field.value === "string" ? field.value : ""}
                          onChange={(e) => field.onChange(formatPhone(e.target.value))}
                          onBlur={field.onBlur}
                          inputMode="numeric"
                          placeholder="010-1234-5678"
                          aria-invalid={errors.payerPhone ? true : undefined}
                          aria-describedby={
                            errors.payerPhone ? "intake-payerphone-error" : undefined
                          }
                        />
                      )}
                    />
                    <ErrorText id="intake-payerphone-error" message={errors.payerPhone?.message} />
                  </Field>
                </div>
              )}
            </div>
          </Card>

          {/* R-01 수업 조건 확인 — 어디까지나 '희망'이다. 계약 조건 확정과 동의는 별도 단계(R-03). */}
          <Card className="space-y-6 p-8">
            <div>
              <h2 className="text-lg font-black tracking-tight text-ink">
                수업 조건 희망
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                상담 시 조정 가능합니다. 최종 조건은 계약 단계에서 다시
                확인합니다.
              </p>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              <Field label="희망 회당 시간" required>
                <Select
                  {...register("hours")}
                  aria-invalid={errors.hours ? true : undefined}
                  aria-describedby={errors.hours ? "intake-hours-error" : undefined}
                >
                  <option value="">선택해 주세요</option>
                  {HOURS_OPTIONS.map((h) => (
                    <option key={h} value={h}>
                      {h}시간
                    </option>
                  ))}
                </Select>
                <ErrorText id="intake-hours-error" message={errors.hours?.message} />
              </Field>
              <Field label="희망 주당 횟수" required>
                <Select
                  {...register("freq")}
                  aria-invalid={errors.freq ? true : undefined}
                  aria-describedby={errors.freq ? "intake-freq-error" : undefined}
                >
                  <option value="">선택해 주세요</option>
                  {FREQ_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      주 {f}회
                    </option>
                  ))}
                </Select>
                <ErrorText id="intake-freq-error" message={errors.freq?.message} />
              </Field>
              <Field label="수업 방식" required>
                <Select {...register("classType")}>
                  <option value="unspecified">미정</option>
                  <option value="inperson">대면</option>
                  <option value="video">화상</option>
                </Select>
              </Field>
            </div>
          </Card>
        </>
      )}

      {/* 동의 — 상담 폼과 같은 문구·같은 필수 판정(개인정보 수집·이용). */}
      <Card className="space-y-3 p-8">
        <label className="flex min-h-12 items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
            {...register("privacyConsent")}
            aria-invalid={errors.privacyConsent ? true : undefined}
            aria-describedby={
              errors.privacyConsent ? "intake-privacyconsent-error" : undefined
            }
          />
          <span className="text-sm leading-relaxed text-ink-soft">
            [필수] 개인정보 수집·이용 동의 (TUTOR OS 플랫폼 처리위탁 및 AI 처리
            목적 가명화 국외이전 포함){" "}
            <Link
              href="/privacy"
              className="font-bold text-brand-600 underline underline-offset-2"
            >
              자세히 보기
            </Link>
          </span>
        </label>
        <ErrorText
          id="intake-privacyconsent-error"
          message={errors.privacyConsent?.message}
        />

        <label className="flex min-h-12 items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
            {...register("marketingConsent")}
          />
          <span className="text-sm leading-relaxed text-ink-soft">
            [선택] 마케팅·수업 안내 수신 동의
          </span>
        </label>

        {isRegular && (
          // R-03 예외 — 신청폼 동의만으로 계약 수락으로 처리하지 않는다. 화면에서도 구분해 알린다.
          <p className="rounded-panel bg-soft px-4 py-3 text-xs leading-relaxed text-muted">
            이 동의는 신청서 접수를 위한 것으로, 수업 계약의 수락과는 다릅니다.
            계약 조건은 확인 후 별도로 안내드리고 그때 다시 동의를 받습니다.
          </p>
        )}
      </Card>

      {serverError && (
        <p
          role="alert"
          className="rounded-panel border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
        >
          {serverError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitState === "submitting"}
        className={buttonClass("primary", "lg", "w-full md:w-auto")}
      >
        {submitState === "submitting" ? "제출 중..." : "신청서 제출하기"}
      </button>
    </form>
  );
}
