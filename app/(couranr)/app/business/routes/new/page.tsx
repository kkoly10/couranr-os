import { PageHeader } from "@/components/couranr/shell/parts";
import { RouteBuilder } from "@/components/couranr/routes/RouteBuilder";

export const metadata = { title: "New Route Run — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Create Route Run"
        description="Enter the shared pickup once, then add each customer destination and package."
        breadcrumbs={[
          { label: "Route Runs", href: "/app/business/routes" },
          { label: "New Route Run" },
        ]}
      />
      <RouteBuilder />
    </>
  );
}
