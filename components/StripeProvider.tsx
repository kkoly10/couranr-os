"use client";

import { ReactNode } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string
);

export default function StripeProvider({ children }: { children: ReactNode }) {
  return (
    <Elements
      stripe={stripePromise}
      options={{
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#2563eb"
          }
        }
      }}
    >
      {children}
    </Elements>
  );
}
