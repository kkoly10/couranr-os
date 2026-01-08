// app/courier/confirmation/page.tsx
import dynamic from "next/dynamic";

const ConfirmationClient = dynamic(
  () => import("./ConfirmationClient"),
  { ssr: false }
);

export default function ConfirmationPage() {
  return <ConfirmationClient />;
}
