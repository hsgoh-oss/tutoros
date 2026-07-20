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
          screenshots: r.screenshots ?? [],
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
