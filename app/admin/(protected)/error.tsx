"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

export default function AdminDataError({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="dash-page"><div className="rounded-lg border border-line p-8" role="alert">
    <h1 className="text-lg font-semibold">데이터를 불러오지 못했습니다</h1>
    <p className="mt-2 text-sm text-muted">서버 응답을 확인하지 못해 목록을 표시할 수 없습니다. 다시 시도해 주세요.</p>
    <button type="button" disabled={pending} className={buttonClass("outline", "sm", "mt-5")} onClick={() => startTransition(() => { router.refresh(); reset(); })}><RefreshCw size={14} />{pending ? "불러오는 중…" : "다시 불러오기"}</button>
  </div></div>;
}
