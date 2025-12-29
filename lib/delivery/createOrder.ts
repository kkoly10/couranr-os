import { supabase } from "../supabaseClient";

/**
 * Creates a delivery order record.
 * This is platform-level and service-agnostic.
 */
export async function createDeliveryOrder({
  customerId,
  subtotalCents,
  feesCents,
  totalCents,
}: {
  customerId: string;
  subtotalCents: number;
  feesCents: number;
  totalCents: number;
}) {
  const { data, error } = await supabase
    .from("orders")
    .insert({
      service_type: "delivery",
      customer_id: customerId,
      status: "draft",
      subtotal_cents: subtotalCents,
      fees_cents: feesCents,
      total_cents: totalCents,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}