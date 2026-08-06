// app/dashboard/docs/[requestId]/page.tsx
import DocsRequestDetailClient from "./DocsRequestDetailClient";

export default async function DocsRequestDetailPage(
  props: {
    params: Promise<{ requestId: string }>;
  }
) {
  const params = await props.params;
  return <DocsRequestDetailClient requestId={params.requestId} />;
}
