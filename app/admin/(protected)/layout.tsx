import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { resolveTenant } from "@/lib/tenant";
import { AdminShell } from "@/components/admin/shell";

export default async function AdminProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  const tenant = await resolveTenant();

  return (
    <AdminShell brandName={tenant.brandName} email={session.email}>
      {children}
    </AdminShell>
  );
}
