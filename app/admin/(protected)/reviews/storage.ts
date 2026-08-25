import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import type { ReviewStatus } from "@/lib/types";

// 후기 증빙 스토리지 헬퍼 — 정본 S-02 "증빙 비공개 격리" 해소의 중심 모듈.
//
// 버킷 이원화:
//  · review-evidence(비공개, scripts/setup-supabase.sh가 신설) — 신규 증빙 스크린샷의 원본.
//    관리자 검토는 만료 서명 URL로만 열람한다(homework 버킷과 동일 패턴).
//  · reviews(공개, 기존) — ① 과거 등록분의 public URL(이관하지 않음 — 별도 작업)과
//    ② 게시 승인 시 생성되는 "공개 사본"이 산다.
//
// screenshots 컬럼 항목의 두 형태(신·구 공존 규약):
//  · "https://…"로 시작 — 과거 public 버킷 발급 URL(레거시). 그대로 표시한다.
//  · 그 외("{tenantId}/{uuid}.{ext}") — review-evidence 버킷의 오브젝트 경로(신규).
//    게시 승인 시 같은 경로로 reviews 버킷에 공개 사본이 복사된다.
//
// S-02 택1 설계: "승인 시 공개 사본 생성"을 택했다(짧은 만료 서명 URL 방식 대신). 사유:
//  · 공개 페이지(getSiteContent)는 revalidatePath 기반으로 캐시된다 — 짧은 만료 서명 URL은
//    캐시된 HTML 안에서 만료돼 이미지가 깨지고, 이를 피하려면 매 요청 후기×스크린샷 수만큼
//    storage 서명 API 왕복이 필요해 공개 페이지 성능을 해친다.
//  · 공개 사본은 승인 시 1회 복사로 끝나고 URL이 불변이라 캐시·CDN에 안전하며,
//    철회·삭제 시 공개 사본만 지우면 즉시 비공개화된다(원본 증빙은 비공개 버킷에 격리 유지).

/** 기존 공개 버킷 — 레거시 public URL + 게시 승인본의 공개 사본. */
export const REVIEWS_BUCKET = "reviews";
/** 신규 증빙 원본의 비공개 버킷(서명 URL 열람 전용). */
export const EVIDENCE_BUCKET = "review-evidence";

const EVIDENCE_URL_TTL_S = 60 * 60; // 관리자 검토용 서명 URL 1시간 만료

type Db = SupabaseClient;

/**
 * 표시 가능(display-ready) 항목 여부 — 증빙 경로가 아닌 값.
 *  · http(s) 시작: 과거 public 버킷 발급 URL(레거시).
 *  · "/" 시작: 사이트 정적 자산 경로(시드 데이터의 /img/… — 스토리지와 무관).
 * 증빙 경로("{tenantId}/{uuid}.{ext}")는 둘 다 아니므로 여기서 걸러진다.
 */
export function isLegacyPublicUrl(entry: string): boolean {
  return entry.startsWith("http://") || entry.startsWith("https://") || entry.startsWith("/");
}

/** getPublicUrl로 발급한 레거시 URL에서 reviews 버킷 내부 오브젝트 경로만 역추출(삭제 시 재사용). */
export function storageObjectPath(fileUrl: string): string | null {
  const marker = `/${REVIEWS_BUCKET}/`;
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  return fileUrl.slice(idx + marker.length);
}

/**
 * 게시 승인 — 증빙 경로 항목의 공개 사본을 reviews 버킷 같은 경로로 복사한다.
 * 원본은 비공개 버킷에 그대로 남는다(격리 유지 — 공개본과 검토 증빙의 분리, S-03).
 * 하나라도 실패하면 {ok:false} — 깨진 이미지를 안고 게시하지 않도록 호출부가 승인을 중단한다.
 * 이미 사본이 있는 경로(재승인 시도·게시본 수정 재복사)는 성공으로 간주한다(멱등).
 */
export async function publishEvidenceCopies(
  db: Db,
  screenshots: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const paths = screenshots.filter((s) => !isLegacyPublicUrl(s));
  for (const path of paths) {
    const { error } = await db.storage
      .from(EVIDENCE_BUCKET)
      .copy(path, path, { destinationBucket: REVIEWS_BUCKET });
    if (error && !/already exists|duplicate/i.test(error.message)) {
      console.error("[reviews] 증빙 공개 사본 생성 실패", path, error);
      return {
        ok: false,
        error: "증빙 공개 사본 생성에 실패해 게시하지 않았습니다. 잠시 후 다시 시도해 주세요.",
      };
    }
  }
  return { ok: true };
}

