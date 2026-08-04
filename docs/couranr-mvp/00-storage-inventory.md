# 00 — Storage inventory

> **Historical baseline — not current status.**
> Captured at 4137303 2026-07-30. The counts, gaps and warnings below
> describe the repository as it was THEN and are preserved as evidence of that
> baseline. Several are now false — notably the four P0 database issues, which
> are closed. For the current implementation state see
> [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md).

Read-only capture from the connected Supabase project `zrdxlrlqxdslqpnoqmus`.

| Bucket | Public | Objects | Bytes | Size limit | MIME allow-list |
|---|---|---|---|---|---|
| **`delivery-photos`** | **TRUE** | **0** | 0 | none | none |
| **`vehicle-images`** | **TRUE** | 3 | 699,320 | none | none |
| `docs-files` | false | 2 | 245,758 | none | none |
| `rental-files` | false | 9 | 4,170,658 | none | none |
| `rental-photos` | false | 6 | 4,751,311 | none | none |
| `renter-licenses` | false | 46 | 27,930,649 | 10 MiB | `image/*` |
| `renter-verifications` | false | 23 | 12,857,871 | none | none |

## Storage policies — 4 total, all for one bucket
`docs_files_select` · `docs_files_insert` · `docs_files_update` · `docs_files_delete` — all `authenticated`, scoped `bucket_id='docs-files'` with first-path-segment ownership or admin.

**No policies exist for `delivery-photos`, `vehicle-images`, `rental-files`, `rental-photos`, `renter-licenses`, `renter-verifications`.**

## Findings
- **`delivery-photos` is public with no policies** — delivery proof would be world-readable. Currently latent: 0 objects, and `public.delivery_photos` has 0 rows.
- `app/api/delivery/upload-pickup-photo/route.ts:197` builds a **public** URL; `app/api/customer/upload-pickup-photo/route.ts:125` builds an **authenticated-scheme** URL. The two upload paths disagree.
- 6 of 7 buckets set neither a size limit nor a MIME allow-list.
- None of the 6 private buckets required by the Master Package (`:833`) exists.
