-- =============================================================================
-- 0013 Public booking pages for the sitemap.
--
-- Concepts:
--   * A narrow SECURITY DEFINER read for anonymous callers: /sitemap.xml runs
--     without a user, and anon cannot SELECT businesses or services under RLS.
--     The function returns only what is already public on /b/[slug].
--   * Aggregates in a join: greatest(business, newest service) is the page's
--     last-modified date, so search engines recrawl after a price change.
--   * A business only appears once it has something to book (an active
--     service), so half-finished signups are not advertised.
-- =============================================================================

create function public.public_booking_pages()
returns table (slug text, last_modified timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.slug, greatest(b.updated_at, max(s.updated_at))
  from public.businesses b
  join public.services s on s.business_id = b.id and s.active
  group by b.id
  order by b.slug
  -- The sitemap protocol allows 50,000 URLs per file.
  limit 49000;
$$;

comment on function public.public_booking_pages() is
  'Slugs of businesses with at least one active service, for sitemap.xml.';

revoke execute on function public.public_booking_pages() from public;
grant execute on function public.public_booking_pages() to anon, authenticated;
