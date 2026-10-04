import { AdminShell } from "@/components/admin-shell";
import { getSqlClient } from "@/db/client";
import { requireAdmin } from "@/server/auth";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireAdmin();
  const [settings] = await getSqlClient()<Array<{ theme: "LIGHT" | "DARK" }>>`
    SELECT theme FROM settings WHERE organization_id = ${user.organizationId}
  `;
  return (
    <AdminShell
      email={user.email}
      organizationName={user.organizationName}
      theme={settings?.theme ?? "LIGHT"}
      isPlatformAdmin={user.isPlatformAdmin}
    >
      {children}
    </AdminShell>
  );
}
