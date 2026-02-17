"use client";

import Link from "next/link";

export default function CustomerDashboardHome() {
  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Dashboard</h1>
          <p className="pageSub">Manage your services in one place.</p>
        </div>
      </div>

      <div className="dashGrid">
        <div className="dashCard">
          <div className="dashCardTop">
            <div className="dashIcon" aria-hidden="true">
              🚚
            </div>
            <div>
              <h2 className="dashTitle">Deliveries</h2>
              <p className="dashText">Track deliveries, view updates, and start new requests.</p>
            </div>
          </div>

          <div className="dashActions">
            <Link href="/dashboard/delivery" className="btn btnPrimary">
              Open deliveries
            </Link>
            <Link href="/courier" className="btn btnSecondary">
              New delivery
            </Link>
          </div>
        </div>

        <div className="dashCard">
          <div className="dashCardTop">
            <div className="dashIcon" aria-hidden="true">
              🚗
            </div>
            <div>
              <h2 className="dashTitle">Auto Rentals</h2>
              <p className="dashText">Verification, agreements, payments, pickup/return steps.</p>
            </div>
          </div>

          <div className="dashActions">
            <Link href="/dashboard/auto" className="btn btnPrimary">
              Open rentals
            </Link>
            <Link href="/auto/vehicles" className="btn btnSecondary">
              Browse vehicles
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}