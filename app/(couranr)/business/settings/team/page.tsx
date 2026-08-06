import { PageHeader } from "@/components/couranr/shell/parts";
import { TeamMembers } from "@/components/couranr/settings/TeamMembers";

export const metadata = { title: "Team and permissions — Couranr" };

/**
 * MER-015 — team and permissions.
 *
 * Registry constraint: least privilege and tenant isolation. The permission
 * matrix lives in one pure module (lib/couranr/settings/permissions.ts), is
 * enforced again in SQL, and last-owner protection is a database rule taken
 * under a row lock rather than a check this screen performs.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Team and permissions"
        description="Who can sign in to this business, and what each role may do."
        breadcrumbs={[{ label: "Settings", href: "/business/settings" }, { label: "Team" }]}
      />
      <TeamMembers />
    </>
  );
}
