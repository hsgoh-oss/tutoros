import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Rates } from "@/lib/types";

const WON_UNIT = 10000;

interface RateItem {
  key: keyof Rates;
  label: string;
  unit: string;
  recommended?: boolean;
}

const ITEMS: RateItem[] = [
  { key: "inperson", label: "대면 수업", unit: "시간당" },
  { key: "video", label: "화상 수업", unit: "시간당" },
  { key: "trial", label: "시범수업", unit: "1회(1시간)", recommended: true },
];

export function RatesPreview({ rates }: { rates: Rates }) {
  return (
    <div>
      <div className="grid gap-5 sm:grid-cols-3">
        {ITEMS.map((item) => (
          <div
            key={item.key}
            className={cn(
              "relative rounded-card border p-7 text-center shadow-card",
              item.recommended
                ? "border-brand-200 bg-brand-50"
                : "border-line bg-white",
            )}
          >
            {item.recommended && (
              <Badge className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
                첫 수업 추천
              </Badge>
            )}
            <p className="text-sm font-bold tracking-tight text-muted">
              {item.label} · {item.unit}
            </p>
            <p className="mt-4 text-4xl font-black tracking-tight text-ink">
              {rates[item.key] / WON_UNIT}만원
            </p>
          </div>
        ))}
      </div>
      <div className="mt-10 text-center">
        <Link
          href="/classes#calculator"
          className={buttonClass("primary", "md")}
        >
          수업료 계산기로 확인
        </Link>
      </div>
    </div>
  );
}
