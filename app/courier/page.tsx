import dynamic from "next/dynamic";
import AuthGuard from "../../components/AuthGuard";

const QuoteClient = dynamic(() => import("../../components/courier/QuoteClient"), {
  ssr: false
});

export default function CourierPage() {
  return (
    <AuthGuard>
      <QuoteClient />
    </AuthGuard>
  );
}
