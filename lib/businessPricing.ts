import type { SupabaseClient } from "@supabase/supabase-js";

export type BusinessPricingProfile = {
  business_account_id: string;
  delivery_discount_pct?: number | null;
  delivery_flat_fee_cents?: number | null;
  docs_discount_pct?: number | null;
  docs_flat_fee_cents?: number | null;
  status?: string | null;
};

function toNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pctMultiplier(pct: number | null | undefined) {
  const n = toNumber(pct);
  if (n === null) return 1;
  const safe = Math.min(100, Math.max(0, n));
  return (100 - safe) / 100;
}

export async function getBusinessPricingProfile(
  supabase: SupabaseClient,
  businessAccountId: string
): Promise<BusinessPricingProfile | null> {
  const { data, error } = await supabase
    .from("business_pricing_profiles")
    .select(
      "business_account_id,delivery_discount_pct,delivery_flat_fee_cents,docs_discount_pct,docs_flat_fee_cents,status"
    )
    .eq("business_account_id", businessAccountId)
    .in("status", ["active", "draft"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    return data as BusinessPricingProfile;
  }

  const msg = error?.message || "";
  if (/relation .*business_pricing_profiles.* does not exist/i.test(msg) || /schema cache/i.test(msg)) {
    return null;
  }

  if (error) {
    throw new Error(error.message || "Failed to load business pricing profile");
  }

  return null;
}

export function applyBusinessDeliveryPricing(baseAmountCents: number, profile: BusinessPricingProfile | null) {
  const fallback = Math.max(50, Math.round(baseAmountCents || 0));
  if (!profile) return { amountCents: fallback, strategy: "base" as const };

  const flat = toNumber(profile.delivery_flat_fee_cents);
  if (flat !== null && flat > 0) {
    return {
      amountCents: Math.max(50, Math.round(flat)),
      strategy: "delivery_flat_fee_cents" as const,
    };
  }

  const amount = Math.max(50, Math.round(fallback * pctMultiplier(profile.delivery_discount_pct)));
  return {
    amountCents: amount,
    strategy: profile.delivery_discount_pct ? "delivery_discount_pct" as const : "base" as const,
  };
}

export function applyBusinessDocsPricing(baseAmountCents: number, profile: BusinessPricingProfile | null) {
  const fallback = Math.max(50, Math.round(baseAmountCents || 0));
  if (!profile) return { amountCents: fallback, strategy: "base" as const };

  const flat = toNumber(profile.docs_flat_fee_cents);
  if (flat !== null && flat > 0) {
    return {
      amountCents: Math.max(50, Math.round(flat)),
      strategy: "docs_flat_fee_cents" as const,
    };
  }

  const amount = Math.max(50, Math.round(fallback * pctMultiplier(profile.docs_discount_pct)));
  return {
    amountCents: amount,
    strategy: profile.docs_discount_pct ? "docs_discount_pct" as const : "base" as const,
  };
}
