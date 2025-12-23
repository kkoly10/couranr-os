import dynamic from "next/dynamic";
import AuthGuard from "../../../components/AuthGuard";
import StripeProvider from "../../../components/StripeProvider";

const CheckoutClient = dynamic(
  () => import("../../../components/courier/CheckoutClient"),
  { ssr: false }
);

export default function CourierCheckoutPage() {
  return (
    <AuthGuard>
      <StripeProvider>
        <CheckoutClient />
      </StripeProvider>
    </AuthGuard>
  );
}
