"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { bulkCreateStudents, type BulkStudentRow } from "./actions";

// CSV 헤더 → BulkStudentRow 키 매핑 (한글·영문 병용).
const HEADER_MAP: Record<string, keyof BulkStudentRow> = {
  이름: "name",
  name: "name",
  학부모연락처: "parentPhone",
  "학부모 연락처": "parentPhone",
  parentphone: "parentPhone",
  학교: "school",
  school: "school",
  학년: "grade",
  grade: "grade",
  수업방식: "classType",
  "수업 방식": "classType",
  classtype: "classType",
};

function parseCsv(text: string): BulkStudentRow[] | { error: string } {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { error: "헤더와 1행 이상의 데이터가 필요합니다." };
  }

  const headers = lines[0]
    .split(",")
    .map((h) => HEADER_MAP[h.trim().toLowerCase()] ?? HEADER_MAP[h.trim()]);
  if (!headers.includes("name") || !headers.includes("parentPhone")) {
    return { error: "헤더에 이름·학부모연락처 열이 필요합니다." };
  }

  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: BulkStudentRow = { name: "", parentPhone: "" };
    headers.forEach((key, i) => {
      if (!key) return;
      const value = (cells[i] ?? "").trim();
      if (value) {
        if (key === "classType") {
          row.classType = value === "화상" ? "video" : value === "대면" ? "inperson" : value;
        } else {
          row[key] = value;
        }
      }
    });
    return row;
  });
}

// 업로드 파서가 인식하는 헤더(이름·학부모연락처·학교·학년·수업방식)와 예시 1행.
const TEMPLATE_CSV =
  "이름,학부모연락처,학교,학년,수업방식\n홍길동,010-1234-5678,OO고등학교,고2,대면\n";

function downloadTemplate() {
  // BOM을 붙여 Excel에서 한글이 깨지지 않게 한다.
  const blob = new Blob([`﻿${TEMPLATE_CSV}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "students-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function CsvUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleFile(file: File) {
    setPending(true);
    setMessage(null);
    const parsed = parseCsv(await file.text());
    if ("error" in parsed) {
      setPending(false);
      setMessage({ ok: false, text: parsed.error });
      return;
    }
    const result = await bulkCreateStudents(parsed);
    setPending(false);
    if (result.ok) {
      setMessage({
        ok: true,
        text: `${result.created ?? 0}명 등록 완료${result.skipped ? ` · ${result.skipped}행 건너뜀(필수값 누락)` : ""}`,
      });
      router.refresh();
    } else {
      setMessage({ ok: false, text: result.error ?? "등록에 실패했습니다." });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={downloadTemplate}
        className={buttonClass("ghost", "sm")}
      >
        템플릿 다운로드
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
        className={buttonClass("ghost", "sm")}
        title="헤더: 이름,학부모연락처,학교,학년,수업방식 (쉼표 구분)"
      >
        {pending ? "등록 중..." : "CSV 일괄 등록"}
      </button>
      {message && (
        <p
          className={
            message.ok
              ? "text-xs font-bold text-emerald-700"
              : "text-xs font-bold text-rose-600"
          }
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
