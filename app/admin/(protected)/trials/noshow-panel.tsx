"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { confirmNoshow, recordNoshowContact } from "./actions";
import { NOSHOW_CONFIRM_AFTER_MINUTES, NOSHOW_CONTACT_MINUTES } from "./constants";

/** 이미 남은 연락 기록 1건 — 시각 문구는 서버에서 만들어 넘긴다(포맷 함수는 서버 모듈에 있다). */
export interface NoshowContactRecord {
  minute: number;
  atLabel: string;
  actor: string | null;
}

// 노쇼 확정 패널 (T-03 · 검수 10).
//
// 정본: "10분·20분·30분 연락 → 모두 무응답이고 30분 경과 → 운영자 노쇼 확정" · "자동 판정 금지".
// 그래서 이 패널은 연락 3건을 각각 그 시점에 기록하게 하고, 3건이 모두 남기 전에는 확정
// 버튼 자체를 열지 않는다. 열림 여부는 화면 편의일 뿐 판정 근거는 서버(confirmNoshow)가
// 다시 확인한다 — 감사 기록·30분 경과·연락 3건 모두.
export function NoshowPanel({
  sessionId,
  recorded,
}: {
  sessionId: string;
  recorded: NoshowContactRecord[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const recordedMap = new Map(recorded.map((r) => [r.minute, r]));
  const allRecorded = NOSHOW_CONTACT_MINUTES.every((m) => recordedMap.has(m));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        setError(null);
        router.refresh();
        return;
      }
      setError(result.error ?? "처리에 실패했습니다.");
    });
  }

  return (
    <div>
      <p className="rounded-panel bg-soft px-4 py-3 text-xs leading-relaxed text-muted">
        노쇼는 자동으로 판정하지 않습니다. 시작 후 {NOSHOW_CONTACT_MINUTES.join("·")}분에 연락하고
        그 결과를 각각 기록한 뒤, 세 번 모두 무응답이고 {NOSHOW_CONFIRM_AFTER_MINUTES}분이 지났을 때만
        운영자가 확정합니다. <strong className="font-black text-ink-soft">확정 전에는 금액·등록 판단에
        반영하지 않습니다</strong> — 결제 차감·환불·등록 결정은 확정 이후에 시작하세요.
      </p>

      <ul className="mt-4 space-y-2">
        {NOSHOW_CONTACT_MINUTES.map((minute) => {
          const hit = recordedMap.get(minute);
          return (
            <li
              key={minute}
              className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line px-4 py-3"
            >
              <div className="text-sm">
                <span className="font-bold">{minute}분 연락</span>
                {hit ? (
                  <span className="ml-2 text-xs text-muted">
                    기록됨 · {hit.atLabel}
                    {hit.actor && ` · ${hit.actor}`}
                  </span>
                ) : (
                  <span className="ml-2 text-xs text-muted">아직 기록 없음</span>
                )}
              </div>
              {hit ? (
                <span className="text-xs font-bold text-emerald-700">무응답 기록 완료</span>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() => {
                      const formData = new FormData();
                      formData.set("id", sessionId);
                      formData.set("minute", String(minute));
                      return recordNoshowContact(formData);
                    })
                  }
                  className="text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
                >
                  무응답 기록
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-4">
        <Textarea
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="확정 메모(선택) — 연락 경로·상황을 남겨 두면 정산 판단의 근거가 됩니다."
          className="min-h-20 text-sm"
        />
      </div>

      {error && (
        <p className="mt-3 text-sm font-bold text-rose-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={pending || !allRecorded}
        title={allRecorded ? undefined : "연락 기록 3건이 모두 남아야 열립니다."}
        onClick={() =>
          run(() => {
            const formData = new FormData();
            formData.set("id", sessionId);
            formData.set("note", note);
            return confirmNoshow(formData);
          })
        }
        className={cn(buttonClass("outline", "md"), "mt-4")}
      >
        {pending ? "처리 중..." : allRecorded ? "노쇼 확정" : "노쇼 확정 (연락 기록 3건 필요)"}
      </button>
    </div>
  );
}
