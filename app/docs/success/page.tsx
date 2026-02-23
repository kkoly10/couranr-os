// app/docs/success/page.tsx
import Link from "next/link";

export default function DocsSuccessPage({
  searchParams,
}: {
  searchParams?: { requestId?: string; code?: string };
}) {
  const requestId = searchParams?.requestId || "";
  const code = searchParams?.code || "";

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      <div
        style={{
          border: "1px solid #dcfce7",
          background: "#f0fdf4",
          borderRadius: 14,
          padding: 16,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 26 }}>Docs request submitted ✅</h1>
        <p style={{ marginTop: 8, marginBottom: 0, color: "#166534" }}>
          Your request is now in the queue for review.
        </p>
      </div>

      <div
        style={{
          marginTop: 12,
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          padding: 16,
          background: "#fff",
          lineHeight: 1.7,
        }}
      >
        <div>
          <strong>Request Code:</strong> {code || "—"}
        </div>
        <div>
          <strong>Request ID:</strong> {requestId || "—"}
        </div>

        <div style={{ marginTop: 10, fontSize: 14, color: "#374151" }}>
          Next steps:
          <ul style={{ marginTop: 6 }}>
            <li>We review your request details and uploaded files.</li>
            <li>If needed, we send a quote and timeline.</li>
            <li>You’ll see updates in your Docs dashboard.</li>
          </ul>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/dashboard/docs" style={btnPrimary}>
          Go to Docs Dashboard
        </Link>

        {requestId ? (
          <Link href={`/docs/request?requestId=${encodeURIComponent(requestId)}`} style={btnGhost}>
            Reopen Request
          </Link>
        ) : null}

        <Link href="/docs/request" style={btnGhost}>
          Start Another Request
        </Link>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  textDecoration: "none",
  display: "inline-block",
};

const btnGhost: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  fontWeight: 900,
  textDecoration: "none",
  display: "inline-block",
};
