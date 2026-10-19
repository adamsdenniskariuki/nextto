"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";

const LINKS: { href: Route; label: string }[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/calendar", label: "Calendar" },
  { href: "/dashboard/customers", label: "Customers" },
  { href: "/dashboard/invoices", label: "Invoices" },
  { href: "/dashboard/reports", label: "Reports" },
];

/** A Client Component only because it needs the current path for aria-current. */
export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="-mb-px flex gap-1 overflow-x-auto">
      {LINKS.map(({ href, label }) => {
        const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="border-b-2 border-transparent px-3 py-2.5 text-sm font-medium whitespace-nowrap text-muted hover:text-ink aria-[current=page]:border-brand aria-[current=page]:text-ink"
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
