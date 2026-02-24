// app/dashboard/layout.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function onLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="font-bold text-lg">
            Couranr
          </Link>

          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/dashboard/delivery"
              className={cn(
                "rounded-lg px-3 py-2 hover:bg-gray-100",
                pathname.startsWith("/dashboard/delivery") &&
                  "bg-gray-100 font-semibold"
              )}
            >
              🚚 Deliveries
            </Link>

            <Link
              href="/dashboard/auto"
              className={cn(
                "rounded-lg px-3 py-2 hover:bg-gray-100",
                pathname.startsWith("/dashboard/auto") &&
                  "bg-gray-100 font-semibold"
              )}
            >
              🚗 Auto Rentals
            </Link>

            <Link
              href="/dashboard/docs"
              className={cn(
                "rounded-lg px-3 py-2 hover:bg-gray-100",
                pathname.startsWith("/dashboard/docs") &&
                  "bg-gray-100 font-semibold"
              )}
            >
              📄 Docs
            </Link>

            <button
              onClick={onLogout}
              className="ml-2 rounded-lg border px-3 py-2 hover:bg-gray-50"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
