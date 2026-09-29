import { PageHeader } from "@/components/couranr/shell/parts";
import { RouteRunsList } from "@/components/couranr/routes/RouteRunsList";

export const metadata = { title: "Route Runs — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Route Runs"
        description="Group 2–5 merchant-paid deliveries that leave from one common pickup."
      />
      <RouteRunsList />
    </>
  );
}
