"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import CheckoutForm from "./CheckoutForm";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_SHARABLE_KEY as string);

export default function PaymentClient() {
  const sp = useSearchParams();
  const router = useRouter();

  const clientSecret = sp.get("clientSecret");
  const orderNumber = sp.get("orderNumber") ?? "";

  if (!clientSecret) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Payment</h1>
        <p style={{ color: "#b91c1c" }}>Missing payment session. Please restart checkout.</p>
        <button onClick={() => router.push("/courier")}>Back</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 6 }}>Payment authorization</h1>
      {orderNumber && <div style={{ color: "#555" }}>Order #{orderNumber}</div>}

      <div style={{ marginTop: 16 }}>
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <CheckoutForm />
        </Elements>
      </div>

      <p style={{ marginTop: 14, color: "#555", fontSize: 13 }}>
        Your card will be authorized now and captured after delivery is completed.
      </p>
    </div>
  );
}