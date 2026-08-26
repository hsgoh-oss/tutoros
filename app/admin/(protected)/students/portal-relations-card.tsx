"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { CrmActionResult } from "@/components/admin/crm/types";
import type { PortalInviteResult } from "./actions";

// 학생 상세의 "포털 관계" 카드 — 역할별 초대 발급·재발송·회수(P-01 · P-06).
// 정본: docs/flow-canon/01_atlas_02_portal_lessons.md P-01(역할별 초대)·P-06(관계 변경·권한 회수)
//      · 03_scenarios_133.md 검수 16(역할별 독립 권한)·20(재발급 시 이전 초대 무효)·21(회수 = 전부 닫힘)·124(기존 연락처 재사용)
//
// 이 파일은 화면만 담당한다 — 정규화·권한·감사·발송은 전부 서버 액션(actions.ts) 쪽에 있다.
//
// ⚠️ 역할 라벨을 lib/portal/auth.ts에서 import하지 않고 여기에 다시 둔다: 그 모듈은
// next/headers·service client를 쓰는 서버 전용이라 클라이언트 번들에 들어갈 수 없다.
// 값이 갈라지면 화면 라벨만 어긋나므로(권한 판정은 서버 몫) 감수 가능한 중복이다.
type PortalRoleValue = "student" | "guardian" | "payer" | "contractor";

const ROLE_LABEL: Record<PortalRoleValue, string> = {
  student: "학생",
  guardian: "보호자",
  payer: "납부자",
  contractor: "계약자",
};

/** 역할별로 무엇이 열리는지 — 발급 전에 운영자가 권한 범위를 알고 고르게 한다(검수 17·19). */
const ROLE_SCOPE: Record<PortalRoleValue, string> = {
  student: "리포트·과제·질문 — 청구·수납·환불은 열리지 않습니다.",
  guardian: "연결된 자녀의 학습 현황만 — 다른 학생은 보이지 않습니다.",
  payer: "청구·수납·환불·증빙 — 상세 학습기록은 열리지 않습니다.",
  contractor: "계약 열람(계약 기능은 준비 중) — 지금은 자리만 만들어 둡니다.",
};

const ROLE_OPTIONS: PortalRoleValue[] = ["student", "guardian", "payer", "contractor"];

export interface PortalRelationItem {
  relationId: string;
  role: PortalRoleValue;
  /** 회수된 관계는 목록에 싣지 않는다 — 화면은 지금 열려 있는 접근만 보여준다. */
  status: "invited" | "active";
  name: string;
  phone: string;
  invitedAt: string;
  acceptedAt: string | null;
  /** 살아 있는 초대 링크가 있는지(발급 실패로 링크 없는 관계를 구분해 보여주기 위함). */
  hasActiveLink: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** 저장은 숫자만(정규화) — 보기만 하이픈을 넣는다. 원본 값을 바꾸지 않는다. */
function formatPhone(digits: string): string {
  if (/^01[0-9]{8,9}$/.test(digits)) {
    const head = digits.slice(0, 3);
    const tail = digits.slice(-4);
    return `${head}-${digits.slice(3, digits.length - 4)}-${tail}`;
  }
  return digits;
}

/**
 * 발급된 링크 표시 — 이 화면을 벗어나면 다시 볼 수 없다(portal_access_links에는 해시만 남는다).
 * 단 문자로 전달되는 동안에는 알림 큐(notifications.message)에 원문이 있고, 전달이 확정되면
 * 그 본문에서 토큰이 지워진다(lib/notify/send.ts redactPortalLink).
 */
function IssuedLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-panel border border-brand-100 bg-brand-50 p-3">
      <p className="text-xs font-bold text-brand-700">
        초대 링크가 발급되었습니다. 새로고침하면 다시 볼 수 없으니 지금 복사해 두세요.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-panel border border-line bg-white px-3 py-2 text-xs text-ink-soft"
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // 클립보드 접근 불가 — 직접 선택·복사할 수 있으므로 조용히 무시한다.
            }
          }}
          className="min-h-11 shrink-0 rounded-panel bg-brand-600 px-3 text-xs font-bold text-white hover:bg-brand-700"
        >
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
    </div>
  );
}

