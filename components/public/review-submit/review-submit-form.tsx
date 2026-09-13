"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import {
  AUTHOR_ROLE_LABEL,
  CONTENT_MAX,
  CONTENT_MIN,
  IMAGE_ACCEPT,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  RATING_OPTIONS,
  REVIEW_CONSENT_COPY,
  REVIEW_FORM_FIELDS,
  TRACK_OPTIONS,
  appendReviewValues,
  isUnder19BirthYear,
  reviewBirthYearOptions,
  reviewSubmitSchema,
  type AuthorRole,
  type ReviewSubmitInput,
  type ReviewSubmitKind,
  type ReviewSubmitValues,
} from "@/components/public/review-submit/schema";
import { submitReviewForm } from "@/app/w/[token]/actions";

// 후기·성적 향상 사례 작성 화면(공개) — S-01.
// 상담 폼·신청폼(components/public/consult, intake)의 구조·동의·오류 표시 관례를 그대로 따른다.
//
// 한 화면에서 후기와 사례 둘 중 하나를 고른다(정본 "후기 또는 성적사례 선택"). 역할(학생/보호자)은
// 초대가 정하며 화면에서 바꿀 수 없다 — 서버도 클라가 보낸 역할을 버리고 DB 값으로 재검증한다.
// 파일이 있으므로 제출은 JSON이 아니라 FormData로 나간다(appendReviewValues + 파일).

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
    <p id={id} role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">
      {message}
    </p>
  );
}

const CHECKBOX_CLASS =
  "mt-1 h-4 w-4 shrink-0 rounded border-line text-brand-600 focus:ring-brand-200";

export interface ExistingImageView {
  /** DB 저장 원문 — 삭제 체크박스 값으로 그대로 보낸다(서버가 행의 항목과 대조한다). */
  stored: string;
  /** 표시용 만료 서명 URL. 발급 실패 시 null. */
  displayUrl: string | null;
}

export interface ExistingReview {
  kind: ReviewSubmitKind;
  grade: string | null;
  track: string | null;
  rating: number;
  content: string;
  beforeLabel: string | null;
  beforeGrade: string | null;
  afterLabel: string | null;
  afterGrade: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  /** 담당 선생님의 수정 요청 사유 — 있으면 상단에 보여 준다. */
  revisionNote: string | null;
  images: ExistingImageView[];
}

const KIND_CARDS: { value: ReviewSubmitKind; title: string; desc: string }[] = [
  {
    value: "review",
    title: "후기",
    desc: "수업을 들으며 느낀 점을 만족도와 함께 남깁니다.",
  },
  {
    value: "case",
    title: "성적 향상 사례",
    desc: "수업 전·후의 시험과 등급 변화를 근거와 함께 남깁니다.",
  },
];

