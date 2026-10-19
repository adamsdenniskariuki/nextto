import Link from "next/link";

/** The Nextto mark: a queue of dots with the next one highlighted. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 font-extrabold ${className}`}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <rect width="28" height="28" rx="9" className="fill-ink" />
        <circle cx="8" cy="14" r="2.5" className="fill-bg opacity-40" />
        <circle cx="14" cy="14" r="2.5" className="fill-bg opacity-70" />
        <circle cx="20.5" cy="14" r="3.5" className="fill-brand" />
      </svg>
      <span className="text-lg tracking-tight">
        Nextto<span className="text-brand">.</span>
      </span>
    </Link>
  );
}