export function PortalRelationsCard({
  studentId,
  studentName,
  studentPhone,
  parentPhone,
  relations,
  invite,
  resend,
  revoke,
}: {
  studentId: string;
  studentName: string;
  /** 학생 본인 역할 채우기용(없으면 버튼 자체가 없다). */
  studentPhone: string | null;
  /** 보호자 역할 채우기용. */
  parentPhone: string;
  relations: PortalRelationItem[];
  invite: (formData: FormData) => Promise<PortalInviteResult>;
  resend: (relationId: string) => Promise<PortalInviteResult>;
  revoke: (relationId: string, reason: string) => Promise<CrmActionResult>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<PortalRoleValue>("guardian");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function applyResult(result: PortalInviteResult) {
    if (!result.ok) {
      setError(result.error ?? "처리에 실패했습니다.");
      setLink(null);
      setWarnings([]);
      return;
    }
    setError(null);
    setLink(result.link ?? null);
    setWarnings(result.warnings ?? []);
    router.refresh();
  }

  function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setLink(null);
    setWarnings([]);
    startTransition(async () => {
      const result = await invite(formData);
      applyResult(result);
      if (result.ok) {
        // 성공한 입력만 비운다 — 실패 시 다시 타이핑하게 만들지 않는다.
        setName("");
        setPhone("");
      }
    });
  }

  function handleResend(item: PortalRelationItem) {
    if (
      !window.confirm(
        `${ROLE_LABEL[item.role]} ${item.name}님의 링크를 새로 발급합니다.\n이전 링크는 즉시 사용할 수 없게 됩니다. 계속할까요?`,
      )
    )
      return;
    setError(null);
    setLink(null);
    setWarnings([]);
    startTransition(async () => {
      applyResult(await resend(item.relationId));
    });
  }

  function handleRevoke(item: PortalRelationItem) {
    const reason = window.prompt(
      `${ROLE_LABEL[item.role]} ${item.name}님의 포털 접근을 회수합니다.\n초대 링크와 로그인 세션이 함께 닫힙니다.\n\n회수 사유를 입력해 주세요.`,
      "",
    );
    if (reason === null) return; // 취소
    if (!reason.trim()) {
      setError("회수 사유를 입력해 주세요.");
      return;
    }
    setError(null);
    setLink(null);
    setWarnings([]);
    startTransition(async () => {
      const result = await revoke(item.relationId, reason);
      if (!result.ok) {
        setError(result.error ?? "회수에 실패했습니다.");
        return;
      }
      router.refresh();
    });
  }

  // 학생 본인 역할에 보호자 번호를 쓰면 학생 계정으로 보호자가 로그인하게 된다 —
  // 역할 분리(검수 16)가 첫 단추부터 무너지므로 학생 역할엔 학생 본인 번호만 제안한다.
  const quickFill =
    role === "student"
      ? studentPhone
        ? { label: "학생 본인 연락처 채우기", value: studentPhone }
        : null
      : role === "guardian"
        ? { label: "보호자 연락처 채우기", value: parentPhone }
        : null;

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-ink-soft">포털 관계</h2>
      <p className="mb-4 text-xs leading-relaxed text-muted">
        역할별로 초대를 발급하면 받는 사람마다 자기 링크로 로그인합니다. 역할이 다르면
        권한도 따로 관리되고, 회수하면 그 사람의 링크와 로그인 세션이 함께 닫힙니다.
      </p>

      {relations.length === 0 ? (
        <p className="rounded-lg bg-soft px-3 py-2 text-xs leading-relaxed text-muted">
          아직 발급된 포털 관계가 없습니다. 아래에서 첫 초대를 발급해 주세요.
        </p>
      ) : (
        <ul className="space-y-3">
          {relations.map((item) => (
            <li
              key={item.relationId}
              className="border-b border-line pb-3 last:border-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{ROLE_LABEL[item.role]}</Badge>
                <span className="text-sm font-bold">{item.name}</span>
                <Badge tone={item.status === "active" ? "success" : "warning"}>
                  {item.status === "active" ? "수락 완료" : "수락 대기"}
                </Badge>
                {!item.hasActiveLink && (
                  <Badge tone="danger">유효 링크 없음</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                {formatPhone(item.phone)} · {formatDate(item.invitedAt)} 발급
                {item.acceptedAt && ` · ${formatDate(item.acceptedAt)} 수락`}
              </p>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleResend(item)}
                  className="text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
                >
                  링크 재발송
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleRevoke(item)}
                  className="text-xs font-bold text-rose-600 hover:underline disabled:opacity-50"
                >
                  관계 회수
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleInvite} className="mt-5 border-t border-line pt-4">
        <input type="hidden" name="studentId" value={studentId} />
        <p className="mb-3 text-xs font-semibold text-ink-soft">
          {studentName} 학생 포털 초대 발급
        </p>
        <div className="space-y-3">
          <Field label="역할" required>
            <Select
              name="role"
              value={role}
              onChange={(e) => setRole(e.currentTarget.value as PortalRoleValue)}
            >
              {ROLE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
          <p className="rounded-lg bg-soft px-3 py-2 text-xs leading-relaxed text-muted">
            {ROLE_SCOPE[role]}
          </p>
          <Field label="이름" required>
            <Input
              name="name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="예: 김보호"
              autoComplete="off"
            />
          </Field>
          <Field
            label="연락처"
            required
            hint="숫자만 저장됩니다. 같은 번호로 이미 초대된 분이면 그분에게 역할만 추가됩니다."
          >
            <Input
              name="phone"
              value={phone}
              onChange={(e) => setPhone(e.currentTarget.value)}
              placeholder="010-0000-0000"
              inputMode="tel"
              autoComplete="off"
            />
          </Field>
          {quickFill && (
            <button
              type="button"
              onClick={() => setPhone(quickFill.value)}
              className="text-xs font-bold text-brand-700 hover:underline"
            >
              {quickFill.label}
            </button>
          )}
          {role === "student" && !studentPhone && (
            <p className="rounded-lg bg-soft px-3 py-2 text-xs leading-relaxed text-muted">
              등록된 학생 본인 연락처가 없습니다. 보호자 번호를 대신 쓰지 말고 학생 본인
              번호를 직접 입력해 주세요(보호자 번호로 발급하면 학생 권한으로 보호자가
              로그인하게 됩니다).
            </p>
          )}
        </div>

        {error && <p className="mt-3 text-sm font-bold text-rose-600">{error}</p>}
        {warnings.map((w) => (
          <p key={w} className="mt-3 text-xs font-bold text-amber-700">
            {w}
          </p>
        ))}
        {link && <IssuedLink link={link} />}

        <button
          type="submit"
          disabled={pending}
          className={cn(buttonClass("primary", "md"), "mt-4")}
        >
          {pending ? "처리 중..." : "초대 발급·발송"}
        </button>
      </form>
    </div>
  );
}
