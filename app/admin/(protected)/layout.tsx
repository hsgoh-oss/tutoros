import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/session";
import { resolveTenant } from "@/lib/tenant";
import { AdminSidebar } from "@/components/admin/sidebar";

export default async function AdminProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  const tenant = await resolveTenant();

  return (
    <div className="flex min-h-screen bg-soft">
      <AdminSidebar brandName={tenant.brandName} email={session.email} />
      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-7xl px-5 py-8 md:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
