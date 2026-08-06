import { PageHeader } from "@/components/couranr/shell/parts";
import { ConversationList } from "@/components/couranr/conversations/ConversationList";

export const metadata = { title: "Messages — Couranr" };

/**
 * DRV-008 — driver messages.
 *
 * Purpose: "Show delivery-specific merchant messages and Couranr Support
 * conversations."
 *
 * Mandatory correction: "No unrestricted customer chat and no personal phone
 * exposure." A driver cannot reach a customer here and it is not a UI choice —
 * no conversation kind admits both a customer and a driver, enforced by a
 * database trigger, so this list cannot contain such a thread.
 *
 * A driver also sees only what was said while they were assigned: the reader
 * function windows drivers, and only drivers, to their assignment tenure.
 *
 * NOT BUILT HERE: Driving Mode alert suppression is P8-003 and is unrelated to
 * what this page renders — it governs notifications, not the thread.
 */
export default function Page() {
  return (
    <>
      <PageHeader title="Messages" />
      <ConversationList emptyBody="Messages about your deliveries appear here." />
    </>
  );
}
