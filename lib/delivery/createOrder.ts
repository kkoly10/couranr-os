import { supabaseAdmin } from "../supabaseAdmin";

export type CreateOrderInput = {
  customerId: string;
  totalCents: number;
  serviceType: "delivery" | "docs" | "auto";
  businessAccountId?: string | null;
};

export type CreateOrderResult = {
  id: string;
  order_number: string;
  total_cents: number;
  service_type: string;
  customer_id: string;
  status?: string;
  created_at: string;
};

export async function createOrder(
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  const { customerId, totalCents, serviceType, businessAccountId } = input;

  const { data, error } = await supabaseAdmin
    .from("orders")
    .insert({
      customer_id: customerId,
      total_cents: totalCents,
      service_type: serviceType,
      business_account_id: businessAccountId ?? null,
      status: "awaiting_payment",
      paid_at: null,
      stripe_checkout_session_id: null,
      stripe_payment_intent_id: null,
    })
    .select()
    .single();

  if (error || !data) {
    console.error("createOrder failed:", error);
    throw new Error(error?.message || "Failed to create order");
  }

  return data;
}