"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const AdminHeaderTarget = createContext<HTMLElement | null>(null);

// Page titles and actions stay with their server-rendered page, then occupy the shared navbar.
export function AdminPageHeader({ children }: { children: ReactNode; className?: string }) {
  const target = useContext(AdminHeaderTarget);
  const header = <div className="dash-page-header">{children}</div>;
  return target ? createPortal(header, target) : header;
}
