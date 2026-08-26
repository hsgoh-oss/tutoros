import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

/**
 * 목록 화면의 상태 필터·검색 줄.
 *
 * 원래는 Card로 감싸고 있었는데, 칩 다섯 개와 검색칸 하나가 카드 여백까지 합쳐 170px을 먹어
 * 정작 데이터(세 줄)보다 필터가 더 커 보였다. 필터는 내용이 아니라 조작 도구라서 표면을
 * 따로 갖지 않는 편이 낫다 — 배경 위에 그냥 얹고, 시선은 아래 표로 바로 내려가게 둔다.
 */
export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mb-4 flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}
