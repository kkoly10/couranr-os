// app/dashboard/docs/[requestId]/page.tsx
import DocsRequestDetailClient from "./DocsRequestDetailClient";

export default function DocsRequestDetailPage({
  params,
}: {
  params: { requestId: string };
}) {
  return <DocsRequestDetailClient requestId={params.requestId} />;
}
