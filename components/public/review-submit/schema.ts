import { z } from "zod";
import { kstTodayDateOnly } from "@/lib/kst";
import { CONSENT_COPY } from "@/lib/content/legal";

// 후기·성적 향상 사례 작성 폼 공용 스키마 — 클라이언트(react-hook-form resolver)와 서버 액션
// (app/w/[token]/actions.ts) 양쪽에서 동일하게 재검증한다(클라 우회 차단).
// 정본: docs/flow-canon/01_atlas_05_content_ops_privacy.md S-01(작성 요청·제출)·S-02(증빙).
//
// 상담 폼·신청폼(components/public/consult, intake)의 관례를 그대로 따른다:
//  · 필수 동의는 superRefine으로 검증한다(같은 오류 표시 경로).
//  · 전화번호는 같은 형식(010-1234-5678)만 받는다.
//  · <select>의 빈 값은 undefined로 정규화한다.
//
// 작성자 역할(authorRole)은 폼 필드가 아니다 — 초대(review_invitations.author_role)가 정하고
// 서버가 클라 값을 버리고 DB 값으로 덮어써서 검증한다(보호자 초대로 학생인 척 제출하는 우회 차단).
// 이미지 파일 자체와 이미지 공개 동의(imageConsent)는 FormData 층에 있어 서버가 따로 판정한다.

export const REVIEW_SUBMIT_KINDS = ["review", "case"] as const;
export type ReviewSubmitKind = (typeof REVIEW_SUBMIT_KINDS)[number];

export const AUTHOR_ROLES = ["student", "parent"] as const;
export type AuthorRole = (typeof AUTHOR_ROLES)[number];

export const AUTHOR_ROLE_LABEL: Record<AuthorRole, string> = {
  student: "학생 본인",
  parent: "보호자",
};

export const TRACK_OPTIONS = ["이과", "문과", "기타"] as const;
export const RATING_OPTIONS = ["5", "4", "3", "2", "1"] as const;

export const CONTENT_MIN = 20;
export const CONTENT_MAX = 2000;

const PHONE_REGEX = /^01[016789]-\d{3,4}-\d{4}$/;
const PHONE_MESSAGE = "010-1234-5678 형식으로 입력해 주세요.";

// 출생년도 선택 범위 — 상담 폼(consult/schema.ts birthYearRange)과 같은 상대값 규칙.
// 후기는 졸업생·재수생도 쓰므로 상단을 조금 더 연다.
const OLDEST_AGE = 30;
const YOUNGEST_AGE = 10;

export function reviewBirthYearOptions(): number[] {
  const currentYear = Number(kstTodayDateOnly().slice(0, 4));
  const max = currentYear - YOUNGEST_AGE;
  const min = currentYear - OLDEST_AGE;
  return Array.from({ length: max - min + 1 }, (_, i) => max - i);
}

// 미성년(만 19세 미만) 판별 — 만 나이 근사식: (현재 연도 − 출생 연도) < 20.
// 상담 폼의 만 14세 게이트(개인정보 수집 동의)와는 다른 기준이다: 여기서는 **게시** 동의라
// 민법상 미성년(만 19세 미만)이면 법정대리인 동의가 있어야 한다("미성년 게시: 확인된 법정대리인 동의").
const UNDER19_THRESHOLD = 20;

export function isUnder19BirthYear(birthYear: number): boolean {
  const currentYear = Number(kstTodayDateOnly().slice(0, 4));
  return currentYear - birthYear < UNDER19_THRESHOLD;
}

function optionalEnum<T extends readonly [string, ...string[]]>(options: T) {
  return z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(options).optional(),
  );
}

const optionalPhone = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);

