import { Logo } from "@/components/logo";
import { getCurrentMembership, getMemberships, requireUser } from "@/lib/auth";
import { switchBusiness } from "./actions";
import { DashboardNav } from "./dashboard-nav";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { email } = await requireUser();
  const memberships = await getMemberships();
  // Redirects to /onboarding when the user has no business yet.
  const current = await getCurrentMembership();

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-3">
          <Logo />
          <div className="flex items-center gap-2">
            {memberships.length > 1 && (
              <form action={switchBusiness} className="flex items-center gap-1">
                <label htmlFor="business-switch" className="sr-only">
                  Business
                </label>
                <select
                  id="business-switch"
                  name="businessId"
                  defaultValue={current.business.id}
                  className="input min-h-9 w-auto max-w-48 py-1 text-sm"
                >
                  {memberships.map((m) => (
                    <option key={m.business.id} value={m.business.id}>
                      {m.business.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn-ghost min-h-9 px-3">
                  Switch
                </button>
              </form>
            )}
            <span className="hidden text-sm text-muted md:inline">{email}</span>
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn-ghost min-h-9 px-3">
                Sign out
              </button>
            </form>
          </div>
          <div className="w-full">
            <DashboardNav />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-5 py-8">
        {children}
      </main>
    </>
  );
}
