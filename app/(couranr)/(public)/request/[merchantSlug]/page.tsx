import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getPublicHostedMerchant,
  isHostedFailure,
} from "@/lib/couranr/hosted/commands";
import { HostedRequestFlow } from "@/components/couranr/hosted/HostedRequestFlow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request delivery — Couranr",
  description: "Request delivery from a local business using Couranr.",
};

/**
 * PUB-004 merchant-hosted mode.
 *
 * A slug is public distribution identity, not request tenancy. The server
 * resolves only a live + published merchant; the browser never receives a
 * business account id and therefore cannot choose which merchant owns the
 * validation relationship.
 */
export default async function HostedRequestPage(
  props: { params: Promise<{ merchantSlug: string }> }
) {
  const { merchantSlug } = await props.params;
  const merchant = await getPublicHostedMerchant(merchantSlug);
  if (isHostedFailure(merchant)) {
    if (merchant.code === "not_found") notFound();
    throw new Error(`Hosted request merchant lookup failed: ${merchant.correlationId}`);
  }

  return (
    <div className="cr-mkt cr-send-page">
      <HostedRequestFlow merchant={merchant.value} />
    </div>
  );
}
