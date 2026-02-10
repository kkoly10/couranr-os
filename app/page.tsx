import Link from "next/link";

export default function HomePage() {
  return (
    <main className="bg-white">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <p className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700">
                Couranr Auto is live • Courier is coming soon
              </p>

              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
                Premium weekly rentals,
                <span className="block text-zinc-700">simple pickup. No nonsense.</span>
              </h1>

              <p className="mt-4 text-lg leading-relaxed text-zinc-600">
                Couranr is rental-first. Browse available economy cars, complete verification,
                sign your agreement, and check out securely — all in one flow.
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/auto/available"
                  className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800"
                >
                  Browse available cars
                </Link>

                <Link
                  href="/auto"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
                >
                  How rentals work
                </Link>
              </div>

              <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-sm font-semibold text-zinc-900">Clear rules</p>
                  <p className="mt-1 text-sm text-zinc-600">Agreements + deposits handled cleanly.</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-sm font-semibold text-zinc-900">Fast checkout</p>
                  <p className="mt-1 text-sm text-zinc-600">Secure payment + confirmation flow.</p>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-sm font-semibold text-zinc-900">Pickup-ready</p>
                  <p className="mt-1 text-sm text-zinc-600">Condition photos + access steps.</p>
                </div>
              </div>
            </div>

            {/* Visual placeholder (no stock images yet) */}
            <div className="rounded-3xl border border-zinc-200 bg-gradient-to-br from-zinc-50 to-white p-6">
              <div className="rounded-2xl border border-zinc-200 bg-white p-6">
                <p className="text-sm font-semibold text-zinc-900">Rental-first flow</p>
                <ol className="mt-3 space-y-3 text-sm text-zinc-700">
                  <li className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
                      1
                    </span>
                    Browse available cars
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
                      2
                    </span>
                    Verify & sign agreement
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
                      3
                    </span>
                    Checkout securely
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
                      4
                    </span>
                    Pickup + condition photos
                  </li>
                </ol>

                <div className="mt-6 rounded-2xl bg-zinc-50 p-4">
                  <p className="text-xs font-medium text-zinc-600">Courier Delivery</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">Coming soon</p>
                  <p className="mt-1 text-sm text-zinc-600">
                    We’re building courier in parallel — but rentals stay the priority.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="border-t border-zinc-200">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="text-2xl font-semibold text-zinc-900">Services</h2>
          <p className="mt-2 text-zinc-600">
            Couranr is built as one platform — starting with Auto Rentals.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <div className="rounded-3xl border border-zinc-200 bg-white p-6">
              <h3 className="text-lg font-semibold text-zinc-900">🚗 Auto Rentals</h3>
              <p className="mt-2 text-sm text-zinc-600">
                Economy-friendly vehicles with a clean booking flow and clear policies.
              </p>
              <div className="mt-4">
                <Link
                  href="/auto/available"
                  className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
                >
                  View cars
                </Link>
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-6">
              <h3 className="text-lg font-semibold text-zinc-900">🚚 Courier Delivery</h3>
              <p className="mt-2 text-sm text-zinc-600">
                Coming soon. Built to support rentals + docs + local deliveries later.
              </p>
              <div className="mt-4">
                <Link
                  href="/courier"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
                >
                  Preview courier
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}