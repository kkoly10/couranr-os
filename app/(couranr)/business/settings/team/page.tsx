import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Team and permissions — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader title="Team and permissions" />
      <ScreenPlaceholder
        screenId="MER-015"
        name="Team and permissions"
        purpose="Invite staff and manage owner, manager/dispatcher, billing, counter-staff, and view-only access."
      />
    </>
  );
}
