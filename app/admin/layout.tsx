import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "관리자", template: "%s | TUTOR OS 관리자" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
