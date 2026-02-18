import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="dashWrap">
      <div className="dashTop">
        <h1 className="dashTitle">Dashboard</h1>
        <p className="dashSub">
          Manage your services in one place. Use the cards below to jump into your active flows.
        </p>
      </div>

      <div className="dashGrid">
        <div className="dashCard">
          <div className="dashCardTop">
            <span className="dashIcon" aria-hidden="true">🚚</span>
            <span>Courier</span>
          </div>
          <h3 className="dashCardTitle">Deliveries</h3>
          <p className="dashCardDesc">
            Track deliveries, view updates, and start new requests.
          </p>
          <div className="dashActions">
            <Link className="btn btnGold" href="/deliveries/new">New delivery</Link>
            <Link className="btn btnGhost" href="/deliveries">Open deliveries</Link>
          </div>
        </div>

        <div className="dashCard">
          <div className="dashCardTop">
            <span className="dashIcon" aria-hidden="true">🚗</span>
            <span>Auto</span>
          </div>
          <h3 className="dashCardTitle">Auto rentals</h3>
          <p className="dashCardDesc">
            Verification, agreements, payments, and pickup/return steps.
          </p>
          <div className="dashActions">
            <Link className="btn btnGold" href="/auto">Browse vehicles</Link>
            <Link className="btn btnGhost" href="/rentals">Open rentals</Link>
          </div>
        </div>

        <div className="dashCard">
          <div className="dashCardTop">
            <span className="dashIcon" aria-hidden="true">📄</span>
            <span>Docs</span>
          </div>
          <h3 className="dashCardTitle">Documents (coming soon)</h3>
          <p className="dashCardDesc">
            Administrative document help and appointment-based assistance.
          </p>
          <div className="dashActions">
            <Link className="btn btnGhost" href="/docs">Learn more</Link>
          </div>
        </div>
      </div>

      <div className="noticeBox" style={{ marginTop: 16 }}>
        Need help? Email <a href="mailto:couranr@couranrauto.com" style={{ fontWeight: 900 }}>couranr@couranrauto.com</a>.
      </div>
    </div>
  );
}