import { supabaseAdmin } from "../supabaseAdmin";

export type AddressInput = {
  address_line: string;
  city?: string;
  state?: string;
  zip?: string;
  is_business?: boolean;
};

export type AddressRecord = {
  id: string;
};

export async function createAddress(
  input: AddressInput
): Promise<AddressRecord> {
  const { address_line, city, state, zip, is_business } = input;

  const { data, error } = await supabaseAdmin
    .from("addresses")
    .insert({
      address_line,
      city: city ?? null,
      state: state ?? null,
      zip: zip ?? null,
      is_business: is_business ?? false,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      error?.message || "Failed to create address"
    );
  }

  return { id: data.id };
}
