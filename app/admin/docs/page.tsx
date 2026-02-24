// app/admin/docs/page.tsx
import Link from "next/link";

export default function AdminDocsPage() {
  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Admin — Docs</h1>
          <p className="text-gray-600">
            Manage printing, document assistance, data-entry requests, and customer communication.
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href="/admin"
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Back to Admin
          </Link>
          <Link
            href="/docs/pricing"
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50"
          >
            View Public Pricing
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5">
          <div className="text-2xl">🖨️</div>
          <div className="mt-2 font-semibold">Printing Orders</div>
          <p className="mt-1 text-sm text-gray-600">
            Print-ready uploads, page counts, delivery/pickup coordination, and status updates.
          </p>
          <div className="mt-4 text-xs text-gray-500">
            Best for quick local transactions.
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5">
          <div className="text-2xl">⌨️</div>
          <div className="mt-2 font-semibold">Typing / Data Entry</div>
          <p className="mt-1 text-sm text-gray-600">
            Business overflow support, clean transcription, and structured entry into customer systems.
          </p>
          <div className="mt-4 text-xs text-gray-500">
            Use clear scope notes and turnaround targets.
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5">
          <div className="text-2xl">📂</div>
          <div className="mt-2 font-semibold">Prep Assistance</div>
          <p className="mt-1 text-sm text-gray-600">
            DMV prep help, resume support, and immigration packet organization (admin support only).
          </p>
          <div className="mt-4 text-xs text-gray-500">
            Always use non-legal disclaimer language.
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border bg-white p-5">
        <h2 className="font-semibold">Docs Admin Workflow</h2>
        <ol className="mt-3 list-decimal pl-5 text-sm text-gray-700 space-y-1">
          <li>Review request details and uploaded files</li>
          <li>Confirm scope, turnaround, and price</li>
          <li>Mark payment status</li>
          <li>Process (print / type / prepare / organize)</li>
          <li>Set delivery or completion status</li>
          <li>Notify customer and close the request</li>
        </ol>

        <p className="mt-4 text-xs text-gray-500">
          Keep all “DMV” and “immigration” jobs framed as document preparation / administrative support, not legal representation.
        </p>
      </div>
    </div>
  );
}