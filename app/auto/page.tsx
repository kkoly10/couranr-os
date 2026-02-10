import Link from "next/link";

export default function AutoHomePage() {
  return (
    <main className="bg-white">
      <section className="border-b border-zinc-200">
        <div className="mx-auto max-w-5xl px-6 py-14">
          <h1 className="text-3xl font-semibold text-zinc-900">How Couranr rentals work</h1>
          <p className="mt-3 text-zinc-600">
            Rental-first. Clear steps. Clean rules.
          </p>

          <ol className="mt-8 space-y-4 text-zinc-800">
            <li className="rounded-2xl border border-zinc-200 p-5">
              <div className="font-semibold">1) Browse available cars</div>
              <div className="mt-1 text-sm text-zinc-600">
                Pick an economy vehicle (Camry, Accord, Sonata, Elantra) based on price and availability.
              </div>
            </li>
            <li className="rounded-2xl border border-zinc-200 p-5">
              <div className="font-semibold">2) Choose dates + submit rental</div>
              <div className="mt-1 text-sm text-zinc-600">
                Start the booking flow from the vehicle page.
              </div>
            </li>
            <li className="rounded-2xl border border-zinc-200 p-5">
              <div className="font-semibold">3) Verify + sign agreement</div>
              <div className="mt-1 text-sm text-zinc-600">
                Complete verification and accept the rental terms.
              </div>
            </li>
            <li className="rounded-2xl border border-zinc-200 p-5">
              <div className="font-semibold">4) Checkout securely</div>
              <div className="mt-1 text-sm text-zinc-600">
                Pay securely via Stripe. You’ll receive confirmation and next steps.
              </div>
            </li>
            <li className="rounded-2xl border border-zinc-200 p-5">
              <div className="font-semibold">5) Pickup + condition photos</div>
              <div className="mt-1 text-sm text-zinc-600">
                Follow pickup instructions and upload required condition photos.
              </div>
            </li>
          </ol>

          <div className="mt-8 flex gap-3">
            <Link
              href="/auto/available"
              className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              View available cars
            </Link>
            <Link
              href="/dashboard/auto"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}