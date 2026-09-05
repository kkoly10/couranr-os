import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HostedRequestFlow } from "@/components/couranr/hosted/HostedRequestFlow";
import {
  isHostedFailure,
  resolveHostedMerchant,
} from "@/lib/couranr/hosted/commands";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request delivery — Couranr",
  description: "Request local delivery from a business that uses Couranr.",
};

export default async function Page(
  props: { params: Promise<{ merchantSlug: string }> }
) {
  const { merchantSlug } = await props.params;
  const merchant = await resolveHostedMerchant(merchantSlug);
  if (isHostedFailure(merchant)) notFound();

  return (
    <div className="cr-mkt cr-send-page">
      <HostedRequestFlow
        merchantName={merchant.value.name}
        merchantSlug={merchant.value.slug}
      />
    </div>
  );
}
