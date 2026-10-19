import type { Metadata, Viewport } from "next";
import { publicEnv } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_SITE_URL),
  title: { default: "Nextto — You're next.", template: "%s · Nextto" },
  description:
    "Bookings, invoices and M-Pesa payments for salons, tutors, cleaners, mechanics, clinics and photographers in Kenya.",
  applicationName: "Nextto",
  openGraph: { siteName: "Nextto", locale: "en_KE", type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1015" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-KE">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-bg"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
