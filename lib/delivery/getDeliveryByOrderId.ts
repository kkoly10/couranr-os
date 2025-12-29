import { supabase } from "../supabaseClient";

/**
 * Fetches a delivery with its order and addresses.
 * RLS guarantees the customer can only access their own data.
 */
export async function getDeliveryByOrderId(orderId: string) {
  if (!orderId) {
    throw new Error("orderId is required");
  }

  const { data, error } = await supabase
    .from("deliveries")
    .select(`
      id,
      order_id,
      recipient_name,
      recipient_phone,
      recipient_email,
      signature_required,
      rush,
      estimated_miles,
      weight_lbs,
      base_fee_cents,
      mileage_fee_cents,
      weight_fee_cents,
      rush_fee_cents,
      signature_fee_cents,
      pricing_version,
      created_at,

      orders (
        id,
        order_number,
        status,
        subtotal_cents,
        fees_cents,
        total_cents,
        currency,
        created_at
      ),

      pickup_address:addresses!deliveries_pickup_address_id_fkey (
        id,
        address_line,
        city,
        state,
        zip,
        country,
        lat,
        lng,
        is_business,
        business_hours
      ),

      dropoff_address:addresses!deliveries_dropoff_address_id_fkey (
        id,
        address_line,
        city,
        state,
        zip,
        country,
        lat,
        lng,
        is_business,
        business_hours
      )
    `)
    .eq("order_id", orderId)
    .single();

  if (error) {
    throw error;
  }

  return data;
}