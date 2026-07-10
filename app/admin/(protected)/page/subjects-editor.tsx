"use client";

import { useState } from "react";
import { Input, Textarea } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import type { SubjectCard } from "@/lib/types";

// points[]는 한 줄에 하나씩 입력하는 텍스트로 편집 — 중첩 배열 UI 없이 실용적으로 처리.
interface SubjectRow {
  key: string;
  title: string;
  target: string;
  summary: string;
  pointsText: string;
}

function toRow(item: SubjectCard): SubjectRow {
  return {
    key: item.key,
    title: item.title,
    target: item.target,
    summary: item.summary,
    pointsText: item.points.join("\n"),
  };
}

const EMPTY_ROW: SubjectRow = { key: "", title: "", target: "", summary: "", pointsText: "" };

export function SubjectsEditor({ initialItems }: { initialItems: SubjectCard[] }) {
  const [rows, setRows] = useState<SubjectRow[]>(
    initialItems.length > 0 ? initialItems.map(toRow) : [{ ...EMPTY_ROW }],
  );

  function update(index: number, patch: Partial<SubjectRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const serialized: SubjectCard[] = rows.map((row) => ({
    key: row.key,
    title: row.title,
    target: row.target,
    summary: row.summary,
    points: row.pointsText
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean),
  }));

  return (
    <div className="space-y-4">
      {rows.map((row, i) => (
        <div key={i} className="space-y-3 rounded-panel border border-line p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              placeholder="key (예: naesin)"
              value={row.key}
              onChange={(e) => update(i, { key: e.target.value })}
            />
            <Input
              placeholder="제목"
              value={row.title}
              onChange={(e) => update(i, { title: e.target.value })}
            />
            <Input
              placeholder="대상"
              value={row.target}
              onChange={(e) => update(i, { target: e.target.value })}
            />
          </div>
          <Textarea
            placeholder="한 줄 요약"
            value={row.summary}
            onChange={(e) => update(i, { summary: e.target.value })}
            className="min-h-16"
          />
          <Textarea
            placeholder="핵심 포인트 (한 줄에 하나씩)"
            value={row.pointsText}
            onChange={(e) => update(i, { pointsText: e.target.value })}
            className="min-h-20"
          />
          <button
            type="button"
            onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
            className="flex min-h-11 items-center text-xs font-bold text-rose-600 hover:underline"
          >
            이 카드 삭제
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows((prev) => [...prev, { ...EMPTY_ROW }])}
        className={buttonClass("ghost", "sm")}
      >
        + 과목 카드 추가
      </button>
      <input type="hidden" name="subjectsJson" value={JSON.stringify(serialized)} />
    </div>
  );
}
