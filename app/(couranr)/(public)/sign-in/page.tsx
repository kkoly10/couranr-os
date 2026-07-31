import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Sign in — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Sign in" />
      <ScreenPlaceholder
        screenId="PUB-002"
        name="Sign in"
        purpose="Authenticate merchants, drivers, and Operations users through one branded entry point."
      />
    </>
  );
}
