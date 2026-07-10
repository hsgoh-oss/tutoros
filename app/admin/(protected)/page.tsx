import { redirect } from "next/navigation";

// /admin 진입점 — 대시보드로 보낸다.
export default function AdminIndexPage() {
  redirect("/admin/dashboard");
}
