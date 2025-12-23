"use client";

import { ReactNode } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string
);

export default function StripeProvider({
  children,
  clientSecret
}: {
  children: ReactNode;
  clientSecret: string | null;
}) {
  if (!clientSecret) return <>{children}</>;

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: "stripe"
        }
      }}
    >
      {children}
    </Elements>
  );
}
