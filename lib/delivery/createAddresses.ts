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
    .select("id");

  if (error) throw new Error(`createAddresses failed: ${error.message}`);
  if (!data || data.length !== 2) throw new Error("createAddresses failed: missing inserted rows");

  return {
    pickupAddressId: data[0].id as string,
    dropoffAddressId: data[1].id as string,
  };
}
