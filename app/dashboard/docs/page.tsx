// app/dashboard/docs/page.tsx
import Link from "next/link";

export default function DashboardDocsPage() {
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Docs Dashboard</h1>
        <p className="text-gray-600">
          Request printing, document assistance, typing/resume help, and admin support.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link
          href="/docs/request"
          className="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition"
        >
          <div className="text-2xl">📝</div>
          <div className="mt-2 font-semibold">New Docs Request</div>
          <div className="text-sm text-gray-600">
            Upload files and choose the service you need.
          </div>
          <div className="mt-4 text-sm font-medium text-blue-600">
            Start Request →
          </div>
        </Link>

        <Link
          href="/docs/pricing"
          className="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition"
        >
          <div className="text-2xl">💵</div>
          <div className="mt-2 font-semibold">Pricing</div>
          <div className="text-sm text-gray-600">
            Review print pricing, delivery fees, and service rates.
          </div>
          <div className="mt-4 text-sm font-medium text-blue-600">
            View Pricing →
          </div>
        </Link>

        <Link
          href="/dashboard"
          className="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition"
        >
          <div className="text-2xl">📦</div>
          <div className="mt-2 font-semibold">Back to Dashboard</div>
          <div className="text-sm text-gray-600">
            Return to your main Couranr customer dashboard.
          </div>
          <div className="mt-4 text-sm font-medium text-blue-600">
            Back →
          </div>
        </Link>
      </div>

      <div className="mt-6 rounded-2xl border bg-white p-5">
        <h2 className="font-semibold">Available Docs Services</h2>
        <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
          <li>Printing + local delivery / pickup coordination</li>
          <li>Typing and clean document formatting</li>
          <li>Resume review and resume formatting support</li>
          <li>DMV document prep assistance (administrative guidance only)</li>
          <li>Immigration packet organization support (administrative only)</li>
          <li>Business data-entry overflow support</li>
        </ul>

        <p className="mt-4 text-xs text-gray-500">
          Couranr Docs provides administrative/document assistance only. We do not provide legal advice and we do not guarantee agency approvals.
        </p>
      </div>
    </div>
  );
}