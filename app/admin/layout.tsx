// app/admin/layout.tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function AdminLayout({
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
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link href="/admin" className="font-bold text-lg">
            Couranr{" "}
            <span className="text-sm font-normal text-gray-500">admin</span>
          </Link>

          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/admin"
              className={cn(
                "rounded-lg px-3 py-2 hover:bg-gray-100",
                pathname === "/admin" && "bg-gray-100 font-semibold"
              )}
            >
              🚚 Deliveries
            </Link>

            <Link
              href="/admin/auto"
              className={cn(
                "rounded-lg px-3 py-2 hover:bg-gray-100",
                pathname.startsWith("/admin/auto") && "bg-gray-100 font-semibold"
              )}
            >
              🚗 Auto Rentals
            </Link>

            <Link
              href="/admin/docs"
              className={cn(
                "rounded-lg px-3 py-2 hover:bg-gray-100",
                pathname.startsWith("/admin/docs") && "bg-gray-100 font-semibold"
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
