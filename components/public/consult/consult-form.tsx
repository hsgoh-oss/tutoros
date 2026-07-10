"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { submitConsult } from "@/lib/actions/consult";
import {
  BIRTH_YEAR_MAX,
  BIRTH_YEAR_MIN,
  FREQ_OPTIONS,
  HOURS_OPTIONS,
  SUBJECT_OPTIONS,
  consultFormSchema,
  isMinorBirthYear,
  type ConsultFormInput,
  type ConsultFormValues,
} from "@/components/public/consult/schema";

const CHECKLIST_STORAGE_KEY = "axiom-checklist";
const BIRTH_YEARS = Array.from(
  { length: BIRTH_YEAR_MAX - BIRTH_YEAR_MIN + 1 },
  (_, i) => BIRTH_YEAR_MAX - i,
);

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

export function ConsultForm({
  initialMode,
  initialHours,
  initialFreq,
  kakaoUrl,
}: {
  initialMode?: string;
  initialHours?: string;
  initialFreq?: string;
  kakaoUrl: string;
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
    formState: { errors },
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
      privacyConsent: false,
      marketingConsent: false,
      checklistItems: [],
    },
  });

  const isStudentSelf = watch("isStudentSelf");
  const birthYear = watch("birthYear");
  const checklistItems = watch("checklistItems");
  const isMinor = isStudentSelf && birthYear ? isMinorBirthYear(Number(birthYear)) : false;

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

  async function onSubmit(values: ConsultFormValues) {
    setSubmitState("submitting");
    setServerError(null);
    const result = await submitConsult(values);
    if (result.ok) {
      setSubmitState("success");
    } else {
      setSubmitState("idle");
      setServerError(result.error);
    }
  }

  if (submitState === "success") {
    return (
      <Card className="flex flex-col items-start gap-5 p-10">
        <p className="text-sm font-extrabold text-brand-600">접수 완료</p>
        <h3 className="text-2xl font-black tracking-tight text-ink">
          상담 신청이 접수되었습니다
        </h3>
        <p className="text-[15px] leading-[1.86] tracking-tight text-muted">
          확인 후 연락드립니다. 빠른 안내가 필요하시면 카카오톡으로도 문의해
          주세요.
        </p>
        <a
          href={kakaoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass("primary", "md")}
        >
          카카오톡 문의
        </a>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-10">
      <Card className="space-y-6 p-8">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="이름" required>
            <Input {...register("name")} placeholder="홍길동" />
            {errors.name && (
              <p className="mt-1.5 text-xs font-semibold text-rose-600">
                {errors.name.message}
              </p>
            )}
          </Field>

          <Field label="연락처" required hint="010-1234-5678">
            <Controller
              control={control}
              name="phone"
              render={({ field }) => (
                <Input
                  value={field.value}
                  onChange={(e) => field.onChange(formatPhone(e.target.value))}
                  onBlur={field.onBlur}
                  inputMode="numeric"
                  placeholder="010-1234-5678"
                />
              )}
            />
            {errors.phone && (
              <p className="mt-1.5 text-xs font-semibold text-rose-600">
                {errors.phone.message}
              </p>
            )}
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

          <Field label="수업 방식">
            <Select {...register("classType")}>
              <option value="unspecified">미정</option>
              <option value="inperson">대면</option>
              <option value="video">화상</option>
            </Select>
          </Field>

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

        <p className="rounded-panel bg-soft px-4 py-3 text-xs leading-relaxed text-muted">
          시범수업(1시간 5만 원)은 별도 CTA 없이 상담에서 안내드립니다.
        </p>

        {checklistItems.length > 0 && (
          <p className="text-xs font-semibold text-brand-600">
            자기진단에서 선택한 항목 {checklistItems.length}개가 함께
            전달됩니다.
          </p>
        )}
      </Card>

      <Card className="space-y-5 p-8">
        <label className="flex min-h-11 items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
            {...register("isStudentSelf")}
          />
          <span className="text-sm font-bold text-ink-soft">
            학생 본인이 신청합니다
          </span>
        </label>

        {isStudentSelf && (
          <div className="space-y-5 border-t border-line pt-5">
            <Field label="출생년도" required>
              <Select {...register("birthYear")}>
                <option value="">선택해 주세요</option>
                {BIRTH_YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </Select>
              {errors.birthYear && (
                <p className="mt-1.5 text-xs font-semibold text-rose-600">
                  {errors.birthYear.message}
                </p>
              )}
            </Field>

            {isMinor && (
              <div className="space-y-5 rounded-panel border border-brand-100 bg-brand-50/50 p-5">
                <p className="text-xs font-bold text-brand-700">
                  만 14세 미만은 법정대리인(보호자) 정보와 동의가 필요합니다.
                </p>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="보호자 성명" required>
                    <Input {...register("guardianName")} placeholder="보호자 이름" />
                    {errors.guardianName && (
                      <p className="mt-1.5 text-xs font-semibold text-rose-600">
                        {errors.guardianName.message}
                      </p>
                    )}
                  </Field>
                  <Field label="보호자 연락처" required hint="010-1234-5678">
                    <Controller
                      control={control}
                      name="guardianPhone"
                      render={({ field }) => (
                        <Input
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(formatPhone(e.target.value))
                          }
                          onBlur={field.onBlur}
                          inputMode="numeric"
                          placeholder="010-1234-5678"
                        />
                      )}
                    />
                    {errors.guardianPhone && (
                      <p className="mt-1.5 text-xs font-semibold text-rose-600">
                        {errors.guardianPhone.message}
                      </p>
                    )}
                  </Field>
                </div>
                <label className="flex min-h-11 items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
                    {...register("guardianConsent")}
                  />
                  <span className="text-sm font-bold text-ink-soft">
                    법정대리인으로서 위 신청 및 아래 개인정보 처리에
                    동의합니다
                  </span>
                </label>
                {errors.guardianConsent && (
                  <p className="text-xs font-semibold text-rose-600">
                    {errors.guardianConsent.message}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-3 border-t border-line pt-5">
          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
              {...register("privacyConsent")}
            />
            <span className="text-sm leading-relaxed text-ink-soft">
              [필수] 개인정보 수집·이용 동의 (TUTOR OS 플랫폼 처리위탁 및
              AI 처리 목적 가명화 국외이전 포함) — 법정대리인으로서
              동의합니다(보호자 신청 기준).{" "}
              <Link href="/privacy" className="font-bold text-brand-600 underline underline-offset-2">
                자세히 보기
              </Link>
            </span>
          </label>
          {errors.privacyConsent && (
            <p className="text-xs font-semibold text-rose-600">
              {errors.privacyConsent.message}
            </p>
          )}

          <label className="flex min-h-11 items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
              {...register("marketingConsent")}
            />
            <span className="text-sm leading-relaxed text-ink-soft">
              [선택] 마케팅·수업 안내 수신 동의
            </span>
          </label>
        </div>
      </Card>

      {serverError && (
        <p className="rounded-panel border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {serverError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitState === "submitting"}
        className={buttonClass("primary", "lg", "w-full md:w-auto")}
      >
        {submitState === "submitting" ? "접수 중..." : "상담 신청하기"}
      </button>
    </form>
  );
}
