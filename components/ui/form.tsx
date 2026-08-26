import { cn } from "@/lib/cn";
import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

// 입력칸의 공통 겉모습. 높이는 여기에 두지 않는다 — 한 줄짜리(input·select)와 여러 줄(textarea)이
// 서로 다르기 때문이다.
const control =
  "w-full rounded-[var(--radius-field)] border border-line bg-white px-3.5 text-[15px] text-ink placeholder:text-muted/70 outline-none transition-colors focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-soft";

// 한 줄 입력은 버튼과 같은 높이 토큰을 쓴다. 예전엔 padding으로 높이가 정해져 입력 45px·버튼 40px로
// 5px씩 어긋났고, 나란히 놓인 폼에서 눈에 띄게 삐뚤어 보였다.
const controlOneLine = "h-[var(--ui-h-md)]";

export function Field({
  label,
  required,
  hint,
  children,
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("block", className)} {...props}>
      <span className="mb-1.5 flex items-center gap-1 text-sm [font-weight:var(--ui-w-label)] text-ink-soft">
        {label}
        {required && <span className="text-brand-600">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, controlOneLine, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(control, "min-h-28 resize-y py-2.5", className)} {...props} />
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  // appearance-none으로 네이티브 화살표를 지우므로, 직접 쉐브론을 얹어 "드롭다운" 어포던스를 준다.
  return (
    <div className="relative">
      <select className={cn(control, controlOneLine, "appearance-none pr-10", className)} {...props}>
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
      >
        <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
