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
      <CheckoutClientWrapper />
    </AuthGuard>
  );
}

function CheckoutClientWrapper() {
  // StripeProvider will be activated once clientSecret is set
  return (
    <StripeProvider clientSecret={null}>
      <CheckoutClient />
    </StripeProvider>
  );
}
