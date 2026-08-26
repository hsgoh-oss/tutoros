"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

// 정본(axiom-platform)의 TutorGallery — 큰 프로필 한 장 + 증빙 썸네일 세 장.
// 썸네일을 누르면 원본을 라이트박스로 연다. 증빙은 카드로 꾸미지 않고 사진 자체로 보여준다.

const PORTRAIT = {
  src: "/img/profile.jpg",
  alt: "AXIOM MATH LAB 고현서 튜터",
  width: 720,
  height: 1080,
} as const;

const EVIDENCE = [
  {
    src: "/img/thumb-score-real.jpg",
    label: "수학 1등급 성적표",
    width: 1100,
    height: 1100,
  },
  {
    src: "/img/thumb-card-real.jpg",
    label: "김과외 상위 0.2% 명함",
    width: 1100,
    height: 989,
  },
  {
    src: "/img/admission-hanyang.webp",
    label: "한양대 논술전형 합격통지서",
    width: 900,
    height: 1274,
  },
] as const;

export function ProofGallery() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const active = openIndex === null ? null : EVIDENCE[openIndex];

  const close = useCallback(() => {
    setOpenIndex(null);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  // 열려 있는 동안: 닫기 버튼으로 포커스 이동, Esc·좌우 이동, 배경 스크롤 잠금.
  useEffect(() => {
    if (openIndex === null) return;
    const focusFrame = window.requestAnimationFrame(() =>
      closeRef.current?.focus(),
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setOpenIndex((i) => (i === null ? null : Math.max(0, i - 1)));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setOpenIndex((i) =>
          i === null ? null : Math.min(EVIDENCE.length - 1, i + 1),
        );
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [openIndex, close]);

  return (
    <div>
      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line">
        <Image
          src={PORTRAIT.src}
          alt={PORTRAIT.alt}
          width={PORTRAIT.width}
          height={PORTRAIT.height}
          priority
          sizes="(max-width: 900px) calc(100vw - 32px), 410px"
          className="block h-auto w-full"
        />
      </div>

      <div
        className="mt-3 grid grid-cols-3 gap-3"
        role="group"
        aria-label="튜터 증빙 자료"
      >
        {EVIDENCE.map((item, i) => (
          <button
            key={item.src}
            type="button"
            aria-label={`${item.label} 크게 보기`}
            onClick={(event) => {
              returnFocusRef.current = event.currentTarget;
              setOpenIndex(i);
            }}
            className="group cursor-pointer text-left"
          >
            <span className="block overflow-hidden rounded-[var(--radius-sm)] border border-line group-hover:border-brand-600">
              <Image
                src={item.src}
                alt=""
                aria-hidden="true"
                width={item.width}
                height={item.height}
                sizes="(max-width: 420px) 28vw, 110px"
                className="block aspect-[4/3] w-full object-cover"
              />
            </span>
            <span className="mt-1.5 block text-[11.5px] font-bold leading-snug tracking-[-0.02em] text-faint group-hover:text-brand-600">
              {item.label}
            </span>
          </button>
        ))}
      </div>

      {active && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active.label}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/86 p-5"
        >
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="갤러리 닫기"
            className="absolute top-[max(10px,env(safe-area-inset-top))] right-[max(10px,env(safe-area-inset-right))] grid h-11 w-11 place-items-center rounded-full bg-white/14 text-2xl leading-none font-extrabold text-white hover:bg-white/28"
          >
            <span aria-hidden="true">×</span>
          </button>

          <figure className="flex max-h-full max-w-4xl flex-col items-center gap-4">
            <Image
              key={active.src}
              src={active.src}
              alt={active.label}
              width={active.width}
              height={active.height}
              sizes="(max-width: 640px) calc(100vw - 32px), 920px"
              className="max-h-[80dvh] w-auto rounded-[var(--radius-card)] object-contain shadow-overlay"
            />
            <figcaption className="text-center text-sm font-bold tracking-tight text-white/90">
              {active.label}
            </figcaption>
          </figure>

          <div className="absolute inset-x-5 bottom-5 flex justify-between">
            {[-1, 1].map((direction) => {
              const next = openIndex! + direction;
              const disabled = next < 0 || next >= EVIDENCE.length;
              return (
                <button
                  key={direction}
                  type="button"
                  disabled={disabled}
                  onClick={() => setOpenIndex(next)}
                  aria-label={direction === -1 ? "이전 사진" : "다음 사진"}
                  className={cn(
                    "grid h-12 w-12 place-items-center rounded-full border border-white/32 bg-ink/70 text-3xl leading-none text-white",
                    disabled
                      ? "cursor-default opacity-28"
                      : "hover:border-white hover:bg-brand-600/90",
                  )}
                >
                  <span aria-hidden="true">
                    {direction === -1 ? "‹" : "›"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
