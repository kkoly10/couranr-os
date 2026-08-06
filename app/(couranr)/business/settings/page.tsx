import { PageHeader } from "@/components/couranr/shell/parts";
import { MerchantSettings } from "@/components/couranr/settings/MerchantSettings";

export const metadata = { title: "Business settings — Couranr" };

/**
 * MER-014 — merchant settings.
 *
 * Registry constraint: "Locked policy registry wins over any mock values. No
 * subscription controls in pilot." Both are honoured — delivery policies are
 * read-only display of the accepted policy version, and there is no plan,
 * subscription or price control anywhere on this screen.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your business profile, pickup defaults and delivery policies."
      />
      <MerchantSettings />
    </>
  );
}
