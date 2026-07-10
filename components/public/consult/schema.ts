import { z } from "zod";

// 상담 폼 공용 스키마 — 클라이언트(react-hook-form resolver)와 서버 액션(lib/actions/consult.ts)
// 양쪽에서 동일하게 재검증한다(클라 우회 차단).

export const SUBJECT_OPTIONS = ["내신", "수능", "수리논술", "기타"] as const;
export const HOURS_OPTIONS = [
  "2",
  "2.5",
  "3",
  "3.5",
  "4",
  "4.5",
  "5",
  "5.5",
  "6",
] as const;
export const FREQ_OPTIONS = ["1", "2", "3", "4", "5", "6", "7"] as const;

// 학생 본인 신청 시 출생년도 선택 범위 (기획 고정)
export const BIRTH_YEAR_MIN = 2005;
export const BIRTH_YEAR_MAX = 2016;

const PHONE_REGEX = /^01[016789]-\d{3,4}-\d{4}$/;

// 기획서 확정판 고정값 — 2026년 기준 만 14세 미만 판별(= (2026 − 생년) < 15). 변경 시 CR 필요.
const AGE_REFERENCE_YEAR = 2026;
const MINOR_AGE_THRESHOLD = 15;

export function isMinorBirthYear(birthYear: number): boolean {
  return AGE_REFERENCE_YEAR - birthYear < MINOR_AGE_THRESHOLD;
}

// <select>의 "선택 안 함" 옵션은 빈 문자열로 제출된다 — enum 검증 전에 undefined로 정규화.
function optionalEnum<T extends readonly [string, ...string[]]>(options: T) {
  return z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(options).optional(),
  );
}

export const consultFormSchema = z
  .object({
    name: z.string().trim().min(1, "이름을 입력해 주세요."),
    phone: z
      .string()
      .regex(PHONE_REGEX, "010-1234-5678 형식으로 입력해 주세요."),
    subject: optionalEnum(SUBJECT_OPTIONS),
    classType: z.enum(["inperson", "video", "unspecified"]),
    hours: optionalEnum(HOURS_OPTIONS),
    freq: optionalEnum(FREQ_OPTIONS),
    message: z.string().trim().max(2000).optional(),
    isStudentSelf: z.boolean(),
    birthYear: z.string().optional(),
    guardianName: z.string().trim().optional(),
    guardianPhone: z.string().optional(),
    guardianConsent: z.boolean(),
    privacyConsent: z.boolean(),
    marketingConsent: z.boolean(),
    checklistItems: z.array(z.string()),
  })
  .superRefine((data, ctx) => {
    if (!data.privacyConsent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["privacyConsent"],
        message: "개인정보 수집·이용 동의는 필수입니다.",
      });
    }

    if (!data.isStudentSelf) return;

    if (!data.birthYear) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["birthYear"],
        message: "출생년도를 선택해 주세요.",
      });
      return;
    }

    if (!isMinorBirthYear(Number(data.birthYear))) return;

    if (!data.guardianName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guardianName"],
        message: "보호자 성명을 입력해 주세요.",
      });
    }
    if (!data.guardianPhone || !PHONE_REGEX.test(data.guardianPhone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guardianPhone"],
        message: "보호자 연락처를 010-1234-5678 형식으로 입력해 주세요.",
      });
    }
    if (!data.guardianConsent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guardianConsent"],
        message: "법정대리인 동의가 필요합니다.",
      });
    }
  });

// preprocess(빈 문자열→undefined) 때문에 입력·출력 타입이 다르다 —
// useForm<Input, Context, Output> 3-제네릭에 각각 물린다.
export type ConsultFormInput = z.input<typeof consultFormSchema>;
export type ConsultFormValues = z.output<typeof consultFormSchema>;
