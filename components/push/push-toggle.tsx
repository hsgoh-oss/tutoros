"use client";

import { useCallback, useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";

// 웹 푸시 켜기/끄기 — 운영자 설정 화면과 포털 홈이 같은 컴포넌트를 쓴다.
//
// 흐름: 지원 여부 확인 → 서비스 워커 등록(/sw.js) → 기존 구독 조회 → 서버에 "이 기기가 내 이름으로
// 살아 있는가" 확인(check). 켜기는 사용자가 버튼을 눌렀을 때만 권한을 묻는다(자동 프롬프트 금지 —
// 처리방침 10절 "필수·보안 외 항목의 기본값은 모두 꺼짐"). 끄기는 브라우저 구독 해지 + 서버 행 삭제.
//
// iOS는 홈 화면에 추가한 뒤에만(16.4+) 푸시가 된다 — 지원 안 됨 대신 그 안내를 보여 준다.

export type PushActionResult = { ok: boolean; error?: string };

export interface PushToggleProps {
  publicKey: string | null;
  save: (subscription: unknown, userAgent: string) => Promise<PushActionResult>;
  remove: (endpoint: string) => Promise<PushActionResult>;
  check: (endpoint: string) => Promise<boolean>;
  /** 있으면 "테스트 발송" 버튼을 그린다(운영자용). */
  sendTest?: () => Promise<PushActionResult>;
  /** 버튼 옆 설명 한 줄. */
  description?: string;
  compact?: boolean;
}

type State =
  | "checking"
  | "unsupported"
  | "ios-install"
  | "unconfigured"
  | "denied"
  | "off"
  | "on";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function isIosNotInstalled(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
  if (!ios) return false;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return !standalone;
}

export function PushToggle({
  publicKey,
  save,
  remove,
  check,
  sendTest,
  description,
  compact = false,
}: PushToggleProps) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) return setState("unconfigured");
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return setState(isIosNotInstalled() ? "ios-install" : "unsupported");
    }
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      if (Notification.permission === "denied") return setState("denied");
      if (!sub) return setState("off");
      const alive = await check(sub.endpoint);
      setState(alive ? "on" : "off");
    } catch (err) {
      console.error("[push] 상태 확인 실패", err);
      setState("unsupported");
    }
  }, [publicKey, check]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = async () => {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        setMessage("알림 권한이 허용되지 않았습니다.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const result = await save(sub.toJSON(), navigator.userAgent);
      if (!result.ok) {
        setMessage(result.error ?? "구독을 저장하지 못했습니다.");
        return;
      }
      setState("on");
      setMessage("이 기기에서 알림을 받습니다.");
    } catch (err) {
      console.error("[push] 구독 실패", err);
      setMessage("이 브라우저에서는 푸시를 켤 수 없습니다. 브라우저 설정의 알림 권한을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await remove(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setMessage("이 기기의 알림을 껐습니다.");
    } catch (err) {
      console.error("[push] 구독 해제 실패", err);
      setMessage("알림을 끄지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!sendTest) return;
    setBusy(true);
    setMessage(null);
    const result = await sendTest();
    setMessage(result.ok ? "테스트 알림을 보냈습니다. 몇 초 안에 기기에 떠야 합니다." : result.error ?? "테스트 발송 실패");
    setBusy(false);
  };

  const statusLabel: Record<State, string> = {
    checking: "확인 중…",
    unsupported: "이 브라우저는 웹 푸시를 지원하지 않습니다.",
    "ios-install":
      "iPhone·iPad는 공유 버튼 → '홈 화면에 추가'로 설치한 뒤 그 아이콘으로 열어야 알림을 켤 수 있습니다.",
    unconfigured: "푸시 키가 설정되지 않아 지금은 켤 수 없습니다.",
    denied: "브라우저에서 알림이 차단되어 있습니다. 주소창의 사이트 설정에서 알림을 허용한 뒤 다시 시도해 주세요.",
    off: "이 기기에서는 알림이 꺼져 있습니다.",
    on: "이 기기에서 알림을 받고 있습니다.",
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <p className="m-0 flex items-center gap-2 text-sm text-ink-soft">
        <span
          aria-hidden="true"
          className={`inline-block h-2.5 w-2.5 rounded-full ${state === "on" ? "bg-emerald-500" : state === "off" ? "bg-line-strong" : "bg-amber-400"}`}
        />
        {statusLabel[state]}
      </p>
      {description && state !== "on" && (
        <p className="m-0 text-xs leading-relaxed text-muted">{description}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {state === "off" || state === "checking" ? (
          <button
            type="button"
            disabled={busy || state === "checking"}
            onClick={enable}
            className={buttonClass("primary", "sm")}
          >
            {busy ? "처리 중…" : "알림 켜기"}
          </button>
        ) : state === "on" ? (
          <>
            <button type="button" disabled={busy} onClick={disable} className={buttonClass("outline", "sm")}>
              {busy ? "처리 중…" : "알림 끄기"}
            </button>
            {sendTest && (
              <button type="button" disabled={busy} onClick={test} className={buttonClass("ghost", "sm")}>
                테스트 발송
              </button>
            )}
          </>
        ) : null}
      </div>
      {message && (
        <p role="status" className="m-0 text-xs font-bold text-ink-soft">
          {message}
        </p>
      )}
    </div>
  );
}
