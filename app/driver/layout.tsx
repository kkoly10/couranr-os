import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import Brand from "../../components/Brand";
import LogoutButton from "../../components/LogoutButton";

// ✅ THE FIX: Forces Next.js to run this on the server per-request, skipping static build
export const dynamic = "force-dynamic";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerComponentClient({ cookies });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // 1. Kick out unauthenticated users
  if (!session) {
    redirect("/login?next=/driver");
  }

  // 2. Verify the Driver Role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  // 3. Kick non-drivers to the portal
  if (profile?.role !== "driver") {
    redirect("/portal");
  }

  return (
    <section>
      <header
        style={{
          borderBottom: "3px solid #16a34a",
          background:
            "linear-gradient(180deg, rgba(22,163,74,0.12), #ffffff 60%)",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "18px 24px",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <Brand href="/driver" role="driver" />
          <LogoutButton />
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px" }}>
        {children}
      </main>
    </section>
  );
}
