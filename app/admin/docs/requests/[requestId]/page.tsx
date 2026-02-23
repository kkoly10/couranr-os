// app/admin/docs/requests/[requestId]/page.tsx
import DocsAdminRequestDetailClient from "./DocsAdminRequestDetailClient";

export default function AdminDocsRequestDetailPage({
  params,
}: {
  params: { requestId: string };
}) {
  return <DocsAdminRequestDetailClient requestId={params.requestId} />;
}