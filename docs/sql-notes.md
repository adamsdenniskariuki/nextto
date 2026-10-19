# SQL notes: indexes and query plans

These notes explain why each non-obvious index exists, and how to check that
Postgres actually uses it. The plans below come from the local stack with the
seed data loaded:

```powershell
npm run db:start
docker exec -it supabase_db_nextto psql -U postgres
```

> **Reading plans on tiny data.** With a few dozen rows a sequential scan is
> genuinely cheapest, so the planner picks it. To see whether an index *can*
> be used, run `set enable_seqscan = off;` first (this session only). On
> production-sized data, use `explain (analyze, buffers)` without that setting.

## 1. Calendar: bookings overlapping a week

```sql
explain (costs off)
select * from bookings
where business_id = $1
  and during && tstzrange(now(), now() + interval '7 days');
```

```
Index Scan using bookings_business_during_idx on bookings
  Index Cond: ((business_id = ...) AND (during && tstzrange(...)))
```

`bookings_business_during_idx` is a **composite GiST index** on
`(business_id, during)`. A B-tree can't answer `&&` (overlaps); GiST can.
`btree_gist` lets GiST also index the plain `uuid` column, so a single index
handles both conditions.

The exclusion constraint `bookings_no_overlap` is backed by a similar GiST
index on `(staff_id, during)`. It's partial (`where status in (...)`), so
cancelled bookings never block a slot.

## 2. Receivables: outstanding invoices

```sql
explain (costs off)
select * from invoices
where business_id = $1 and kind = 'invoice'
  and status in ('issued', 'partially_paid')
order by due_date;
```

```
Index Scan using invoices_outstanding_idx on invoices
  Index Cond: (business_id = ...)
```

`invoices_outstanding_idx` is a **partial composite index**:
`(business_id, due_date) where kind = 'invoice' and status in ('issued','partially_paid')`.

- The planner proves the query's `WHERE` implies the index predicate, so
  `kind` and `status` vanish from the plan entirely.
- `due_date` is the second key, so rows come out already sorted and there is
  no Sort node.
- Paid, void and draft invoices (the vast majority over time) are never
  stored in this index at all, which keeps it small.

## 3. The M-Pesa expiry sweep (pg_cron, every minute)

```sql
explain (costs off)
select * from payments
where status = 'pending' and created_at < now() - interval '15 minutes';
```

```
Index Scan using payments_pending_idx on payments
  Index Cond: (created_at < (now() - '00:15:00'::interval))
```

`payments_pending_idx` is `(created_at) where status = 'pending'`. Pending
payments are a handful of rows at any moment, so this index stays tiny
however many payments the table holds. That matters for a query that runs
1,440 times a day.

## 4. Customer history, newest first

```sql
explain (costs off)
select * from bookings where customer_id = $1
order by lower(during) desc limit 10;
```

```
Limit
  ->  Sort  Sort Key: (lower(bookings.during)) DESC
        ->  Bitmap Heap Scan on bookings
              ->  Bitmap Index Scan on bookings_customer_start_idx
```

`bookings_customer_start_idx` is an **expression index** on
`(customer_id, lower(during) desc)`. On the seed data the planner chose a
bitmap scan plus sort, because a handful of rows is cheap to sort. With many
bookings per customer, expect a plain `Index Scan` with no Sort node. Check
again with `explain analyze` once real data exists.

## 5. RLS helpers and `(select ...)` wrapping

Policies are written as:

```sql
using (business_id in (select private.member_business_ids()))
```

and not as `using (private.is_member(business_id))`. The sub-select form is
evaluated **once per statement** (an InitPlan) and turned into a hash or
index lookup. Calling a function per row runs it once per row. The same
applies to `(select auth.uid())`.

`business_members_user_idx (user_id, business_id)` makes the helper itself
an index-only scan.

## 6. Other indexes worth knowing

| Index | Kind | Why |
| --- | --- | --- |
| `invitations_open_email_idx` | partial **unique** | Only one *open* invitation per email per business; accepted ones don't count. |
| `services_business_idx` | partial composite | Public booking page lists only active services, in order. |
| `bookings_series_idx` | partial | Most bookings aren't recurring; the index skips the NULLs. |
| `payments_business_paid_idx` | partial composite | Revenue reports read only succeeded payments by date. |
| `mpesa_callbacks_unprocessed_idx` | partial | Finds callbacks that arrived before their payment row. |
| `time_off_staff_during_idx` | GiST composite | Slot generation subtracts time off by staff and range. |
| `business_daily_stats_pk` | unique on a matview | Required for `refresh materialized view concurrently`. |
