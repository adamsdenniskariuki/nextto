/**
 * Turn an untrusted "next" value (query string, email link) into a safe
 * same-site path. Prevents open redirects like ?next=https://evil.example.
 */
export function safeNextPath(
  next: string | null | undefined,
  origin: string,
  fallback = "/dashboard",
): string {
  if (!next) return fallback;
  try {
    const base = new URL(origin);
    const url = new URL(next, base);
    if (url.origin !== base.origin) return fallback;
    // Reject protocol-relative tricks such as "//evil.example" or "/\evil".
    if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) return fallback;
    const path = url.pathname + url.search;
    return path === "/" ? fallback : path;
  } catch {
    return fallback;
  }
}
