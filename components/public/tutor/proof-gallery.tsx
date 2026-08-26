"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

// 정사각 카드에 원본 비율이 다른 사진을 넣으므로 어디를 남길지 항목마다 정한다.
// 기본(가운데)으로 두면 세로 사진인 프로필(233x350)이 정수리에서 잘린다 — 얼굴이 든 사진은
// 위쪽을 남기고, 문서 스캔은 가운데가 자연스럽다.
const ITEMS = [
  { src: "/img/thumb-score-real.jpg", caption: "성적 증빙 자료", focus: "object-center" },
  { src: "/img/thumb-card-real.jpg", caption: "튜터 인증 자료", focus: "object-center" },
  { src: "/img/thumb-profile.jpg", caption: "프로필 사진", focus: "object-top" },
] as const;

export function ProofGallery() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const active = openIndex === null ? null : ITEMS[openIndex];

  // 라이트박스가 열려 있는 동안 Esc 닫기 + 배경 스크롤 잠금.
  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [openIndex]);

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-3">
        {ITEMS.map((item, i) => (
          <figure
            key={item.src}
            className="overflow-hidden rounded-card border border-line bg-white shadow-card"
          >
            <button
              type="button"
              onClick={() => setOpenIndex(i)}
              aria-label={`${item.caption} 크게 보기`}
              className="group block w-full cursor-pointer"
            >
              <Image
                src={item.src}
                alt={item.caption}
                width={440}
                height={440}
                className={cn(
                  "aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105",
                  item.focus,
                )}
              />
            </button>
            <figcaption className="p-4 text-center text-sm font-bold tracking-tight text-muted">
              {item.caption}
            </figcaption>
          </figure>
        ))}
      </div>

      {active && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active.caption}
          onClick={() => setOpenIndex(null)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/80 p-6 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setOpenIndex(null)}
            aria-label="닫기"
            className="absolute right-5 top-5 flex min-h-12 min-w-12 items-center justify-center rounded-full bg-white/10 text-3xl font-black leading-none text-white transition-colors hover:bg-white/20"
          >
            ×
          </button>
          <figure
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-full max-w-3xl flex-col items-center gap-4"
          >
            <Image
              src={active.src}
              alt={active.caption}
              width={1000}
              height={1000}
              className="max-h-[80vh] w-auto rounded-card object-contain shadow-lift"
            />
            <figcaption className="text-center text-sm font-bold tracking-tight text-white/90">
              {active.caption}
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}
