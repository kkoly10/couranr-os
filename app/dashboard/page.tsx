// app/dashboard/page.tsx
import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Your Couranr Dashboard</h1>
        <p className="text-gray-600">
          Choose a service to manage requests, rentals, and deliveries.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link
          href="/dashboard/delivery"
          className="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition"
        >
          <div className="text-2xl">🚚</div>
          <div className="mt-2 font-semibold">Delivery</div>
          <div className="text-sm text-gray-600">
            Track or create courier requests.
          </div>
          <div className="mt-4 text-sm font-medium text-blue-600">
            Open Delivery →
          </div>
        </Link>

        <Link
          href="/dashboard/auto"
          className="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition"
        >
          <div className="text-2xl">🚗</div>
          <div className="mt-2 font-semibold">Auto Rentals</div>
          <div className="text-sm text-gray-600">
            Manage verification, pickup, return, and deposit status.
          </div>
          <div className="mt-4 text-sm font-medium text-blue-600">
            Open Auto →
          </div>
        </Link>

        <Link
          href="/dashboard/docs"
          className="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition"
        >
          <div className="text-2xl">📄</div>
          <div className="mt-2 font-semibold">Docs</div>
          <div className="text-sm text-gray-600">
            Printing, document prep help, typing, resume support, and more.
          </div>
          <div className="mt-4 text-sm font-medium text-blue-600">
            Open Docs →
          </div>
        </Link>
      </div>
    </div>
  );
}