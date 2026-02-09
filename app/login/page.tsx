// app/login/page.tsx
import { Suspense } from "react";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] grid place-items-center text-white/80">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}