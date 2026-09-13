"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { submitConsult } from "@/lib/actions/consult";
import { ConsentFields } from "@/components/public/consult/consent-fields";
import { CONSULT_STEPS } from "@/components/public/consult/consult-process";
import {
  FREQ_OPTIONS,
  HOURS_OPTIONS,
  SUBJECT_OPTIONS,
  birthYearOptions,
  consultFormSchema,
  isMinorBirthYear,
  type ConsultFormInput,
  type ConsultFormValues,
} from "@/components/public/consult/schema";

// 상담 신청서.
//
// 내용(항목·문구·판정)은 그대로다 — 이름·연락처·과목·수업 방식·희망 시간/횟수·문의 내용·자기진단 항목,
// 학생 본인 신청 시 출생년도와 만 14세 미만 법정대리인 정보, 동의 4종. 바뀐 것은 구조와 흐름이다:
//  · 네 단계(기본 정보 → 희망 수업 → 신청자 확인 → 동의)로 나누고, 위쪽 진행 표시가 어느 단계가
//    비어 있는지 보여 준다. 긴 폼을 한 덩어리로 두면 "얼마나 남았는지"를 모른 채 이탈한다.
//  · 수업 방식은 셀렉트 대신 세 칸 선택지로 — 세 개짜리 선택을 드롭다운 뒤에 숨기지 않는다.
//  · 동의는 공용 블록(consent-fields.tsx) — 전체 동의 한 번, 필수/선택 칩, 선택을 거절해도 접수된다는 문장.
//  · 시범수업료는 하드코딩(5만 원)이 아니라 관리자 설정(rates.trial)을 받는다.
//  · 접수 완료 화면에서 "다음에 무슨 일이 생기는지"를 절차 문구 그대로 보여 준다.

const CHECKLIST_STORAGE_KEY = "axiom-checklist";

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  const tailStart = digits.length - 4;
  return `${digits.slice(0, 3)}-${digits.slice(3, tailStart)}-${digits.slice(tailStart)}`;
}

function sanitizeOption<T extends readonly string[]>(
  value: string | undefined,
  options: T,
): T[number] | undefined {
  return value && (options as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

function won(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

/** 오류 한 줄 — id는 입력의 aria-describedby와 짝을 이룬다. */
function ErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">
      {message}
    </p>
  );
}

/** 단계 머리 — 번호·제목·한 줄 설명. 카드 안에서 첫 줄을 맡는다. */
function StepHeading({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[12px] font-extrabold text-white"
      >
        {number}
      </span>
      <div>
        <h3 className="m-0 text-lg font-black tracking-tight text-ink">{title}</h3>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
        )}
      </div>
    </div>
  );
}

const CLASS_TYPE_CHOICES = [
  { value: "unspecified", label: "미정", hint: "상담에서 결정" },
  { value: "inperson", label: "대면", hint: "수도권 일부 지역" },
  { value: "video", label: "화상", hint: "지역 제한 없음" },
] as const;

