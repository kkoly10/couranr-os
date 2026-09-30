/** Safe browser projection; provider Customer and PaymentMethod ids never leave the server. */
export type BusinessPaymentMethodSummary =
  | { state: "none" }
  | { state: "ready"; brand: string; last4: string };
