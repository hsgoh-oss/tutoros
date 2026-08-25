import { z } from "zod";
import {
  FREQ_OPTIONS,
  HOURS_OPTIONS,
  SUBJECT_OPTIONS,
} from "@/components/public/consult/schema";

// 신청폼(시범·정규) 공용 스키마 — 클라이언트(react-hook-form resolver)와 서버 액션
// (app/f/[token]/actions.ts) 양쪽에서 동일하게 재검증한다(클라 우회 차단).
// 정본: docs/flow-canon/01_atlas_01_intake.md T-01(시범 신청폼)·R-01(정규 신청폼)·R-02(관계 확인).
//
// 상담 폼(components/public/consult/schema.ts)의 관례를 그대로 따른다:
//  · 선택지 상수(과목·회당 시간·주당 횟수)는 그 파일에서 가져온다 — 두 폼이 다른 값을 쓰면
//    상담에서 받은 희망 조건과 신청서의 희망 조건을 나란히 놓을 수 없다.
//  · 필수 동의는 z.literal(true)가 아니라 superRefine으로 검증한다(같은 오류 표시 경로).
//  · 전화번호는 같은 형식(010-1234-5678)만 받는다.
//
// 종류(kind)는 폼 자체의 속성이지 신청자가 고르는 값이 아니다 — 서버는 클라가 보낸 kind를
// 버리고 DB의 intake_forms.kind로 덮어써서 이 스키마에 넣는다(정규 폼에 시범 폼 모양으로
// 제출해 관계·수업조건 검증을 건너뛰는 우회를 막는다).

export const INTAKE_KINDS = ["trial", "regular"] as const;
export type IntakeKind = (typeof INTAKE_KINDS)[number];

export const CLASS_TYPE_OPTIONS = ["inperson", "video", "unspecified"] as const;

export const CLASS_TYPE_LABEL: Record<
  (typeof CLASS_TYPE_OPTIONS)[number],
  string
> = {
  inperson: "대면",
  video: "화상",
  unspecified: "미정",
};

// components/public/consult/schema.ts의 PHONE_REGEX와 같은 형식. 그 파일이 export하지 않아
// 여기 다시 둔다(그 파일은 이 작업의 소유 밖이라 export를 추가하지 않는다) — 형식이 갈라지면
// 상담에서 받은 번호와 신청서에서 받은 번호를 같은 사람으로 대조할 수 없으므로 반드시 일치시킬 것.
const PHONE_REGEX = /^01[016789]-\d{3,4}-\d{4}$/;
const PHONE_MESSAGE = "010-1234-5678 형식으로 입력해 주세요.";

// <select>의 "선택 안 함"은 빈 문자열로 제출된다 — enum 검증 전에 undefined로 정규화한다
// (상담 폼 optionalEnum과 같은 처리). 정규 폼에서의 필수 여부는 아래 superRefine이 판정한다.
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

export const intakeFormSchema = z
  .object({
    // 폼 종류 — 서버가 DB 값으로 덮어쓴다(클라 입력은 신뢰하지 않는다).
    kind: z.enum(INTAKE_KINDS),

    /* ---------- 공통(시범·정규) — T-01 ---------- */
    studentName: z.string().trim().min(1, "학생 이름을 입력해 주세요.").max(50),
    grade: z.string().trim().min(1, "학년을 입력해 주세요.").max(30),
    subject: z.enum(SUBJECT_OPTIONS, { message: "과목을 선택해 주세요." }),
    // 희망 일정은 자유 텍스트다(T-01) — 이 단계에서 달력을 강제하면 "폼 제출 = 일정 확정"으로
    // 읽히기 쉽다. 실제 확정은 운영자와의 합의 뒤 trial_sessions에서 일어난다(검수 8).
    preferredSchedule: z
      .string()
      .trim()
      .min(1, "희망 일정을 입력해 주세요.")
      .max(500),
    contactPhone: z.string().regex(PHONE_REGEX, PHONE_MESSAGE),
    note: z.string().trim().max(2000).optional(),

    /* ---------- 정규 전용 — R-01·R-02 ---------- */
    // 학생 본인 연락처(선택) — 미성년 학생은 없을 수 있어 비워 둘 수 있다.
    studentPhone: optionalPhone,
    guardianName: z.string().trim().max(50).optional(),
    guardianPhone: optionalPhone,
    // 계약자·납부자는 "보호자와 동일 / 계약자와 동일" 체크로 관계를 표현한다.
    // 체크가 곧 근거다 — 같은 사람이면 한 사람에게 두 역할을 연결하고, 다르면 각각 받는다(R-02).
    contractorSameAsGuardian: z.boolean(),
    contractorName: z.string().trim().max(50).optional(),
    contractorPhone: optionalPhone,
    payerSameAsContractor: z.boolean(),
    payerName: z.string().trim().max(50).optional(),
    payerPhone: optionalPhone,
    // 수업 조건 희망 — 계약 조건 스냅샷(contracts.terms)의 출발점이지만 확정은 아니다.
    hours: optionalEnum(HOURS_OPTIONS),
    freq: optionalEnum(FREQ_OPTIONS),
    classType: z.enum(CLASS_TYPE_OPTIONS),

    /* ---------- 동의 ---------- */
    privacyConsent: z.boolean(),
    marketingConsent: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (!data.privacyConsent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["privacyConsent"],
        message: "개인정보 수집·이용 동의는 필수입니다.",
      });
    }

    if (data.studentPhone && !PHONE_REGEX.test(data.studentPhone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studentPhone"],
        message: PHONE_MESSAGE,
      });
    }

    // 여기부터는 정규 폼에서만 요구한다 — 시범 폼은 관계·수업조건을 묻지 않는다(T-01).
    if (data.kind !== "regular") return;

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
        message: PHONE_MESSAGE,
      });
    }

    // "동일" 체크를 풀었으면 그 역할의 사람을 실제로 받아야 한다 — 이름만 있고 연락처가 없으면
    // 계약·청구 연락 경로가 비어 등록 준비에서 다시 막힌다(R-02 "관계 불명확 → 활성화 보류").
    if (!data.contractorSameAsGuardian) {
      if (!data.contractorName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contractorName"],
          message: "계약자 성명을 입력해 주세요.",
        });
      }
      if (!data.contractorPhone || !PHONE_REGEX.test(data.contractorPhone)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contractorPhone"],
          message: PHONE_MESSAGE,
        });
      }
    }
    if (!data.payerSameAsContractor) {
      if (!data.payerName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payerName"],
          message: "납부자 성명을 입력해 주세요.",
        });
      }
      if (!data.payerPhone || !PHONE_REGEX.test(data.payerPhone)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payerPhone"],
          message: PHONE_MESSAGE,
        });
      }
    }

    if (!data.hours) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hours"],
        message: "희망 회당 시간을 선택해 주세요.",
      });
    }
    if (!data.freq) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["freq"],
        message: "희망 주당 횟수를 선택해 주세요.",
      });
    }
  });

