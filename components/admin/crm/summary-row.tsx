import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { NavIcon, type NavIconName } from "@/components/admin/nav-icons";

type SummaryItem = {
  label: string;
  value: ReactNode;
  href?: string;
  icon?: NavIconName;
  detail?: ReactNode;
  attention?: boolean;
};

export function SummaryRow({ items }: { items: SummaryItem[] }) {
  return (
    <div className="dash-summary" data-count={items.length}>
      {items.map((item) => {
        const Icon = item.icon ? NavIcon[item.icon] : null;
        const content = <>
          {Icon && <span className="dash-summary-icon"><Icon size={19} /></span>}
          <dl>
            <dt>{item.label}</dt>
            <dd className={cn(item.attention && "is-attention")}>{item.value}</dd>
            {item.detail && <dd className="dash-summary-detail">{item.detail}</dd>}
          </dl>
        </>;
        return item.href ? (
          <Link key={item.label} href={item.href} className="dash-summary-item">{content}</Link>
        ) : (
          <div key={item.label} className="dash-summary-item">{content}</div>
        );
      })}
    </div>
  );
}
