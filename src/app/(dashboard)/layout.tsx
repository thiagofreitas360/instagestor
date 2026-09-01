import { AdminShell } from "@/components/admin-shell";
import { requireAdmin } from "@/server/auth";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireAdmin();
  return <AdminShell email={user.email}>{children}</AdminShell>;
}
