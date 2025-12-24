import dynamic from "next/dynamic";

const CheckoutClient = dynamic(
  () => import("../../../components/courier/CheckoutClient"),
  { ssr: false }
);

export default function CourierCheckoutPage() {
  return <CheckoutClient />;
}
