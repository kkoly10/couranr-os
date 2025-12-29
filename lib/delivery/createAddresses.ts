import { supabase } from "../supabaseClient";

/**
 * Creates a single address record.
 * Used for both pickup and dropoff addresses.
 */
export async function createAddress(address: {
  label?: string;
  address_line: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  is_business?: boolean;
  business_hours?: string;
}) {
  const { data, error } = await supabase
    .from("addresses")
    .insert(address)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}