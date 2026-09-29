import * as React from "react";
import { PageHeader } from "@/components/couranr/shell/parts";
import { RouteRunDetail } from "@/components/couranr/routes/RouteRunDetail";

export const metadata = { title: "Route Run detail — Couranr" };

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return (
    <>
      <PageHeader
        title="Route Run"
        breadcrumbs={[
          { label: "Route Runs", href: "/app/business/routes" },
          { label: "Route detail" },
        ]}
      />
      <React.Suspense fallback={null}>
        <RouteRunDetail routeRunId={params.id} />
      </React.Suspense>
    </>
  );
}