export const reviewSubmitSchema = z
  .object({
    // 초대가 정한다 — 서버가 DB 값으로 덮어쓴다.
    authorRole: z.enum(AUTHOR_ROLES),

    /* ---------- ① 작성자 확인 ---------- */
    relationConfirmed: z.boolean(),
    studentBirthYear: z.string().optional(),

    /* ---------- ② 종류 ---------- */
    kind: z.enum(REVIEW_SUBMIT_KINDS, { message: "후기 또는 성적 향상 사례를 선택해 주세요." }),

    /* ---------- ③ 내용 ---------- */
    grade: z.string().trim().min(1, "학년/구분을 입력해 주세요.").max(30),
    track: optionalEnum(TRACK_OPTIONS),
    rating: z.string().optional(),
    content: z.string().trim().max(CONTENT_MAX, `${CONTENT_MAX}자 이내로 적어 주세요.`),
    beforeLabel: z.string().trim().max(40).optional(),
    beforeGrade: z.string().trim().max(20).optional(),
    afterLabel: z.string().trim().max(40).optional(),
    afterGrade: z.string().trim().max(20).optional(),

    /* ---------- 미성년 — 학생 본인 작성 시 법정대리인 ---------- */
    guardianName: z.string().trim().max(50).optional(),
    guardianPhone: optionalPhone,

    /* ---------- ⑤ 동의 ---------- */
    termsConsent: z.boolean(),
    privacyConsent: z.boolean(),
    publishConsent: z.boolean(),
    guardianConsent: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (!data.relationConfirmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["relationConfirmed"],
        message: "작성자 본인과 학생의 관계를 확인해 주세요.",
      });
    }

    if (!data.studentBirthYear) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studentBirthYear"],
        message: "학생 출생년도를 선택해 주세요.",
      });
    }

    const trimmed = data.content.trim();
    if (trimmed.length < CONTENT_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: `${CONTENT_MIN}자 이상 적어 주세요.`,
      });
    }

    if (data.kind === "review") {
      const r = Number(data.rating);
      if (!data.rating || !Number.isInteger(r) || r < 1 || r > 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rating"],
          message: "만족도를 선택해 주세요.",
        });
      }
    }

    if (data.kind === "case") {
      const fields: [keyof typeof data, string][] = [
        ["beforeLabel", "이전 시험을 입력해 주세요. (예: 고1 2학기 내신)"],
        ["beforeGrade", "이전 등급을 입력해 주세요. (예: 2등급)"],
        ["afterLabel", "이후 시험을 입력해 주세요. (예: 고2 1학기 내신)"],
        ["afterGrade", "이후 등급을 입력해 주세요. (예: 1등급)"],
      ];
      for (const [key, message] of fields) {
        const value = data[key];
        if (typeof value !== "string" || !value.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });
        }
      }
    }

    if (!data.termsConsent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["termsConsent"],
        message: "이용약관 동의는 필수입니다.",
      });
    }
    if (!data.privacyConsent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["privacyConsent"],
        message: "개인정보 수집·이용 동의는 필수입니다.",
      });
    }
    // 건별 선택 동의 — 그러나 이 폼의 목적이 공개용 제출이라 동의 없이는 제출이 성립하지 않는다.
    // (약관 제13조 · CONSENT_COPY.publicationIntro) 거절은 "제출하지 않음"으로 표현된다.
    if (!data.publishConsent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publishConsent"],
        message:
          "공개에 동의하지 않으면 제출할 수 없습니다. 공개를 원하지 않으시면 제출하지 않으셔도 됩니다.",
      });
    }

    const minor = data.studentBirthYear
      ? isUnder19BirthYear(Number(data.studentBirthYear))
      : false;
    if (!minor) return;

    if (!data.guardianConsent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guardianConsent"],
        message: "미성년 학생의 게시에는 법정대리인 동의가 필요합니다.",
      });
    }
    // 학생 본인이 쓰는 경우에만 법정대리인이 누구인지 받는다 — 보호자가 쓰면 작성자가 곧 법정대리인이다.
    if (data.authorRole !== "student") return;
    if (!data.guardianName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guardianName"],
        message: "법정대리인(보호자) 성명을 입력해 주세요.",
      });
    }
    if (!data.guardianPhone || !PHONE_REGEX.test(data.guardianPhone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guardianPhone"],
        message: PHONE_MESSAGE,
      });
    }
  });

// preprocess(빈 문자열→undefined) 때문에 입력·출력 타입이 다르다 —
// useForm<Input, Context, Output> 3-제네릭에 각각 물린다(상담 폼과 같은 구조).
export type ReviewSubmitInput = z.input<typeof reviewSubmitSchema>;
export type ReviewSubmitValues = z.output<typeof reviewSubmitSchema>;

/* ---------- 이미지 ---------- */

export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
export const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

/* ---------- 동의 문구 — 정본(lib/content/legal.ts)에서 가져온다. 새 문장을 만들지 않는다 ---------- */

