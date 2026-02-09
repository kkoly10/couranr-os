import Link from "next/link";

export default function Page() {
  return (
    <div className="relative overflow-hidden">
      {/* background glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute -bottom-48 right-[-120px] h-[520px] w-[520px] rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <section className="relative py-14 sm:py-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs text-zinc-700 shadow-sm backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Couranr OS • One platform for Auto + Delivery + Docs
          </div>

          <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <h1 className="text-balance text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">
                Run your local services like a real platform.
              </h1>

              <p className="mt-4 max-w-xl text-pretty text-lg leading-relaxed text-zinc-600">
                Couranr OS powers Couranr Auto and Couranr Delivery with a unified experience:
                booking, checkout, updates, and admin operations in one place.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/auto"
                  className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-zinc-900"
                >
                  Explore Auto Rentals
                </Link>

                <Link
                  href="/delivery"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
                >
                  Book a Delivery
                </Link>
              </div>

              <div className="mt-8 flex flex-wrap gap-3 text-sm text-zinc-600">
                <Badge>Secure checkout</Badge>
                <Badge>Verified customers</Badge>
                <Badge>Driver workflows</Badge>
                <Badge>Admin approvals</Badge>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-5 py-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-900">Today at Couranr</p>
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                    Live
                  </span>
                </div>
              </div>

              <div className="p-5">
                <div className="grid gap-3">
                  <Stat label="Active Rentals" value="3" />
                  <Stat label="Deliveries in Progress" value="5" />
                  <Stat label="Pending Approvals" value="2" />
                </div>

                <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-sm font-semibold text-zinc-900">Next action</p>
                  <p className="mt-1 text-sm text-zinc-600">
                    Review a rental verification and release pickup instructions.
                  </p>

                  <div className="mt-3">
                    <Link
                      href="/admin"
                      className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Open Admin
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            <TrustCard
              title="Clear flows"
              desc="Customer → checkout → verification → pickup/return."
            />
            <TrustCard
              title="Built for ops"
              desc="Admin review, deposits, evidence bundles, status tracking."
            />
            <TrustCard
              title="Modern stack"
              desc="Next.js + Stripe + Supabase + Resend for email."
            />
          </div>

          <div className="mt-12 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-900">Ready to launch?</p>
                <p className="mt-1 text-sm text-zinc-600">
                  Start with Auto Rentals and Delivery, then expand into Docs when you’re ready.
                </p>
              </div>
              <Link
                href="/get-started"
                className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-zinc-900"
              >
                Get Started
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 shadow-sm">
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <span className="text-sm text-zinc-600">{label}</span>
      <span className="text-lg font-semibold text-zinc-900">{value}</span>
    </div>
  );
}

function TrustCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-zinc-900">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{desc}</p>
    </div>
  );
}
