import { Suspense } from "react";
import AccessClient from "./AccessClient";

export default function AccessPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading access…</p>}>
      <AccessClient />
    </Suspense>
  );
}