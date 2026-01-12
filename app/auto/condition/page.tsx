import { Suspense } from "react";
import ConditionClient from "./ConditionClient";

export default function ConditionPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading condition…</p>}>
      <ConditionClient />
    </Suspense>
  );
}