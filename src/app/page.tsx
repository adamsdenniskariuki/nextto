import Link from "next/link";
import { Logo } from "@/components/logo";

const features = [
  {
    title: "Bookings that can't clash",
    body: "A public booking page with live availability. Postgres itself refuses double bookings.",
  },
  {
    title: "Invoices in a tap",
    body: "Numbered invoices and quotes with VAT, deposits and a WhatsApp-friendly share link.",
  },
  {
    title: "Paid by M-Pesa",
    body: "Send an STK push from any invoice or deposit. Payments reconcile themselves.",
  },
];

const presets = ["Salons & barbers", "Tutors", "Cleaners", "Mechanics", "Clinics", "Photographers"];

export default function HomePage() {
  return (
    <>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav aria-label="Main">
          <Link href="/login" className="btn-ghost">
            Sign in
          </Link>
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-5 pb-20">
        <section className="py-12 sm:py-20">
          <p className="eyebrow">Bookings · Invoices · M-Pesa</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-extrabold tracking-tight text-balance sm:text-7xl">
            You&rsquo;re next<span className="text-brand">.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-pretty text-muted">
            Nextto runs the busy parts of a Kenyan service business: who&rsquo;s coming, what they
            owe, and getting paid on M-Pesa.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className="btn-primary">
              Start free
            </Link>
          </div>
          <ul className="mt-10 flex flex-wrap gap-2" aria-label="Built for">
            {presets.map((p) => (
              <li
                key={p}
                className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-muted"
              >
                {p}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="features" className="grid gap-4 md:grid-cols-3">
          <h2 id="features" className="sr-only">
            Features
          </h2>
          {features.map((f) => (
            <article key={f.title} className="card">
              <h3 className="text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-muted">{f.body}</p>
            </article>
          ))}
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-6 text-sm text-muted">
          © Nextto · Made in Nairobi · Prices in KES
        </div>
      </footer>
    </>
  );
}
