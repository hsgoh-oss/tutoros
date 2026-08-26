import { z } from "zod";
import { kstTodayDateOnly } from "@/lib/kst";

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

// 학생 본인 신청 시 출생년도 선택 범위 — 만 나이 기준 상대값으로 잡는다.
// 연도를 고정하면 해가 바뀔 때 실제 대상 학생이 자기 생년을 못 고르게 되고,
// 그러면 만 14세 게이트(isMinorBirthYear)가 아예 발동하지 못한다.
const OLDEST_AGE = 21; // 재수·N수 상단
const YOUNGEST_AGE = 10; // 만 14세 미만 판별이 가능하도록 충분히 낮게

export function birthYearRange(): { min: number; max: number } {
  const currentYear = Number(kstTodayDateOnly().slice(0, 4));
  return { min: currentYear - OLDEST_AGE, max: currentYear - YOUNGEST_AGE };
}

/** <select> 옵션용 — 최신 연도부터 내림차순. */
export function birthYearOptions(): number[] {
  const { min, max } = birthYearRange();
  return Array.from({ length: max - min + 1 }, (_, i) => max - i);
}

const PHONE_REGEX = /^01[016789]-\d{3,4}-\d{4}$/;

// 만 14세 미만 판별 — 만 나이 근사식: (현재 연도 − 출생 연도) < 15.
// ⚠️ 기존엔 기획서 확정판 고정값 AGE_REFERENCE_YEAR=2026을 사용했으나, 2027년부터
//    미성년 판별이 틀어지는 시한폭탄이라 "현재 연도" 기준 동적 계산으로 교체했다.
//    법정대리인 동의 게이트라 최신성이 곧 정확성이다. 판별 시점마다 재평가되도록
//    상수 캡처가 아닌 함수 내부에서 new Date()를 읽는다.
//    (기획서 "2026 고정" 문구와 상충 — 갑 확정/CR 대상. 확정 시 이 주석 갱신.)
const MINOR_AGE_THRESHOLD = 15;

export function isMinorBirthYear(birthYear: number): boolean {
  const currentYear = Number(kstTodayDateOnly().slice(0, 4));
  return currentYear - birthYear < MINOR_AGE_THRESHOLD;
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