// preprocess(빈 문자열→undefined) 때문에 입력·출력 타입이 다르다 —
// useForm<Input, Context, Output> 3-제네릭에 각각 물린다(상담 폼과 같은 구조).
export type IntakeFormInput = z.input<typeof intakeFormSchema>;
export type IntakeFormValues = z.output<typeof intakeFormSchema>;

/* ---------- payload 스냅샷 ---------- */

interface PersonSnapshot {
  name: string;
  phone: string;
}

/**
 * intake_forms.payload에 저장할 제출 스냅샷.
 *
 * 제출 시각의 답변을 그대로 보존한다 — 이후 학생·등록 행이 바뀌어도 "무엇을 보고 승인했는지"가
 * 남아야 하기 때문이다(00018 payload 주석 · R-01 운영자 검토의 근거).
 * 동의도 여기 함께 남긴다: 제출과 동의가 한 UPDATE에 실려 "동의 없는 제출"이 원천적으로 없다.
 */
export interface IntakePayload {
  kind: IntakeKind;
  student: {
    name: string;
    grade: string;
    subject: string;
    /** 학생 본인 연락처(정규 폼 선택 입력) — 없으면 null. */
    phone: string | null;
  };
  /** 연락 받을 번호(신청 주체). 학생 본인 번호와 다를 수 있다. */
  contactPhone: string;
  preferredSchedule: string;
  note: string | null;
  /** 정규 폼에서만 수집한다(R-02). 시범 폼은 null. */
  relations: {
    guardian: PersonSnapshot;
    contractor: PersonSnapshot & { sameAsGuardian: boolean };
    payer: PersonSnapshot & { sameAsContractor: boolean };
  } | null;
  /** 수업 조건 "희망"이다 — 확정 조건이 아니다(계약은 R-03에서 따로 동의한다). 시범 폼은 null. */
  lessonPreference: {
    hours: string;
    freq: string;
    classType: (typeof CLASS_TYPE_OPTIONS)[number];
  } | null;
  consents: {
    privacy: true;
    /** 필수 동의 문구에 'AI 처리 목적 가명화 국외이전'이 포함된다(상담 폼과 같은 문구). */
    overseasAi: true;
    marketing: boolean;
    policyVersion: string;
    consentedAt: string;
  };
}

/**
 * 검증을 통과한 입력 → 저장 스냅샷.
 *
 * "동일" 체크는 플래그로 남기되 이름·연락처는 실제 값으로 채운다 — 운영자가 계약자·납부자를
 * 보려고 다시 보호자 칸을 되짚지 않아도 되고, 나중에 관계가 갈라져도 "제출 시점엔 같은
 * 사람이었다"는 근거가 남는다(R-02 "보호자와 납부자가 같음 → 두 역할을 한 사람에게 연결").
 */
export function buildIntakePayload(
  values: IntakeFormValues,
  meta: { policyVersion: string; consentedAt: string },
): IntakePayload {
  const isRegular = values.kind === "regular";

  const guardian: PersonSnapshot = {
    name: values.guardianName?.trim() ?? "",
    phone: values.guardianPhone ?? "",
  };
  const contractor = values.contractorSameAsGuardian
    ? { ...guardian }
    : {
        name: values.contractorName?.trim() ?? "",
        phone: values.contractorPhone ?? "",
      };
  const payer = values.payerSameAsContractor
    ? { ...contractor }
    : {
        name: values.payerName?.trim() ?? "",
        phone: values.payerPhone ?? "",
      };

  return {
    kind: values.kind,
    student: {
      name: values.studentName,
      grade: values.grade,
      subject: values.subject,
      phone: values.studentPhone ?? null,
    },
    contactPhone: values.contactPhone,
    preferredSchedule: values.preferredSchedule,
    note: values.note?.trim() ? values.note.trim() : null,
    relations: isRegular
      ? {
          guardian,
          contractor: {
            ...contractor,
            sameAsGuardian: values.contractorSameAsGuardian,
          },
          payer: {
            ...payer,
            sameAsContractor: values.payerSameAsContractor,
          },
        }
      : null,
    lessonPreference:
      isRegular && values.hours && values.freq
        ? {
            hours: values.hours,
            freq: values.freq,
            classType: values.classType,
          }
        : null,
    consents: {
      privacy: true,
      overseasAi: true,
      marketing: values.marketingConsent,
      policyVersion: meta.policyVersion,
      consentedAt: meta.consentedAt,
    },
  };
}