export const REVIEW_CONSENT_COPY = {
  intro: CONSENT_COPY.publicationIntro,
  terms: CONSENT_COPY.termsRequired,
  privacy: CONSENT_COPY.privacyRequired,
  publication: CONSENT_COPY.publication,
  image: CONSENT_COPY.publicationImage,
  guardian: CONSENT_COPY.legalGuardian,
} as const;

/* ---------- FormData 필드명 — 클라(폼 조립)와 서버(파싱)가 같은 이름을 쓴다 ---------- */

export const REVIEW_FORM_FIELDS = {
  relationConfirmed: "relationConfirmed",
  studentBirthYear: "studentBirthYear",
  kind: "kind",
  grade: "grade",
  track: "track",
  rating: "rating",
  content: "content",
  beforeLabel: "beforeLabel",
  beforeGrade: "beforeGrade",
  afterLabel: "afterLabel",
  afterGrade: "afterGrade",
  guardianName: "guardianName",
  guardianPhone: "guardianPhone",
  termsConsent: "termsConsent",
  privacyConsent: "privacyConsent",
  publishConsent: "publishConsent",
  guardianConsent: "guardianConsent",
  /** 체크박스 — "on"이면 동의. 이미지가 하나라도 있으면 필수(서버 판정). */
  imageConsent: "imageConsent",
  /** 새 이미지 파일(복수). */
  images: "images",
  /** 수정 제출 시 삭제할 기존 이미지(저장 원문 값, 복수). */
  removeImages: "removeImages",
} as const;

/** 값 객체 → FormData(파일 제외). 클라·서버가 같은 직렬화 규약을 쓴다: boolean은 "on"/"" 문자열. */
export function appendReviewValues(formData: FormData, values: ReviewSubmitInput): void {
  const f = REVIEW_FORM_FIELDS;
  const bool = (v: boolean | undefined) => (v ? "on" : "");
  formData.set(f.relationConfirmed, bool(values.relationConfirmed));
  formData.set(f.studentBirthYear, values.studentBirthYear ?? "");
  formData.set(f.kind, values.kind ?? "");
  formData.set(f.grade, values.grade ?? "");
  formData.set(f.track, typeof values.track === "string" ? values.track : "");
  formData.set(f.rating, values.rating ?? "");
  formData.set(f.content, values.content ?? "");
  formData.set(f.beforeLabel, values.beforeLabel ?? "");
  formData.set(f.beforeGrade, values.beforeGrade ?? "");
  formData.set(f.afterLabel, values.afterLabel ?? "");
  formData.set(f.afterGrade, values.afterGrade ?? "");
  formData.set(f.guardianName, values.guardianName ?? "");
  formData.set(
    f.guardianPhone,
    typeof values.guardianPhone === "string" ? values.guardianPhone : "",
  );
  formData.set(f.termsConsent, bool(values.termsConsent));
  formData.set(f.privacyConsent, bool(values.privacyConsent));
  formData.set(f.publishConsent, bool(values.publishConsent));
  formData.set(f.guardianConsent, bool(values.guardianConsent));
}

/** FormData → 스키마 입력(파일 제외). authorRole은 호출부(서버)가 초대에서 넣는다. */
export function readReviewValues(
  formData: FormData,
  authorRole: AuthorRole,
): ReviewSubmitInput {
  const f = REVIEW_FORM_FIELDS;
  const str = (key: string) => String(formData.get(key) ?? "");
  const bool = (key: string) => formData.get(key) === "on";
  return {
    authorRole,
    relationConfirmed: bool(f.relationConfirmed),
    studentBirthYear: str(f.studentBirthYear),
    kind: str(f.kind) as ReviewSubmitKind,
    grade: str(f.grade),
    track: str(f.track),
    rating: str(f.rating),
    content: str(f.content),
    beforeLabel: str(f.beforeLabel),
    beforeGrade: str(f.beforeGrade),
    afterLabel: str(f.afterLabel),
    afterGrade: str(f.afterGrade),
    guardianName: str(f.guardianName),
    guardianPhone: str(f.guardianPhone),
    termsConsent: bool(f.termsConsent),
    privacyConsent: bool(f.privacyConsent),
    publishConsent: bool(f.publishConsent),
    guardianConsent: bool(f.guardianConsent),
  };
}
