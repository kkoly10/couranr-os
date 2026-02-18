import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="page">
      <div className="cContainer">
        <h1 className="pageTitle">Dashboard</h1>
        <p className="pageDesc">Manage your services in one place.</p>

        <div className="dashGrid">
          <div className="card">
            <div className="cardIcon" aria-hidden="true">
              🚚
            </div>
            <h3 className="cardTitle">Deliveries</h3>
            <p className="cardDesc">
              Track deliveries, view updates, and start new requests.
            </p>

            <div className="contactRow">
              <Link className="btn btnGhost" href="/dashboard/deliveries">
                Open deliveries
              </Link>
              <Link className="btn btnGold" href="/dashboard/deliveries/new">
                New delivery →
              </Link>
            </div>

            <p className="finePrint">
              Proof-of-pickup/drop-off may be available depending on the delivery type.
            </p>
          </div>

          <div className="card">
            <div className="cardIcon" aria-hidden="true">
              🚗
            </div>
            <h3 className="cardTitle">Auto Rentals</h3>
            <p className="cardDesc">
              Verification, agreements, payments, and pickup/return steps.
            </p>

            <div className="contactRow">
              <Link className="btn btnGhost" href="/dashboard/auto">
                Open rentals
              </Link>
              <Link className="btn btnGold" href="/auto">
                Browse vehicles →
              </Link>
            </div>

            <p className="finePrint">
              Policies and renter responsibilities are shown before payment.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}