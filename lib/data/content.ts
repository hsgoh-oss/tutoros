import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/server";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import type {
  Dday,
  Faq,
  RecruitStatus,
  Review,
  SiteContent,
} from "@/lib/types";

// 공개 사이트 콘텐츠 로더 — DB 값 우선, 섹션 단위로 기본 콘텐츠 폴백.
// site_settings는 key-value 저장이며 DEFAULT_CONTENT.settings/rates 위에 얕은 병합된다.

interface DdayRow {
  id: string;
  name: string;
  exam_date: string;
  is_visible: boolean;
  sort_order: number;
}

interface ReviewRow {
  id: string;
  reviewer_type: "student" | "parent";
  content: string;
  rating: number;
  before_grade: string | null;
  after_grade: string | null;
  meta: {
    region?: string;
    grade?: string;
    track?: string;
    source?: string;
    reviewed_at?: string;
  } | null;
  screenshots: string[] | null;
  ai_tags: string[] | null;
  is_pinned: boolean;
}

interface FaqRow {
  id: string;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
}

export const getSiteContent = cache(
  async (tenantId: string): Promise<SiteContent> => {
  const db = createServiceClient();
  if (!db) return DEFAULT_CONTENT;

  const [settingsRes, ddaysRes, recruitRes, reviewsRes, faqsRes] =
    await Promise.all([
      db.from("site_settings").select("key,value").eq("tenant_id", tenantId),
      db
        .from("ddays")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_visible", true)
        .order("sort_order"),
      db
        .from("recruit_status")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      db
        .from("reviews")
        .select("*")
        .eq("tenant_id", tenantId)
        // 정본 S-01·S-03 "공개 콘텐츠는 승인본만": 게시 승인(published)된 후기만 공개면에 노출한다.
        // draft(승인 대기)·retracted(철회)는 상태 구분 없이 전 행을 노출하던 이전 동작과 달리 제외 —
        // 기존 행은 00016이 published로 백필해 오늘 공개 중인 집합은 그대로 유지된다.
        .eq("status", "published")
        .order("is_pinned", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false }),
      db
        .from("faqs")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order"),
    ]);

  const kv = new Map<string, unknown>(
    (settingsRes.data ?? []).map((r: { key: string; value: unknown }) => [
      r.key,
      r.value,
    ]),
  );

  const settings = {
    ...DEFAULT_CONTENT.settings,
    ...((kv.get("site_info") as object) ?? {}),
  };
  const rates = {
    ...DEFAULT_CONTENT.rates,
    ...((kv.get("rates") as object) ?? {}),
  };
  const badges =
    (kv.get("badges") as string[] | undefined) ?? DEFAULT_CONTENT.badges;
  const cases = kv.has("cases")
    ? (kv.get("cases") as SiteContent["cases"])
    : DEFAULT_CONTENT.cases;
  const subjects = kv.has("subjects")
    ? (kv.get("subjects") as SiteContent["subjects"])
    : DEFAULT_CONTENT.subjects;
  const checklist = kv.has("checklist")
    ? (kv.get("checklist") as SiteContent["checklist"])
    : DEFAULT_CONTENT.checklist;

  const ddays: Dday[] =
    ddaysRes.data && ddaysRes.data.length > 0
      ? (ddaysRes.data as DdayRow[]).map((d) => ({
          id: d.id,
          name: d.name,
          examDate: d.exam_date,
          isVisible: d.is_visible,
          sortOrder: d.sort_order,
        }))
      : DEFAULT_CONTENT.ddays;

  const recruit: RecruitStatus = recruitRes.data
    ? {
        status: recruitRes.data.status,
        message: recruitRes.data.message,
        seatCount: recruitRes.data.seat_count,
        isBannerVisible: recruitRes.data.is_banner_visible,
      }
    : DEFAULT_CONTENT.recruit;

  // 공개면 스크린샷 URL 해석(S-02 — 승인 시 공개 사본 방식):
  //  · "http…" 항목 = 과거 public 버킷 발급 URL(레거시, 이관하지 않음) — 그대로 사용.
  //  · 그 외 항목 = 비공개 증빙 버킷(review-evidence)의 경로. 게시 승인 시 같은 경로로
  //    reviews 공개 버킷에 사본이 생성돼 있으므로 getPublicUrl로 URL만 계산한다(네트워크 왕복 0).
  // 짧은 만료 서명 URL 방식을 쓰지 않은 이유: 이 로더는 revalidatePath 기반으로 캐시되는
  // 공개 페이지에 들어가므로 캐시된 HTML 안에서 서명이 만료돼 이미지가 깨지고, 회피하려면
  // 매 요청 후기×스크린샷 수만큼 storage 서명 API를 호출해야 해 공개 페이지 성능을 해친다.
  // 원본 증빙은 비공개 버킷에 격리 유지 — 철회·삭제 시 공개 사본만 제거하면 즉시 비공개화된다.
  // "/" 시작은 사이트 정적 자산(시드의 /img/…) — 스토리지와 무관하므로 그대로 둔다.
  const publicScreenshotUrl = (entry: string): string =>
    entry.startsWith("http://") || entry.startsWith("https://") || entry.startsWith("/")
      ? entry
      : db.storage.from("reviews").getPublicUrl(entry).data.publicUrl;

  const reviews: Review[] =
    reviewsRes.data && reviewsRes.data.length > 0
      ? (reviewsRes.data as ReviewRow[]).map((r) => ({
          id: r.id,
          reviewerType: r.reviewer_type,
          content: r.content,
          rating: r.rating,
          beforeGrade: r.before_grade,
          afterGrade: r.after_grade,
          region: r.meta?.region ?? null,
          grade: r.meta?.grade ?? null,
          track: r.meta?.track ?? null,
          source: r.meta?.source ?? null,
          reviewedAt: r.meta?.reviewed_at ?? null,
          screenshots: (r.screenshots ?? []).map(publicScreenshotUrl),
          aiTags: r.ai_tags ?? [],
          isPinned: r.is_pinned,
        }))
      : DEFAULT_CONTENT.reviews;

  const faqs: Faq[] =
    faqsRes.data && faqsRes.data.length > 0
      ? (faqsRes.data as FaqRow[]).map((f) => ({
          id: f.id,
          category: f.category,
          question: f.question,
          answer: f.answer,
          sortOrder: f.sort_order,
        }))
      : DEFAULT_CONTENT.faqs;

    return {
      settings,
      rates,
      badges,
      ddays,
      recruit,
      reviews,
      cases,
      faqs,
      subjects,
      checklist,
    };
  },
);
