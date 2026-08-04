import { PageHeader } from "@/components/couranr/shell/parts";
import { OperationsInbox } from "@/components/couranr/conversations/OperationsInbox";

export const metadata = { title: "Operations inbox — Couranr" };

/**
 * OPS-005 — Couranr Operations messages and support inbox.
 *
 * Purpose: "Unify merchant, driver, and customer-help conversations with
 * delivery context and priority." A projection over all three conversation
 * kinds, ordered overdue-first server-side.
 *
 * Mandatory correction: "Internal notes and AI drafts must be excluded from
 * participant queries, exports, realtime, and notifications." Operations is the
 * one viewer permitted to read an internal note; AI drafts are excluded even
 * here, because a draft is unsent. Both rules are enforced in the database.
 */
export default function Page() {
  return (
    <>
      <PageHeader title="Operations inbox" />
      <OperationsInbox />
    </>
  );
}
