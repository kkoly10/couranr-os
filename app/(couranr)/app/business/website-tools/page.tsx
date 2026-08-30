import { PageHeader } from "@/components/couranr/shell/parts";
import { WebsiteTools } from "@/components/couranr/settings/WebsiteTools";

export const metadata = { title: "Website tools — Couranr" };

/**
 * MER-013 — website tools.
 *
 * Registry constraint: "Do not turn Couranr into the merchant's product
 * checkout. Customer request still requires merchant validation." The embed
 * this screen generates is an anchor to a request form — never an iframe, a
 * script or anything resembling a checkout — and no price appears anywhere.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Website tools"
        description="Your delivery request link, QR code and website button."
      />
      <WebsiteTools />
    </>
  );
}