/**
 * 스크린샷 항목들의 스토리지 오브젝트를 제거한다(후기 수정 시 제거 선택분·후기 삭제 시 전체).
 *  · 레거시 URL → reviews 버킷의 원 오브젝트 제거(기존 동작 유지).
 *  · 증빙 경로 → 비공개 원본(review-evidence) + 있을 수 있는 공개 사본(reviews) 모두 제거
 *    — 공개 사본을 지워야 삭제·철회가 실제 비공개화로 이어진다(S-03 "공개 사본 제거").
 * 스토리지 제거 실패는 로그만 남긴다(기존 deleteReview와 동일 — DB 행 처리를 막지 않는다).
 */
export async function removeScreenshotObjects(db: Db, entries: string[]): Promise<void> {
  // 정적 자산("/img/…")은 스토리지 대상이 아니다 — http(s) URL만 레거시 오브젝트로 취급.
  const legacyPaths = entries
    .filter((e) => e.startsWith("http://") || e.startsWith("https://"))
    .map((url) => storageObjectPath(url))
    .filter((p): p is string => Boolean(p));
  const evidencePaths = entries.filter((e) => !isLegacyPublicUrl(e));

  if (evidencePaths.length > 0) {
    const { error } = await db.storage.from(EVIDENCE_BUCKET).remove(evidencePaths);
    if (error) console.error("[reviews] 증빙 원본 제거 실패", error);
  }
  const publicPaths = [...legacyPaths, ...evidencePaths]; // 공개 사본은 원본과 같은 경로
  if (publicPaths.length > 0) {
    const { error } = await db.storage.from(REVIEWS_BUCKET).remove(publicPaths);
    if (error) console.error("[reviews] 공개 스크린샷 제거 실패", error);
  }
}

/** 관리자 화면용 스크린샷 뷰 — 저장 원문(stored)과 표시 URL을 분리해 전달한다. */
export interface ScreenshotView {
  /** DB에 저장된 원문(레거시 URL 또는 증빙 경로) — 수정 폼의 삭제 체크박스 값으로 그대로 쓴다. */
  stored: string;
  /** 표시용 URL — 레거시는 원 URL, 증빙 경로는 만료 서명 URL. 발급 실패 시 null(경로 비노출). */
  displayUrl: string | null;
}

/** 관리자 검토 화면용 — 증빙 경로 항목에 만료 서명 URL을 발급한다(비공개 원본 열람). */
export async function screenshotViewsFor(screenshots: string[]): Promise<ScreenshotView[]> {
  const db = createServiceClient();
  return Promise.all(
    screenshots.map(async (stored): Promise<ScreenshotView> => {
      if (isLegacyPublicUrl(stored)) return { stored, displayUrl: stored };
      if (!db) return { stored, displayUrl: null };
      const { data } = await db.storage
        .from(EVIDENCE_BUCKET)
        .createSignedUrl(stored, EVIDENCE_URL_TTL_S);
      return { stored, displayUrl: data?.signedUrl ?? null };
    }),
  );
}

/** 후기별 게시 상태(00016 status·approved_at) — 관리자 목록·상세의 상태 표시·승인 버튼 판단용.
 *  (lib/data/crm.ts listReviews는 다른 작업과 겹쳐 수정하지 않고, 상태만 이 모듈이 보강 조회한다.) */
export interface ReviewStatusRow {
  status: ReviewStatus;
  approvedAt: string | null;
}

export async function listReviewStatuses(
  tenantId: string,
): Promise<Map<string, ReviewStatusRow>> {
  const db = createServiceClient();
  if (!db) return new Map();
  const { data, error } = await db
    .from("reviews")
    .select("id,status,approved_at")
    .eq("tenant_id", tenantId);
  if (error) {
    console.error("[reviews] 상태 조회 실패", error);
    return new Map();
  }
  return new Map(
    ((data ?? []) as { id: string; status: ReviewStatus; approved_at: string | null }[]).map(
      (r) => [r.id, { status: r.status, approvedAt: r.approved_at }],
    ),
  );
}

export async function getReviewStatus(
  tenantId: string,
  id: string,
): Promise<ReviewStatusRow | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await db
    .from("reviews")
    .select("status,approved_at")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[reviews] 상태 조회 실패", error);
    return null;
  }
  const row = data as { status: ReviewStatus; approved_at: string | null };
  return { status: row.status, approvedAt: row.approved_at };
}
