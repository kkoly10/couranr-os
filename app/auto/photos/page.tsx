import { Suspense } from "react";
import PhotosClient from "./PhotosClient";

export default function PhotosPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading photo upload…</p>}>
      <PhotosClient />
    </Suspense>
  );
}