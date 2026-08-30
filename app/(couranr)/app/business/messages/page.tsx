import { PageHeader } from "@/components/couranr/shell/parts";
import { ConversationList } from "@/components/couranr/conversations/ConversationList";

export const metadata = { title: "Messages and support — Couranr" };

/**
 * MER-012 — merchant messages and support.
 *
 * Purpose, from the registry: "Centralize merchant–driver delivery chat and
 * merchant–Couranr Support conversations." Both kinds appear in one list,
 * scoped by the caller's own participant rows — the route takes no tenant
 * parameter, so there is nothing for a future change to forget to validate.
 *
 * Mandatory correction: "No public phone. Messages never directly mutate
 * address, price, cancellation, refund, return, proof, or state." There is no
 * phone number on this page, and the composer says so in as many words.
 */
export default function Page() {
  return (
    <>
      <PageHeader title="Messages and support" />
      <ConversationList emptyBody="Delivery chats and Couranr Support conversations appear here." />
    </>
  );
}
