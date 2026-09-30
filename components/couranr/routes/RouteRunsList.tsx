"use client";

import * as React from "react";
import Link from "next/link";
import { Badge, Card, CardHeader, Cluster, Stack, Table, TableScroll, Text, buttonClassName } from "@/components/couranr/primitives";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import { Field, Select } from "@/components/couranr/forms";
import { fetchMyBusinessAccounts, isApiFailure, withReference, type BusinessAccountOption } from "@/components/couranr/requests/client";
import { formatCents } from "@/lib/couranr/requests/view";
import type { RouteRunView } from "@/lib/couranr/routeRuns/types";
import { fetchRouteRuns } from "./client";

const tone = (state: RouteRunView["state"]) =>
  state === "accepted" ? "success" : state === "draft" ? "warning" : "neutral";

const label = (state: RouteRunView["state"]) =>
  state === "accepted" ? "Accepted" : state === "abandoned" ? "Archived" : state === "cancelled" ? "Cancelled" : "Draft";

export function RouteRunsList() {
  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");
  const [rows, setRows] = React.useState<RouteRunView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchMyBusinessAccounts().then((result) => {
      if (cancelled) return;
      if (isApiFailure(result)) {
        setAccounts([]);
        setError(withReference(result));
        return;
      }
      setAccounts(result.value.businessAccounts);
      setBusinessAccountId(result.value.businessAccounts[0]?.businessAccountId ?? "");
    });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!businessAccountId) return;
    let cancelled = false;
    fetchRouteRuns(businessAccountId).then((result) => {
      if (cancelled) return;
      if (isApiFailure(result)) {
        setError(withReference(result));
        return;
      }
      setRows(result.value.routeRuns);
    });
    return () => { cancelled = true; };
  }, [businessAccountId]);

  function changeBusinessAccount(nextBusinessAccountId: string) {
    setRows(null);
    setError(null);
    setBusinessAccountId(nextBusinessAccountId);
  }

  if (accounts === null) return <LoadingState label="Loading Route Runs"><CardSkeleton lines={4} /></LoadingState>;
  if (error && accounts.length === 0) return <ErrorState title="Route Runs could not load" body={error} />;
  if (accounts.length === 0) {
    return <EmptyState title="No business account yet" body="Set up your business workspace before creating a Route Run." action={{ label: "Set up workspace", href: "/app/business/onboarding" }} />;
  }

  const active = accounts.find((a) => a.businessAccountId === businessAccountId) ?? accounts[0];
  const mayWrite = ["owner", "manager", "dispatcher"].includes(active.role);

  return (
    <Stack gap={6}>
      <Cluster gap={3}>
        {mayWrite ? (
          <Link href="/app/business/routes/new" className={buttonClassName({ variant: "primary" })}>
            New Route Run
          </Link>
        ) : null}
        <Text size="sm" muted>
          One pickup, 2–5 customer stops. Each stop remains its own Couranr delivery.
        </Text>
      </Cluster>

      {accounts.length > 1 ? (
        <Card>
          <CardHeader title="Business account" />
          <Field label="Viewing" required>
            {(p) => (
              <Select {...p} value={businessAccountId} onChange={(e) => changeBusinessAccount(e.target.value)}>
                {accounts.map((a) => <option key={a.businessAccountId} value={a.businessAccountId}>{a.name}</option>)}
              </Select>
            )}
          </Field>
        </Card>
      ) : null}

      {error ? <ErrorState title="Route Runs could not load" body={error} /> : null}
      {rows === null && !error ? <LoadingState label="Loading Route Runs"><CardSkeleton lines={5} /></LoadingState> : null}
      {rows?.length === 0 ? (
        <EmptyState
          title="No Route Runs yet"
          body="Use a Route Run when several merchant-paid deliveries leave from the same pickup."
          action={mayWrite ? { label: "Create Route Run", href: "/app/business/routes/new" } : undefined}
        />
      ) : null}

      {rows && rows.length > 0 ? (
        <Card>
          <CardHeader title="Route Runs" description="Accepted means the stop set is frozen. Payment, booking and driver assignment are separate later steps." />
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <th scope="col">Route</th>
                  <th scope="col">State</th>
                  <th scope="col">Stops</th>
                  <th scope="col">Delivery estimates</th>
                  <th scope="col"><span className="cr-visually-hidden-h">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((route) => (
                  <tr key={route.routeRunId}>
                    <td>{route.title}</td>
                    <td><Badge tone={tone(route.state)}>{label(route.state)}</Badge></td>
                    <td>{route.stopCount}</td>
                    <td>{formatCents(route.referenceQuoteTotalCents)}</td>
                    <td>
                      <Link href={`/app/business/routes/${route.routeRunId}?businessAccountId=${businessAccountId}`} className={buttonClassName({ size: "sm" })}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      ) : null}
    </Stack>
  );
}