export function ConsultForm({
  initialMode,
  initialHours,
  initialFreq,
  kakaoUrl,
  trialFee,
}: {
  initialMode?: string;
  initialHours?: string;
  initialFreq?: string;
  kakaoUrl: string;
  /** 시범수업 1회(1시간) 가격 — 관리자 설정(rates.trial). */
  trialFee: number;
}) {
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "success">(
    "idle",
  );
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, submitCount },
  } = useForm<ConsultFormInput, unknown, ConsultFormValues>({
    resolver: zodResolver(consultFormSchema),
    defaultValues: {
      name: "",
      phone: "",
      subject: undefined,
      classType:
        initialMode === "inperson" || initialMode === "video"
          ? initialMode
          : "unspecified",
      hours: sanitizeOption(initialHours, HOURS_OPTIONS),
      freq: sanitizeOption(initialFreq, FREQ_OPTIONS),
      message: "",
      isStudentSelf: false,
      birthYear: undefined,
      guardianName: "",
      guardianPhone: "",
      guardianConsent: false,
      termsConsent: false,
      privacyConsent: false,
      overseasAiConsent: false,
      marketingConsent: false,
      checklistItems: [],
    },
  });

  const values = watch();
  const isStudentSelf = values.isStudentSelf;
  const birthYear = values.birthYear;
  const checklistItems = values.checklistItems ?? [];
  const isMinor = isStudentSelf && birthYear ? isMinorBirthYear(Number(birthYear)) : false;
  const birthYears = birthYearOptions();

  // 메인 자기진단(sessionStorage)에서 선택한 항목을 상담 폼에 함께 전달한다.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CHECKLIST_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const items = parsed.filter((v): v is string => typeof v === "string");
        if (items.length > 0) setValue("checklistItems", items);
      }
    } catch {
      // sessionStorage 접근 불가/형식 오류 시 조용히 무시 — 필수 정보가 아니다.
    }
  }, [setValue]);

  // 진행 표시 — 각 단계의 필수 항목이 채워졌는지. 검증 오류가 아니라 "아직 비어 있음"의 신호다.
  const steps = [
    {
      label: "기본 정보",
      done: values.name.trim().length > 0 && /^01[016789]-\d{3,4}-\d{4}$/.test(values.phone),
    },
    { label: "희망 수업", done: true, optional: true },
    {
      label: "신청자 확인",
      done: !isStudentSelf || (Boolean(birthYear) && (!isMinor || values.guardianConsent)),
    },
    { label: "동의", done: values.termsConsent && values.privacyConsent },
  ];

  async function onSubmit(data: ConsultFormValues) {
    setSubmitState("submitting");
    setServerError(null);
    const result = await submitConsult(data);
    if (result.ok) {
      setSubmitState("success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setSubmitState("idle");
      setServerError(result.error);
    }
  }

  if (submitState === "success") {
    return (
      <Card role="status" aria-live="polite" className="p-8 md:p-10">
        <p className="text-sm font-extrabold text-brand-600">접수 완료</p>
        <h3 className="mt-2 text-2xl font-black tracking-tight text-ink">
          상담 신청이 접수되었습니다
        </h3>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-[1.86] tracking-tight text-muted">
          작성해 주신 내용을 확인한 뒤 남겨 주신 연락처로 순차적으로 안내드립니다.
          신청만으로 시범수업·정규수업 일정이 확정되지는 않습니다.
        </p>

        <ol className="m-0 mt-7 list-none space-y-3 border-t border-line p-0 pt-6">
          {CONSULT_STEPS.slice(1).map((step, index) => (
            <li key={step.number} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-soft text-[11px] font-extrabold text-ink-soft"
              >
                {index + 1}
              </span>
              <span>
                <b className="block text-sm font-extrabold text-ink">{step.title}</b>
                <span className="block text-sm leading-relaxed text-muted">
                  {step.description}
                </span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href={kakaoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass("primary", "md")}
          >
            카카오톡 문의
          </a>
          <Link href="/" className={buttonClass("outline", "md")}>
            홈으로
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      {/* 진행 표시 — 네 단계가 한눈에 보이고, 제출을 눌러 본 뒤에는 비어 있는 단계가 붉게 표시된다. */}
      <ol
        aria-label="작성 단계"
        className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4"
      >
        {steps.map((step, index) => {
          const missing = submitCount > 0 && !step.done;
          return (
            <li
              key={step.label}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-[var(--radius-panel)] border px-3 text-xs font-extrabold tracking-[-0.02em]",
                step.done
                  ? "border-brand-100 bg-brand-50 text-brand-700"
                  : missing
                    ? "border-rose-100 bg-rose-50 text-rose-700"
                    : "border-line bg-white text-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                  step.done ? "bg-brand-600 text-white" : "bg-soft text-ink-soft",
                )}
              >
                {step.done ? "✓" : index + 1}
              </span>
              {step.label}
              {step.optional && <span className="font-bold text-faint">선택</span>}
            </li>
          );
        })}
      </ol>

      {/* ── 01 기본 정보 ─────────────────────────────────────────── */}
      <Card className="space-y-6 p-6 md:p-8">
        <StepHeading
          number="1"
          title="기본 정보"
          description="연락드릴 분의 이름과 연락처를 남겨 주세요."
        />

        <div className="grid gap-5 md:grid-cols-2">
          <Field label="이름" required>
            <Input
              {...register("name")}
              placeholder="홍길동"
              autoComplete="name"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "consult-name-error" : undefined}
            />
            <ErrorText id="consult-name-error" message={errors.name?.message} />
          </Field>

          <Field label="연락처" required hint="안내를 받으실 번호">
            <Controller
              control={control}
              name="phone"
              render={({ field }) => (
                <Input
                  value={field.value}
                  onChange={(e) => field.onChange(formatPhone(e.target.value))}
                  onBlur={field.onBlur}
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="010-1234-5678"
                  aria-invalid={errors.phone ? true : undefined}
                  aria-describedby={errors.phone ? "consult-phone-error" : undefined}
                />
              )}
            />
            <ErrorText id="consult-phone-error" message={errors.phone?.message} />
          </Field>

          <Field label="과목">
            <Select {...register("subject")}>
              <option value="">선택 안 함</option>
              {SUBJECT_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>

          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-1.5 text-sm [font-weight:var(--ui-w-label)] text-ink-soft">
              수업 방식
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {CLASS_TYPE_CHOICES.map((choice) => {
                const selected = values.classType === choice.value;
                return (
                  <label
                    key={choice.value}
                    className={cn(
                      "flex min-h-[var(--ui-h-md)] cursor-pointer flex-col items-center justify-center rounded-[var(--radius-field)] border px-2 py-2 text-center transition-colors",
                      selected
                        ? "border-brand-600 bg-brand-50 text-brand-700"
                        : "border-line bg-white text-ink-soft hover:border-brand-300",
                    )}
                  >
                    <input
                      type="radio"
                      value={choice.value}
                      {...register("classType")}
                      className="sr-only"
                    />
                    <span className="text-sm font-extrabold tracking-[-0.02em]">
                      {choice.label}
                    </span>
                    <span className="text-[11px] font-bold text-faint">{choice.hint}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      </Card>

      {/* ── 02 희망 수업 ─────────────────────────────────────────── */}
      <Card className="space-y-6 p-6 md:p-8">
        <StepHeading
          number="2"
          title="희망 수업"
          description="아직 정하지 않았다면 비워 두셔도 됩니다. 상담에서 함께 정합니다."
        />

        <div className="grid gap-5 md:grid-cols-2">
          <Field label="희망 회당 시간" hint="상담 시 조정 가능합니다">
            <Select {...register("hours")}>
              <option value="">선택 안 함</option>
              {HOURS_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h}시간
                </option>
              ))}
            </Select>
          </Field>

          <Field label="희망 주당 횟수" hint="상담 시 조정 가능합니다">
            <Select {...register("freq")}>
              <option value="">선택 안 함</option>
              {FREQ_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  주 {f}회
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="문의 내용">
          <Textarea
            {...register("message")}
            placeholder="현재 학년, 최근 성적, 목표 등을 자유롭게 남겨 주세요."
          />
        </Field>

        <div className="flex flex-col gap-2 rounded-[var(--radius-panel)] bg-soft px-4 py-3 text-xs leading-relaxed text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>
            시범수업(화상 1시간 <b className="text-ink-soft">{won(trialFee)}</b>)은 별도
            신청 없이 상담에서 안내드립니다.
          </span>
          {checklistItems.length > 0 && (
            <span className="font-bold text-brand-600">
              자기진단에서 선택한 항목 {checklistItems.length}개가 함께 전달됩니다.
            </span>
          )}
        </div>
      </Card>

      {/* ── 03 신청자 확인 ───────────────────────────────────────── */}
      <Card className="space-y-5 p-6 md:p-8">
        <StepHeading
          number="3"
          title="신청자 확인"
          description="보호자가 신청하시면 그대로 두세요. 학생이 직접 신청할 때만 체크합니다."
        />

        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-panel)] border border-line px-4 py-3">
          <input
            type="checkbox"
            className="h-5 w-5 rounded border-line text-brand-600 focus:ring-brand-200"
            {...register("isStudentSelf")}
          />
          <span className="text-sm font-bold text-ink-soft">학생 본인이 신청합니다</span>
        </label>

        {isStudentSelf && (
          <div className="space-y-5 border-t border-line pt-5">
            <Field label="출생년도" required hint="만 14세 미만은 보호자 정보가 필요합니다">
              <Select
                {...register("birthYear")}
                aria-invalid={errors.birthYear ? true : undefined}
                aria-describedby={errors.birthYear ? "consult-birthyear-error" : undefined}
              >
                <option value="">선택해 주세요</option>
                {birthYears.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </Select>
              <ErrorText id="consult-birthyear-error" message={errors.birthYear?.message} />
            </Field>

            {isMinor && (
              <div className="space-y-5 rounded-[var(--radius-panel)] border border-brand-100 bg-brand-50/50 p-5">
                <p className="m-0 text-xs font-bold text-brand-700">
                  만 14세 미만은 법정대리인(보호자) 정보와 동의가 필요합니다.
                </p>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="보호자 성명" required>
                    <Input
                      {...register("guardianName")}
                      placeholder="보호자 이름"
                      aria-invalid={errors.guardianName ? true : undefined}
                      aria-describedby={
                        errors.guardianName ? "consult-guardianname-error" : undefined
                      }
                    />
                    <ErrorText
                      id="consult-guardianname-error"
                      message={errors.guardianName?.message}
                    />
                  </Field>
                  <Field label="보호자 연락처" required>
                    <Controller
                      control={control}
                      name="guardianPhone"
                      render={({ field }) => (
                        <Input
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(formatPhone(e.target.value))}
                          onBlur={field.onBlur}
                          inputMode="numeric"
                          placeholder="010-1234-5678"
                          aria-invalid={errors.guardianPhone ? true : undefined}
                          aria-describedby={
                            errors.guardianPhone ? "consult-guardianphone-error" : undefined
                          }
                        />
                      )}
                    />
                    <ErrorText
                      id="consult-guardianphone-error"
                      message={errors.guardianPhone?.message}
                    />
                  </Field>
                </div>
                <label className="flex min-h-12 items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
                    {...register("guardianConsent")}
                    aria-invalid={errors.guardianConsent ? true : undefined}
                    aria-describedby={
                      errors.guardianConsent ? "consult-guardianconsent-error" : undefined
                    }
                  />
                  <span className="text-sm font-bold text-ink-soft">
                    법정대리인으로서 위 신청 및 아래 개인정보 처리에 동의합니다
                  </span>
                </label>
                <ErrorText
                  id="consult-guardianconsent-error"
                  message={errors.guardianConsent?.message}
                />
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── 04 동의 ──────────────────────────────────────────────── */}
      <Card className="p-6 md:p-8">
        <div className="mb-5">
          <StepHeading number="4" title="동의" />
        </div>
        <ConsentFields
          register={register}
          errors={errors}
          values={{
            termsConsent: values.termsConsent,
            privacyConsent: values.privacyConsent,
            overseasAiConsent: values.overseasAiConsent,
            marketingConsent: values.marketingConsent,
          }}
          onToggleAll={(checked) => {
            setValue("termsConsent", checked, { shouldValidate: checked });
            setValue("privacyConsent", checked, { shouldValidate: checked });
            setValue("overseasAiConsent", checked);
            setValue("marketingConsent", checked);
          }}
          idPrefix="consult"
          privacyLabel="상담 개인정보 처리 동의 (TUTOR OS 플랫폼 처리위탁 포함)"
          footnote={
            isStudentSelf && isMinor
              ? "만 14세 미만 학생의 동의는 위에서 확인한 법정대리인의 동의로 처리됩니다."
              : undefined
          }
        />
      </Card>

      {serverError && (
        <p
          role="alert"
          className="rounded-[var(--radius-panel)] border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
        >
          {serverError}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 text-xs leading-relaxed text-muted">
          신청만으로 시범수업·정규수업이 확정되지는 않습니다. 상담·일정 조율·결제 완료 후
          확정됩니다.
        </p>
        <button
          type="submit"
          disabled={submitState === "submitting"}
          className={buttonClass("primary", "lg", "w-full sm:w-auto")}
        >
          {submitState === "submitting" ? "접수 중..." : "상담 신청하기"}
        </button>
      </div>
    </form>
  );
}