export function ReviewSubmitForm({
  token,
  invitation,
  existing,
}: {
  /** 링크 원문 토큰 — 제출 시 서버가 해시해 초대를 다시 찾는다(초대 id는 화면에 두지 않는다). */
  token: string;
  invitation: { studentName: string; authorRole: AuthorRole; authorName: string };
  /** 수정 요청 재제출이면 기존 본. 신규 작성이면 null. */
  existing: ExistingReview | null;
}) {
  const [submitState, setSubmitState] = useState<"idle" | "submitting" | "success">("idle");
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [imageConsent, setImageConsent] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const isParent = invitation.authorRole === "parent";
  const roleLabel = AUTHOR_ROLE_LABEL[invitation.authorRole];

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ReviewSubmitInput, unknown, ReviewSubmitValues>({
    resolver: zodResolver(reviewSubmitSchema),
    defaultValues: {
      authorRole: invitation.authorRole,
      relationConfirmed: false,
      studentBirthYear: "",
      kind: existing?.kind ?? "review",
      grade: existing?.grade ?? "",
      track: existing?.track ?? "",
      rating: existing ? String(existing.rating) : "5",
      content: existing?.content ?? "",
      beforeLabel: existing?.beforeLabel ?? "",
      beforeGrade: existing?.beforeGrade ?? "",
      afterLabel: existing?.afterLabel ?? "",
      afterGrade: existing?.afterGrade ?? "",
      guardianName: existing?.guardianName ?? "",
      guardianPhone: existing?.guardianPhone ?? "",
      termsConsent: false,
      privacyConsent: false,
      publishConsent: false,
      guardianConsent: false,
    },
  });

  const kind = watch("kind");
  const birthYear = watch("studentBirthYear");
  const content = watch("content") ?? "";
  const isMinor = birthYear ? isUnder19BirthYear(Number(birthYear)) : false;
  const birthYears = reviewBirthYearOptions();

  const keptExisting = (existing?.images ?? []).filter((v) => !removed.has(v.stored));
  const hasImages = keptExisting.length + files.length > 0;

  // 잘못된 선택은 input 값까지 비운다 — 상태만 비우면 같은 파일을 다시 골라도 change가 안 난다.
  function onFilesChange(input: HTMLInputElement) {
    setImageError(null);
    const next = input.files ? Array.from(input.files) : [];
    if (keptExisting.length + next.length > MAX_IMAGES) {
      setImageError(`이미지는 최대 ${MAX_IMAGES}장까지 올릴 수 있습니다.`);
      setFiles([]);
      input.value = "";
      return;
    }
    if (next.some((f) => f.size > MAX_IMAGE_BYTES)) {
      setImageError("10MB를 넘는 이미지가 있습니다. 용량을 줄여 다시 선택해 주세요.");
      setFiles([]);
      input.value = "";
      return;
    }
    setFiles(next);
  }

  function toggleRemoved(stored: string, checked: boolean) {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (checked) next.add(stored);
      else next.delete(stored);
      return next;
    });
  }

  async function onSubmit(values: ReviewSubmitValues) {
    // 이미지 공개 동의는 스키마 밖(파일이 FormData에 있다) — 여기서 먼저 막고 서버가 다시 판정한다.
    if (hasImages && !imageConsent) {
      setImageError("이미지를 첨부하셨다면 이미지 공개 동의를 확인해 주세요.");
      return;
    }
    setSubmitState("submitting");
    setServerError(null);
    try {
      const formData = new FormData();
      appendReviewValues(formData, values);
      formData.set(REVIEW_FORM_FIELDS.imageConsent, imageConsent ? "on" : "");
      for (const file of files) formData.append(REVIEW_FORM_FIELDS.images, file);
      for (const stored of removed) formData.append(REVIEW_FORM_FIELDS.removeImages, stored);

      const result = await submitReviewForm(token, formData);
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
      <Card role="status" aria-live="polite" className="flex flex-col items-start gap-5 p-8 md:p-10">
        <p className="text-sm font-extrabold text-brand-600">제출 완료</p>
        <h2 className="text-2xl font-black tracking-tight text-ink">
          제출되었습니다. 검토 후 게시 여부를 안내드립니다
        </h2>
        {alreadySubmitted && (
          // 중복 제출은 최초 제출 결과로 수렴한다 — 내용을 덮어쓰지 않는다.
          <p className="rounded-panel bg-soft px-4 py-3 text-sm font-semibold leading-relaxed text-ink-soft">
            이미 제출되었습니다. 먼저 제출하신 내용으로 검토가 진행되며, 이번 작성 내용은
            저장되지 않았습니다. 수정이 필요하시면 담당 선생님께 말씀해 주세요.
          </p>
        )}
        {/* S-01 자동 게시 금지 — 제출은 게시가 아니다. 성공 화면에서 명시한다. */}
        <p className="text-[15px] leading-[1.86] tracking-tight text-muted">
          제출만으로 공개되지는 않습니다. 담당 선생님이 개인정보·표현·사실 근거를 확인한 뒤
          게시 여부를 정하며, 게시되면 학생 이름은 일부 가린 형태로만 표시됩니다. 게시 후에도
          언제든 공개 철회를 요청하실 수 있습니다.
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-8">
      {existing?.revisionNote && (
        <p
          role="status"
          className="rounded-panel border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800"
        >
          <span className="font-extrabold">담당 선생님의 수정 요청:</span> {existing.revisionNote}
          <span className="mt-1.5 block text-xs font-bold text-amber-700">
            내용은 채워져 있습니다. 관계 확인·출생년도·동의는 이번 제출에 대해 다시 체크해 주세요.
          </span>
        </p>
      )}

      {/* ① 작성자 확인 — 본인·대상 관계(S-01 "작성자 본인·대상 관계 확인") */}
      <Card className="space-y-6 p-6 md:p-8">
        <div>
          <h2 className="text-lg font-black tracking-tight text-ink">
            {existing ? "후기·사례 수정" : "후기·사례 작성"}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {invitation.authorName}님, {invitation.studentName} 학생의 {roleLabel}으로 초대되셨습니다.
            아래 내용을 작성해 주시면 담당 선생님이 확인 후 게시 여부를 안내드립니다.
          </p>
        </div>

        <label className="flex min-h-12 items-start gap-3">
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            {...register("relationConfirmed")}
            aria-invalid={errors.relationConfirmed ? true : undefined}
            aria-describedby={errors.relationConfirmed ? "rs-relation-error" : undefined}
          />
          <span className="text-sm font-bold leading-relaxed text-ink-soft">
            {invitation.studentName} 학생의 {roleLabel}으로서 작성합니다. 다른 학생의 수업이나
            결과를 대신 적지 않습니다.
          </span>
        </label>
        <ErrorText id="rs-relation-error" message={errors.relationConfirmed?.message} />

        <Field
          label="학생 출생년도"
          required
          hint="미성년(만 19세 미만) 학생의 게시에는 법정대리인 동의가 필요해 확인합니다. 공개하지 않습니다."
        >
          <Select
            {...register("studentBirthYear")}
            aria-invalid={errors.studentBirthYear ? true : undefined}
            aria-describedby={errors.studentBirthYear ? "rs-birthyear-error" : undefined}
          >
            <option value="">선택해 주세요</option>
            {birthYears.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </Select>
          <ErrorText id="rs-birthyear-error" message={errors.studentBirthYear?.message} />
        </Field>
      </Card>

      {/* ② 종류 선택 — 정본 "후기 또는 성적사례 선택" */}
      <Card className="space-y-4 p-6 md:p-8">
        <fieldset>
          <legend className="text-lg font-black tracking-tight text-ink">무엇을 남기시겠어요?</legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {KIND_CARDS.map((card) => {
              const selected = kind === card.value;
              return (
                <label
                  key={card.value}
                  className={cn(
                    "flex min-h-[var(--ui-h-md)] cursor-pointer items-start gap-3 rounded-panel border p-4 transition-colors",
                    selected
                      ? "border-brand-600 bg-brand-50"
                      : "border-line bg-white hover:border-brand-200",
                  )}
                >
                  <input
                    type="radio"
                    value={card.value}
                    className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
                    {...register("kind")}
                  />
                  <span>
                    <span className="block text-[15px] font-extrabold tracking-tight text-ink">
                      {card.title}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                      {card.desc}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <ErrorText id="rs-kind-error" message={errors.kind?.message} />
        </fieldset>
      </Card>

      {/* ③ 내용 */}
      <Card className="space-y-6 p-6 md:p-8">
        <h2 className="text-lg font-black tracking-tight text-ink">
          {kind === "case" ? "성적 변화" : "수업 후기"}
        </h2>

        <div className="grid gap-5 md:grid-cols-2">
          <Field label="학년/구분" required hint="예: 고2, 재수, 졸업">
            <Input
              {...register("grade")}
              placeholder="고2"
              aria-invalid={errors.grade ? true : undefined}
              aria-describedby={errors.grade ? "rs-grade-error" : undefined}
            />
            <ErrorText id="rs-grade-error" message={errors.grade?.message} />
          </Field>

          <Field label="계열">
            <Select {...register("track")}>
              <option value="">선택 안 함</option>
              {TRACK_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {kind === "review" ? (
          <Field label="만족도" required>
            <Select
              {...register("rating")}
              aria-invalid={errors.rating ? true : undefined}
              aria-describedby={errors.rating ? "rs-rating-error" : undefined}
            >
              {RATING_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {"★".repeat(Number(r))} {r}점
                </option>
              ))}
            </Select>
            <ErrorText id="rs-rating-error" message={errors.rating?.message} />
          </Field>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-4 rounded-panel border border-line bg-soft p-4">
              <p className="text-xs font-extrabold tracking-tight text-faint">수업 전</p>
              <Field label="시험" required hint="예: 고1 2학기 내신">
                <Input
                  {...register("beforeLabel")}
                  placeholder="고1 2학기 내신"
                  aria-invalid={errors.beforeLabel ? true : undefined}
                  aria-describedby={errors.beforeLabel ? "rs-beforelabel-error" : undefined}
                />
                <ErrorText id="rs-beforelabel-error" message={errors.beforeLabel?.message} />
              </Field>
              <Field label="등급" required hint="예: 2등급">
                <Input
                  {...register("beforeGrade")}
                  placeholder="2등급"
                  aria-invalid={errors.beforeGrade ? true : undefined}
                  aria-describedby={errors.beforeGrade ? "rs-beforegrade-error" : undefined}
                />
                <ErrorText id="rs-beforegrade-error" message={errors.beforeGrade?.message} />
              </Field>
            </div>
            <div className="space-y-4 rounded-panel border border-brand-100 bg-brand-50/50 p-4">
              <p className="text-xs font-extrabold tracking-tight text-brand-700">수업 후</p>
              <Field label="시험" required hint="예: 고2 1학기 내신">
                <Input
                  {...register("afterLabel")}
                  placeholder="고2 1학기 내신"
                  aria-invalid={errors.afterLabel ? true : undefined}
                  aria-describedby={errors.afterLabel ? "rs-afterlabel-error" : undefined}
                />
                <ErrorText id="rs-afterlabel-error" message={errors.afterLabel?.message} />
              </Field>
              <Field label="등급" required hint="예: 1등급">
                <Input
                  {...register("afterGrade")}
                  placeholder="1등급"
                  aria-invalid={errors.afterGrade ? true : undefined}
                  aria-describedby={errors.afterGrade ? "rs-aftergrade-error" : undefined}
                />
                <ErrorText id="rs-aftergrade-error" message={errors.afterGrade?.message} />
              </Field>
            </div>
          </div>
        )}

        <Field
          label={kind === "case" ? "사례 설명" : "후기 내용"}
          required
          hint={`${CONTENT_MIN}자 이상 ${CONTENT_MAX}자 이내. 학교명·실명 등 다른 사람이 알아볼 수 있는 정보는 적지 말아 주세요.`}
        >
          <Textarea
            {...register("content")}
            rows={7}
            placeholder={
              kind === "case"
                ? "어떤 부분이 부족했고, 수업에서 무엇을 바꿨으며, 결과가 어떻게 달라졌는지 적어 주세요."
                : "수업 방식, 달라진 점, 아쉬웠던 점을 솔직하게 적어 주세요."
            }
            aria-invalid={errors.content ? true : undefined}
            aria-describedby={errors.content ? "rs-content-error" : undefined}
          />
          <span className="mt-1 block text-right text-xs text-faint">
            {content.trim().length} / {CONTENT_MAX}
          </span>
          <ErrorText id="rs-content-error" message={errors.content?.message} />
        </Field>
      </Card>

      {/* ④ 이미지(선택) — 비공개 격리 업로드(S-02). 공개는 별도 동의와 운영자 승인 뒤에만. */}
      <Card className="space-y-5 p-6 md:p-8">
        <div>
          <h2 className="text-lg font-black tracking-tight text-ink">이미지 (선택)</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            성적표·시험지 사진 등 근거 이미지를 올릴 수 있습니다. 올린 이미지는 검토에만 쓰이며,
            아래 이미지 공개 동의가 있을 때만 승인된 사본이 공개됩니다.
          </p>
        </div>

        {keptExisting.length > 0 || (existing && removed.size > 0) ? (
          <div>
            <p className="mb-2 text-sm font-bold text-ink-soft">기존 이미지 (체크 시 삭제)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {(existing?.images ?? []).map((view) => (
                <label key={view.stored} className="block cursor-pointer space-y-1.5">
                  {view.displayUrl ? (
                    // 만료 서명 URL — next.config remotePatterns 미설정이라 img 사용(본인 확인용 썸네일).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={view.displayUrl}
                      alt="첨부 이미지"
                      className={cn(
                        "h-24 w-full rounded-panel border border-line object-cover",
                        removed.has(view.stored) && "opacity-40",
                      )}
                    />
                  ) : (
                    <span className="flex h-24 w-full items-center justify-center rounded-panel border border-line bg-soft text-xs font-bold text-muted">
                      미리보기 불가
                    </span>
                  )}
                  <span className="flex min-h-11 items-center gap-1.5 text-xs font-bold text-rose-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={removed.has(view.stored)}
                      onChange={(e) => toggleRemoved(view.stored, e.target.checked)}
                    />
                    삭제
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <Field
          label={existing ? "이미지 추가" : "이미지 선택"}
          hint={`jpg, png, webp / 10MB 이하 / 최대 ${MAX_IMAGES}장`}
        >
          <Input
            type="file"
            multiple
            accept={IMAGE_ACCEPT}
            onChange={(e) => onFilesChange(e.currentTarget)}
            className="file:mr-4 file:cursor-pointer file:rounded-full file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-bold file:text-brand-700"
          />
          {files.length > 0 && (
            <span className="mt-1 block text-xs text-muted">
              선택한 이미지 {files.length}장: {files.map((f) => f.name).join(", ")}
            </span>
          )}
          <ErrorText id="rs-image-error" message={imageError ?? undefined} />
        </Field>
      </Card>

      {/* ⑤ 동의 — 이용약관(필수) · 개인정보 처리(필수) · 공개(건별 선택) · 이미지 공개(이미지가 있을 때) · 법정대리인(미성년) */}
      <Card className="space-y-4 p-6 md:p-8">
        <div>
          <h2 className="text-lg font-black tracking-tight text-ink">동의</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{REVIEW_CONSENT_COPY.intro}</p>
        </div>

        <div className="space-y-1 border-t border-line pt-4">
          <label className="flex min-h-12 items-start gap-3">
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              {...register("termsConsent")}
              aria-invalid={errors.termsConsent ? true : undefined}
              aria-describedby={errors.termsConsent ? "rs-terms-error" : undefined}
            />
            <span className="text-sm leading-relaxed text-ink-soft">
              [필수] {REVIEW_CONSENT_COPY.terms.replace(" (필수)", "")}{" "}
              <Link href="/terms" className="font-bold text-brand-600 underline underline-offset-2">
                약관 보기
              </Link>
            </span>
          </label>
          <ErrorText id="rs-terms-error" message={errors.termsConsent?.message} />

          <label className="flex min-h-12 items-start gap-3">
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              {...register("privacyConsent")}
              aria-invalid={errors.privacyConsent ? true : undefined}
              aria-describedby={errors.privacyConsent ? "rs-privacy-error" : undefined}
            />
            <span className="text-sm leading-relaxed text-ink-soft">
              [필수] {REVIEW_CONSENT_COPY.privacy.replace(" (필수)", "")}{" "}
              <Link href="/privacy" className="font-bold text-brand-600 underline underline-offset-2">
                자세히 보기
              </Link>
            </span>
          </label>
          <ErrorText id="rs-privacy-error" message={errors.privacyConsent?.message} />

          <label className="flex min-h-12 items-start gap-3">
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              {...register("publishConsent")}
              aria-invalid={errors.publishConsent ? true : undefined}
              aria-describedby={errors.publishConsent ? "rs-publish-error" : undefined}
            />
            <span className="text-sm leading-relaxed text-ink-soft">
              [건별 선택] {REVIEW_CONSENT_COPY.publication.replace(" (선택)", "")}
            </span>
          </label>
          <ErrorText id="rs-publish-error" message={errors.publishConsent?.message} />

          {hasImages && (
            <>
              <label className="flex min-h-12 items-start gap-3">
                <input
                  type="checkbox"
                  className={CHECKBOX_CLASS}
                  checked={imageConsent}
                  onChange={(e) => {
                    setImageConsent(e.target.checked);
                    if (e.target.checked) setImageError(null);
                  }}
                  aria-describedby="rs-imageconsent-hint"
                />
                <span className="text-sm leading-relaxed text-ink-soft">
                  [이미지 공개] 첨부한 이미지를 승인 후 공개 사례에 함께 게시하는 데 동의합니다.
                  <span id="rs-imageconsent-hint" className="mt-1 block text-xs text-muted">
                    {REVIEW_CONSENT_COPY.image}
                  </span>
                </span>
              </label>
            </>
          )}
        </div>

        {isMinor && (
          <div className="space-y-4 rounded-panel border border-brand-100 bg-brand-50/50 p-5">
            <p className="text-xs font-bold leading-relaxed text-brand-700">
              미성년 학생의 게시에는 법정대리인(보호자) 동의가 필요합니다. 담당 선생님이 동의 사실을
              확인한 뒤에만 승인·게시됩니다.
            </p>
            {!isParent && (
              <div className="grid gap-5 md:grid-cols-2">
                <Field label="법정대리인 성명" required>
                  <Input
                    {...register("guardianName")}
                    placeholder="보호자 이름"
                    aria-invalid={errors.guardianName ? true : undefined}
                    aria-describedby={errors.guardianName ? "rs-guardianname-error" : undefined}
                  />
                  <ErrorText id="rs-guardianname-error" message={errors.guardianName?.message} />
                </Field>
                <Field label="법정대리인 연락처" required>
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
                          errors.guardianPhone ? "rs-guardianphone-error" : undefined
                        }
                      />
                    )}
                  />
                  <ErrorText id="rs-guardianphone-error" message={errors.guardianPhone?.message} />
                </Field>
              </div>
            )}
            <label className="flex min-h-12 items-start gap-3">
              <input
                type="checkbox"
                className={CHECKBOX_CLASS}
                {...register("guardianConsent")}
                aria-invalid={errors.guardianConsent ? true : undefined}
                aria-describedby={errors.guardianConsent ? "rs-guardianconsent-error" : undefined}
              />
              <span className="text-sm leading-relaxed text-ink-soft">
                {isParent
                  ? `[필수] ${REVIEW_CONSENT_COPY.guardian.replace(" (필수)", "")}`
                  : "[필수] 위 법정대리인이 이 후기·사례의 게시에 동의했음을 확인합니다. 담당 선생님이 법정대리인에게 직접 확인할 수 있습니다."}
              </span>
            </label>
            <ErrorText id="rs-guardianconsent-error" message={errors.guardianConsent?.message} />
          </div>
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
        {submitState === "submitting"
          ? "제출 중..."
          : existing
            ? "수정한 내용 다시 제출하기"
            : "제출하기"}
      </button>
    </form>
  );
}
