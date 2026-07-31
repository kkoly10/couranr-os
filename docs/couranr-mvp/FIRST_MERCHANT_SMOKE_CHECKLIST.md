# First merchant smoke checklist

For the product owner to run **by hand, through the real UI**, against production.

Nothing in this checklist is automated, and no script in this repo creates a
production business account or delivery request. Creating the first real
merchant is a decision, not a test fixture.

**Before you start**

- The four Couranr migrations are applied: `20260731045417`, `20260731055802`,
  `20260731061356` (plus the `remote_schema` baseline).
- You have an email address you can receive mail at, which is **not** the
  address on any Couranr Operations or admin account. An Operations profile is
  refused at onboarding by design, in both the application and the database.
- Nothing here charges anything. This release takes no payment.

---

## 1. Sign up — PUB-003

| | Step | Expect |
|---|---|---|
| ☐ | Open `/sign-up` | The Couranr sign-up form. No card fields, no pricing claims |
| ☐ | Enter a work email and a password of 8+ characters | — |
| ☐ | Submit | Either you land on `/business/onboarding`, or you are told to confirm your email |
| ☐ | If asked, confirm the email, then sign in at `/sign-in` | You reach the merchant area |

## 2. Onboarding — MER-002

| | Step | Expect |
|---|---|---|
| ☐ | Open `/business/onboarding` | Six fields only: name, category, pickup address, phone, payer default, policy acceptance |
| ☐ | Confirm what is **absent** | No Stripe/card setup, no logo upload, no team invitations |
| ☐ | Submit with the policy box unticked | Inline error on that field. Nothing is created |
| ☐ | Tick the box and submit | You land on `/business` |
| ☐ | Press the browser Back button and submit the same form again | You are told the workspace already exists — **not** a second workspace |

**Check in the database (read-only):** exactly one new `business_accounts` row,
one `business_members` row with `role = 'owner'` and `status = 'active'` for
your user, and one `couranr_merchant_workspaces` row. If you see an account
without a matching membership, stop and report it — that is the failure mode
the atomic function exists to prevent.

## 3. Create and price a delivery — MER-005

| | Step | Expect |
|---|---|---|
| ☐ | Open `/business/deliveries/new` | The intake form. No price field anywhere |
| ☐ | Fill pickup, dropoff, loaded miles and weight | — |
| ☐ | Press **Calculate estimate** | You move to the review step with a breakdown |
| ☐ | Go **Back to details**, change the loaded miles, and calculate again | The estimate reflects the **new** distance |
| ☐ | Tick **Request overnight** and calculate | "Couranr will confirm your price" — no automatic amount |
| ☐ | Untick it and calculate again | An estimate returns |

## 4. Review and submit — MER-006

| | Step | Expect |
|---|---|---|
| ☐ | Read the quote panel | It says **subtotal**, never "total" or "amount due" |
| ☐ | Confirm the copy | It states that submitting does not charge you |
| ☐ | Press **Submit for Couranr review** | You land on the delivery detail page |
| ☐ | Press Back and submit again | A conflict message, not a second submission |

## 5. Delivery detail — MER-007

| | Step | Expect |
|---|---|---|
| ☐ | Read the status | "Pending Couranr review" |
| ☐ | Read the History card | Three entries: created, estimated, submitted |
| ☐ | Check the amounts | A subtotal, and no amount presented as payable |

## 6. Operations queue — OPS-002

| | Step | Expect |
|---|---|---|
| ☐ | Sign in as a Couranr Operations user (`profiles.role` = `admin` or `operations`) | — |
| ☐ | Open `/operations/queue` | Your request is listed, oldest first |
| ☐ | Press **Open for review** | The row refreshes; no error |
| ☐ | Press it again on the stale row | A conflict message |
| ☐ | Confirm what is **absent** | No accept, requote or decline button — those states are not built |

## 7. Boundaries worth confirming once

| | Step | Expect |
|---|---|---|
| ☐ | While signed in as Operations, open `/business/onboarding` and try to create a workspace | Refused: an Operations account cannot own a merchant workspace |
| ☐ | Sign out entirely and open `/business/deliveries/new` | You are asked to sign in. No merchant data is visible |
| ☐ | Trigger any error and note the message | It ends with a `cr_…` reference and names no table, column or constraint |

---

## If something fails

Write down the `cr_…` reference from the screen. It is the correlation id, and
the matching server log line carries the real cause. Nothing about the failure
is shown in the browser beyond that reference, so the log is the only place the
detail exists.

**Do not** fix a stuck record by editing rows by hand. Every state change goes
through a named command that also writes an audit event; a manual `UPDATE`
leaves a state change with no event, which is precisely the class of defect
Commit I removed.

## Known not built

Accept-as-quoted, requote and decline are canonical states that no command in
this release can reach. Managed dispatch — vehicle, driver and schedule
selection — has no data behind it yet. Payment is not integrated. A submitted
request creates no order and no delivery row.
