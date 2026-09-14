import type { Metadata } from "next";
import { AdminTheme } from "@/components/admin/theme";
import "./admin.css";

export const metadata: Metadata = {
  title: { default: "관리자", template: "%s | TUTOR OS 관리자" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AdminTheme>{children}</AdminTheme>;
}
