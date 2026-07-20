import { cn } from "@/lib/cn";
import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const control =
  "w-full rounded-panel border border-line bg-white px-4 py-3 text-[15px] text-ink placeholder:text-muted/70 outline-none transition-colors focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-soft";

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
      <span className="mb-1.5 flex items-center gap-1 text-sm font-bold text-ink-soft">
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
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(control, "min-h-28 resize-y", className)} {...props} />
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
      <select className={cn(control, "appearance-none pr-10", className)} {...props}>
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
