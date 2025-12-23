import dynamic from "next/dynamic";
import AuthGuard from "../../../components/AuthGuard";

const CheckoutClient = dynamic(
  () => import("../../../components/courier/CheckoutClient"),
  { ssr: false }
);

export default function CourierCheckoutPage() {
  return (
    <AuthGuard>
      <CheckoutClient />
    </AuthGuard>
  );
}
