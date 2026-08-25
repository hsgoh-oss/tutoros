import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/data/activity";

// 학생 일정 내보내기 (L-09) — 정본: docs/flow-canon/01_atlas_02_portal_lessons.md.
//
// 정본이 요구하는 것은 "개인정보가 제외된 일정본"이다. 그래서 이 응답에는 회차의 시각·상태·
// 수업 방식만 담긴다 — 연락처·내부 메모·다른 학생 정보는 조회 자체를 하지 않는다(빼는 게 아니라
// 가져오지 않는다: 가져온 뒤 지우는 코드는 언젠가 지우기를 잊는다).
//
// 예외 처리도 정본대로다:
//  · 대상 학생·기간이 불명확하면 생성하지 않는다(400).
//  · 해당 기간에 일정이 없으면 빈 파일을 성공자료처럼 주지 않는다(409 — 문구로 종료).
//  · 내보내기는 회차 상태·출결·잔액을 바꾸지 않는다 — 이 라우트에는 어떤 UPDATE도 없다.
//    남는 것은 "누가 무엇을 내보냈는가"라는 감사 기록 한 줄뿐이다.

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  planned: "예정",
  done: "완료",
  canceled: "취소",
  makeup: "보강",
  conflict: "미확정(충돌)",
};

/** ICS는 CRLF 줄바꿈과 75옥텟 접기를 요구한다. 접기는 바이트 기준이어야 한글이 깨지지 않는다. */
function icsFold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 74) return line;
  const chunks: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    // 이어지는 줄은 앞에 공백 한 칸이 붙으므로 첫 줄만 74, 나머지는 73바이트씩 담는다.
    const size = chunks.length === 0 ? 74 : 73;
    let end = Math.min(start + size, bytes.length);
    // UTF-8 연속 바이트(10xxxxxx) 한가운데서 자르지 않는다.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return chunks.map((c, i) => (i === 0 ? c : ` ${c}`)).join("\r\n");
}

function icsEscape(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsStamp(iso: string): string {
  return `${new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

function csvCell(v: string): string {
  // 스프레드시트 수식 주입 방지: =,+,-,@ 로 시작하는 셀은 앞에 작은따옴표를 붙여 문자열로 못박는다.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** KST 벽시계 "YYYY-MM-DD HH:MM". toLocaleString의 "2026. 8. 27. PM 5:00:00"은 표에서 정렬되지 않는다. */
function kstStamp(iso: string): string {
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p2(k.getUTCMonth() + 1)}-${p2(k.getUTCDate())} ${p2(
    k.getUTCHours(),
  )}:${p2(k.getUTCMinutes())}`;
}

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const url = new URL(request.url);
  const studentId = url.searchParams.get("studentId") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const format = url.searchParams.get("format") === "csv" ? "csv" : "ics";

  if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { error: "대상 학생과 조회 기간(YYYY-MM-DD)을 지정해 주세요." },
      { status: 400 },
    );
  }
  if (from > to) {
    return NextResponse.json({ error: "조회 기간이 뒤집혀 있습니다." }, { status: 400 });
  }

  const db = createServiceClient();
  if (!db) {
    return NextResponse.json({ error: "Supabase 미연결" }, { status: 503 });
  }

  const { data: student } = await db
    .from("students")
    .select("id, name")
    .eq("tenant_id", session.tenantId)
    .eq("id", studentId)
    .maybeSingle();
  if (!student) {
    return NextResponse.json({ error: "학생을 찾을 수 없습니다." }, { status: 404 });
  }
  const name = (student as { name: string }).name;

  // KST 하루 경계를 UTC 구간으로. from 00:00 KST ~ to 다음날 00:00 KST.
  const fromUtc = new Date(`${from}T00:00:00+09:00`).toISOString();
  const toUtc = new Date(new Date(`${to}T00:00:00+09:00`).getTime() + 24 * 3600 * 1000).toISOString();

  const { data, error } = await db
    .from("schedules")
    .select("id, scheduled_at, ends_at, status, class_type")
    .eq("tenant_id", session.tenantId)
    .eq("student_id", studentId)
    .gte("scheduled_at", fromUtc)
    .lt("scheduled_at", toUtc)
    .order("scheduled_at");
  if (error) {
    console.error("[schedule-export] query failed", error);
    return NextResponse.json({ error: "일정을 불러오지 못했습니다." }, { status: 500 });
  }

  const rows = (data ?? []) as {
    id: string;
    scheduled_at: string;
    ends_at: string | null;
    status: string;
    class_type: string;
  }[];

  // 빈 파일을 성공자료처럼 전달하지 않는다(L-09).
  if (rows.length === 0) {
    return NextResponse.json(
      { error: `${from} ~ ${to} 기간에 ${name} 학생의 일정이 없습니다.` },
      { status: 409 },
    );
  }

  await logActivity(
    session.tenantId,
    session.email,
    "export",
    "student",
    studentId,
    `일정 내보내기 ${from}~${to} (${rows.length}건, ${format})`,
  );

  const filename = `schedule-${from}_${to}`;

  if (format === "csv") {
    const header = "시작(KST),종료(KST),상태,수업방식";
    const body = rows
      .map((r) => {
        const start = kstStamp(r.scheduled_at);
        const end = r.ends_at ? kstStamp(r.ends_at) : "";
        return [start, end, STATUS_LABEL[r.status] ?? r.status, r.class_type === "video" ? "화상" : "대면"]
          .map(csvCell)
          .join(",");
      })
      .join("\r\n");
    // BOM — Excel이 UTF-8 한글을 깨뜨리지 않게 한다.
    return new NextResponse(`\uFEFF${header}\r\n${body}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const now = icsStamp(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TutorOS//schedule-export//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const r of rows) {
    const end = r.ends_at ?? new Date(new Date(r.scheduled_at).getTime() + 60 * 60_000).toISOString();
    lines.push(
      "BEGIN:VEVENT",
      icsFold(`UID:${r.id}@tutoros`),
      `DTSTAMP:${now}`,
      `DTSTART:${icsStamp(r.scheduled_at)}`,
      `DTEND:${icsStamp(end)}`,
      icsFold(
        `SUMMARY:${icsEscape(`${name} 수업 (${STATUS_LABEL[r.status] ?? r.status})`)}`,
      ),
      icsFold(
        `DESCRIPTION:${icsEscape(r.class_type === "video" ? "화상 수업" : "대면 수업")}`,
      ),
      r.status === "canceled" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");

  return new NextResponse(`${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
