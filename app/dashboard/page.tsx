"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AuthGuard from "../../components/AuthGuard";
import { supabase } from "../../lib/supabaseClient";

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const loadUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data.user);
    };

    loadUser();
  }, []);

  return (
    <AuthGuard>
      <main style={{ padding: "100px 20px" }}>
        <div className="container">
          <h1 style={{ marginBottom: 8 }}>Dashboard</h1>

          {user && (
            <p style={{ color: "var(--muted)", marginBottom: 40 }}>
              Logged in as {user.email}
            </p>
          )}

          {/* Services */}
          <div className="services">
            <ServiceCard
              title="Courier"
              description="Create and track deliveries with distance-based pricing and delivery confirmation."
              href="/courier"
            />

            <ServiceCard
              title="Rentals"
              description="Reserve vehicles, manage rentals, and view rental history."
              href="/rentals"
            />

            <ServiceCard
              title="Pack & Ship"
              description="Prepare shipments, order supplies, and manage drop-offs."
              href="/pack-ship"
            />

            <ServiceCard
              title="Documents"
              description="Upload documents for secure processing and in-store pickup."
              href="/documents"
            />

            <ServiceCard
              title="Auto Detailing"
              description="Book appointment-only detailing services at our facility."
              href="/detailing"
            />
          </div>
        </div>
      </main>
    </AuthGuard>
  );
}

function ServiceCard({
  title,
  description,
  href
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p>{description}</p>
      <Link href={href}>
        <button>Open</button>
      </Link>
    </div>
  );
}
