"use client";

// Next 15: `ssr: false` is only legal in a Client Component. This page only
// renders a client child, so making the page itself client is the minimal fix.
import dynamic from "next/dynamic";

const ConfirmationClient = dynamic(
  () => import("./ConfirmationClient"),
  { ssr: false }
);

export default function ConfirmationPage() {
  return <ConfirmationClient />;
}
