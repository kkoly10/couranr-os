import { supabase } from "../supabaseClient";

export type AddressInput = {
  address_line: string;
  city: string;
  state: string;
  zip: string;
  is_business: boolean;
  business_hours?: string;
};

export async function createAddresses({
  pickup,
  dropoff,
}: {
  pickup: AddressInput;
  dropoff: AddressInput;
}) {
  const { data, error } = await supabase
    .from("addresses")
    .insert([pickup, dropoff])
    .select();

  if (error || !data || data.length !== 2) {
    throw new Error("Failed to create addresses");
  }

  return {
    pickupAddressId: data[0].id,
    dropoffAddressId: data[1].id,
  };
}