"use client";

import * as React from "react";
import { call, isApiFailure } from "@/components/couranr/requests/client";
import { Alert, Button, Card, CardHeader, Stack, Table, TableScroll, Text } from "@/components/couranr/primitives";
import { formatCents } from "@/lib/couranr/requests/view";

type Report = {
  asOf: string;
  note: string;
  drivers: Array<{ driverId: string; driverName: string; capturedCents: number;
    refundedCents: number; netCents: number; disputedHoldCents: number; tipCount: number }>;
  recentReviews: Array<{ driver_id: string; driverName: string; delivery_id: string;
    rating: number; comment: string | null; created_at: string }>;
};

export function DriverFeedbackDashboard() {
  const [report, setReport] = React.useState<Report | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const reload = React.useCallback(async () => {
    setLoading(true);
    const result = await call<Report>("/api/couranr/operations/driver-feedback");
    if (isApiFailure(result)) setError(result.error);
    else { setReport(result.value); setError(null); }
    setLoading(false);
  }, []);
  React.useEffect(() => {
    let active = true;
    void call<Report>("/api/couranr/operations/driver-feedback").then((result) => {
      if (!active) return;
      if (isApiFailure(result)) setError(result.error);
      else { setReport(result.value); setError(null); }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);
  if (loading && !report) return <Card><Text>Loading driver tips and feedback…</Text></Card>;
  return <Stack gap={4}>
    {error ? <Alert tone="warning" title="Report unavailable">{error}</Alert> : null}
    <Button type="button" variant="secondary" onClick={() => void reload()}>Refresh report</Button>
    {report ? <>
      <Alert tone="info" title="Company-held tips">{report.note}</Alert>
      <Card>
        <CardHeader title="Tip liabilities by driver" description={`As of ${new Date(report.asOf).toLocaleString()}. Gross totals include all history; this is not a payroll-paid ledger.`} />
        <TableScroll><Table>
          <thead><tr><th>Driver</th><th>Captured</th><th>Refunded</th><th>Net allocated</th><th>Disputed hold</th><th>Tips</th></tr></thead>
          <tbody>{report.drivers.map((driver) => <tr key={driver.driverId}>
            <td>{driver.driverName}</td><td>{formatCents(driver.capturedCents)}</td>
            <td>{formatCents(driver.refundedCents)}</td><td>{formatCents(driver.netCents)}</td>
            <td>{formatCents(driver.disputedHoldCents)}</td><td>{driver.tipCount}</td>
          </tr>)}</tbody>
        </Table></TableScroll>
        {!report.drivers.length ? <Text>No captured driver tips yet.</Text> : null}
      </Card>
      <Card>
        <CardHeader title="Recent private driver reviews" description="Operations-only feedback; never shared as public ratings." />
        <Stack gap={2}>{report.recentReviews.map((review, index) =>
          <Text key={`${review.delivery_id}-${review.created_at}-${index}`}>
            {review.driverName}: {review.rating}/5
            {review.comment ? ` — ${review.comment}` : ""}
          </Text>)}</Stack>
        {!report.recentReviews.length ? <Text>No driver reviews yet.</Text> : null}
      </Card>
    </> : null}
  </Stack>;
}
