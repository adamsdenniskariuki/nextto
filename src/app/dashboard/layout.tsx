import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getMemberships, requireUser } from "@/lib/auth";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { email } = await requireUser();
  const memberships = await getMemberships();
  if (memberships.length === 0) redirect("/onboarding");

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Logo />
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted sm:inline">{email}</span>
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn-ghost">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-5 py-8">
        {children}
      </main>
    </>
  );
}
