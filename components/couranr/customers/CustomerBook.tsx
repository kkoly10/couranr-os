"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Grid,
  Stack,
  Table,
  TableScroll,
  Text,
  buttonClassName,
} from "@/components/couranr/primitives";
import { Field, Input, Select, Textarea } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import {
  fetchMyBusinessAccounts,
  isApiFailure,
  withReference,
  type ApiFailure,
  type BusinessAccountOption,
} from "@/components/couranr/requests/client";
import {
  archiveCustomer,
  createCustomer,
  fetchCustomer,
  fetchCustomers,
  type CustomerDetail,
  type CustomerListEntry,
  type DuplicateWarning,
} from "./client";
import { memberMay } from "@/lib/couranr/settings/permissions";
import { DUPLICATE_STORAGE_KEY } from "@/lib/couranr/requests/listFilters";
import { REQUEST_STATE_LABELS } from "@/lib/couranr/requests/view";

/**
 * MER-008 customers list and MER-009 customer detail.
 *
 * ONE page, two states switched on `?customer=` — which is how the registry
 * declares the routes, not a shortcut.
 *
 * The book joins two real sources: records the merchant created, and delivery
 * history grouped by normalized recipient identity. Nothing is invented; a
 * customer with no deliveries shows no deliveries, and a delivery recipient
 * who was never saved as a record still appears, because they are a real
 * customer of this business.
 *
 * PII: the LIST masks contact details, per the registry's constraint about
 * unnecessary PII in list view. The DETAIL unmasks them, because at that point
 * the merchant is reading data that came from their own delivery requests.
 *
 * Copy rule (MKT-002): "your customers". Couranr never implies it owns the
 * merchant's customer relationship, and never claims to have generated one.
 */

export function CustomerBook() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedKey = searchParams.get("customer");

  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = React.useState<ApiFailure | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");

  const [list, setList] = React.useState<CustomerListEntry[] | null>(null);
  const [duplicates, setDuplicates] = React.useState<DuplicateWarning[]>([]);
  const [listError, setListError] = React.useState<ApiFailure | null>(null);

  const [detail, setDetail] = React.useState<CustomerDetail | null>(null);
  const [detailError, setDetailError] = React.useState<ApiFailure | null>(null);

  const [showArchived, setShowArchived] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  const [newName, setNewName] = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");
  const [newPhone, setNewPhone] = React.useState("");
  const [newNotes, setNewNotes] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetchMyBusinessAccounts().then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setAccountsError(r);
        if (r.status === 401) setAccounts([]);
        return;
      }
      setAccounts(r.value.businessAccounts);
      if (r.value.businessAccounts.length >= 1) {
        setBusinessAccountId(r.value.businessAccounts[0].businessAccountId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!businessAccountId) return;
    let cancelled = false;
    setList(null);
    setListError(null);
    fetchCustomers(businessAccountId).then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setListError(r);
        return;
      }
      setList(r.value.customers);
      setDuplicates(r.value.duplicates);
    });
    return () => {
      cancelled = true;
    };
  }, [businessAccountId, reloadKey]);

  React.useEffect(() => {
    if (!businessAccountId || !selectedKey) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    fetchCustomer(businessAccountId, selectedKey).then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setDetailError(r);
        return;
      }
      setDetail(r.value);
    });
    return () => {
      cancelled = true;
    };
  }, [businessAccountId, selectedKey, reloadKey]);

  if (accounts === null && accountsError) {
    return (
      <ErrorState
        title="We could not check your account"
        body={withReference(accountsError)}
        action={{ label: "Reload", onClick: () => router.refresh() }}
      />
    );
  }
  if (accounts === null) {
    return (
      <LoadingState label="Loading your customers">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }
  if (accountsError && accountsError.status === 401) {
    return (
      <EmptyState
        title="Sign in to see your customers"
        body="You need to be signed in to a Couranr business account."
        action={{ label: "Sign in", href: "/sign-in" }}
      />
    );
  }
  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No business account yet"
        body="Set up your business workspace first."
        action={{ label: "Set up your workspace", href: "/app/business/onboarding" }}
      />
    );
  }

  const activeAccount =
    accounts.find((a) => a.businessAccountId === businessAccountId) ?? accounts[0];
  const viewer = { role: activeAccount.role, status: "active" };
  const mayWrite = memberMay(viewer, "customers.write");

  /** Repeat delivery: prefill the create flow from this customer. */
  function repeatDelivery(c: CustomerDetail) {
    const address = c.addresses[0]?.address ?? null;
    try {
      sessionStorage.setItem(
        DUPLICATE_STORAGE_KEY,
        JSON.stringify({
          recipientName: c.displayName,
          recipientEmail: c.email,
          recipientPhone: c.phone,
          dropoffAddress: address,
        })
      );
    } catch {
      /* storage unavailable: the create page opens blank */
    }
    router.push("/app/business/deliveries/new?duplicate=1");
  }

  async function run(key: string, fn: () => Promise<any>) {
    setBusy(key);
    setActionError(null);
    const r = await fn();
    setBusy(null);
    if (isApiFailure(r)) {
      setActionError(withReference(r));
      return false;
    }
    setReloadKey((k) => k + 1);
    return true;
  }

  /* ═════════════════════════════ MER-009 ═══════════════════════════════ */

  if (selectedKey) {
    if (detailError) {
      return (
        <Stack gap={4}>
          <div>
            <Link href="/app/business/customers" className={buttonClassName({ size: "sm" })}>
              Back to customers
            </Link>
          </div>
          {detailError.status === 404 ? (
            <EmptyState
              title="That customer was not found"
              body="They may have been archived, or the link may be for another business."
            />
          ) : (
            <ErrorState title="That customer did not load" body={withReference(detailError)} />
          )}
        </Stack>
      );
    }
    if (!detail) {
      return (
        <LoadingState label="Loading customer">
          <CardSkeleton lines={5} />
        </LoadingState>
      );
    }

    return (
      <Stack gap={6}>
        <Cluster gap={3}>
          <Link href="/app/business/customers" className={buttonClassName({ size: "sm" })}>
            Back to customers
          </Link>
          {mayWrite ? (
            <Button size="sm" variant="primary" onClick={() => repeatDelivery(detail)}>
              Repeat delivery
            </Button>
          ) : null}
        </Cluster>

        {actionError ? <ErrorState title="That could not be done" body={actionError} /> : null}

        {/* Required state: archived. */}
        {detail.archived ? (
          <Alert tone="warning" title="This customer is archived">
            They stay out of your working list, and their delivery history is
            kept. You can restore them at any time.
          </Alert>
        ) : null}

        <Card>
          <CardHeader
            title={detail.displayName}
            description="Your customer record. Couranr does not share it with anyone."
            actions={
              mayWrite && detail.customerId ? (
                <Button
                  size="sm"
                  loading={busy === "archive"}
                  disabled={Boolean(busy)}
                  onClick={() =>
                    run("archive", () =>
                      archiveCustomer({
                        businessAccountId,
                        customerId: detail.customerId!,
                        action: detail.archived ? "restore" : "archive",
                      })
                    )
                  }
                >
                  {detail.archived ? "Restore customer" : "Archive customer"}
                </Button>
              ) : null
            }
          />
          <Grid columns={2}>
            <Field label="Email">
              {(p) => <Input {...p} value={detail.email ?? "Not provided"} readOnly />}
            </Field>
            <Field label="Phone">
              {(p) => <Input {...p} value={detail.phone ?? "Not provided"} readOnly />}
            </Field>
          </Grid>
          {detail.notes ? (
            <Stack gap={1}>
              <Text size="xs" muted>
                Your notes
              </Text>
              <Text size="sm">{detail.notes}</Text>
            </Stack>
          ) : null}
          {/*
            PAY-001 is decided: either side may pay ANY delivery and onboarding
            captures a default only. So a recorded preference is shown as a
            preference, never as a setting that limits the next delivery.
          */}
          <Text size="xs" muted>
            {detail.payerPreference
              ? `Usually pays: ${detail.payerPreference === "customer" ? "your customer" : "your business"}. You can still choose either payer on any delivery.`
              : "No payer preference recorded. You choose the payer on every delivery."}
          </Text>
        </Card>

        <Card>
          <CardHeader title="Destinations" />
          {detail.addresses.length === 0 ? (
            <Text size="sm" muted>
              No delivery addresses yet.
            </Text>
          ) : (
            <Stack gap={3}>
              {/* Required state: conflicting address. */}
              {detail.hasConflictingAddress ? (
                <Alert tone="info" title="More than one delivery address">
                  Couranr has delivered to this customer at more than one
                  address. The most recent is first — check which one you mean
                  before repeating a delivery.
                </Alert>
              ) : null}
              {detail.addresses.map((a, i) => (
                <Card key={i}>
                  <Stack gap={1}>
                    <Cluster gap={2}>
                      <Badge tone={a.source === "saved" ? "info" : "neutral"}>
                        {a.source === "saved" ? a.label || "Saved" : "From a delivery"}
                      </Badge>
                      {i === 0 && a.source === "delivery" ? (
                        <Badge tone="success">Most recent</Badge>
                      ) : null}
                    </Cluster>
                    <Text size="sm">
                      {a.address?.line1}
                      {a.address?.line2 ? `, ${a.address.line2}` : ""}, {a.address?.city}{" "}
                      {a.address?.region} {a.address?.postalCode}
                    </Text>
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Card>

        <Card>
          <CardHeader title="Delivery history" />
          {/* Required state: no deliveries. Reachable for a saved record. */}
          {detail.deliveries.length === 0 ? (
            <Text size="sm" muted>
              You have not sent a delivery to this customer yet.
            </Text>
          ) : (
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Created</th>
                    <th scope="col">State</th>
                    <th scope="col">Payer</th>
                    <th scope="col">
                      <span className="cr-visually-hidden-h">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.deliveries.map((d) => (
                    <tr key={d.id}>
                      <td>{new Date(d.createdAt).toLocaleDateString()}</td>
                      <td>
                        <Badge tone={d.requestState === "confirmed" ? "success" : "neutral"}>
                          {REQUEST_STATE_LABELS[d.requestState] ?? d.requestState}
                        </Badge>
                      </td>
                      <td>{d.payerType === "customer" ? "Your customer" : "Your business"}</td>
                      <td>
                        <Link
                          href={`/app/business/deliveries/${d.id}`}
                          className={buttonClassName({ size: "sm" })}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Card>
      </Stack>
    );
  }

  /* ═════════════════════════════ MER-008 ═══════════════════════════════ */

  const visible = (list ?? [])
    .filter((c) => (showArchived ? c.archived : !c.archived))
    .filter((c) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return `${c.displayName} ${c.maskedEmail ?? ""} ${c.maskedPhone ?? ""}`
        .toLowerCase()
        .includes(q);
    });

  return (
    <Stack gap={6}>
      {accounts.length > 1 ? (
        <Card>
          <CardHeader title="Business account" />
          <Field label="Viewing" required>
            {(p) => (
              <Select
                {...p}
                value={businessAccountId}
                onChange={(e) => setBusinessAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.businessAccountId} value={a.businessAccountId}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Card>
      ) : null}

      {actionError ? <ErrorState title="That could not be done" body={actionError} /> : null}

      {/* Required state: duplicate warning. A warning only — never a merge. */}
      {duplicates.length > 0 && !showArchived ? (
        <Alert tone="warning" title="Some customers look like duplicates">
          <Stack gap={1}>
            {duplicates.map((d) => (
              <Text key={d.keys.join("|")} size="sm">
                {d.reason}
                {d.strength === "weak" ? " Couranr has not merged them." : ""}
              </Text>
            ))}
            <Text size="xs" muted>
              Couranr never merges your customer records. You decide whether
              these are the same person.
            </Text>
          </Stack>
        </Alert>
      ) : null}

      {mayWrite ? (
        <Card>
          <CardHeader
            title="Add a customer"
            description="For someone you have not delivered to yet."
          />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setCreating(true);
              const ok = await run("create", () =>
                createCustomer({
                  businessAccountId,
                  displayName: newName,
                  email: newEmail,
                  phone: newPhone,
                  notes: newNotes,
                })
              );
              setCreating(false);
              if (ok) {
                setNewName("");
                setNewEmail("");
                setNewPhone("");
                setNewNotes("");
              }
            }}
            noValidate
          >
            <Stack gap={3}>
              <Grid columns={3}>
                <Field label="Name" required>
                  {(p) => (
                    <Input {...p} value={newName} onChange={(e) => setNewName(e.target.value)} />
                  )}
                </Field>
                <Field label="Email">
                  {(p) => (
                    <Input
                      {...p}
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Phone">
                  {(p) => (
                    <Input {...p} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                  )}
                </Field>
              </Grid>
              <Field label="Notes" hint="Only your team sees these.">
                {(p) => (
                  <Textarea
                    {...p}
                    value={newNotes}
                    rows={2}
                    onChange={(e) => setNewNotes(e.target.value)}
                  />
                )}
              </Field>
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  loading={creating}
                  disabled={newName.trim() === "" || (newEmail.trim() === "" && newPhone.trim() === "")}
                >
                  Add customer
                </Button>
              </div>
            </Stack>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={showArchived ? "Archived customers" : "Your customers"}
          actions={
            <Button size="sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Show active" : "Show archived"}
            </Button>
          }
        />
        <Stack gap={3}>
          <Field label="Search">
            {(p) => (
              <Input
                {...p}
                value={search}
                placeholder="Name, email or phone"
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
          </Field>

          {listError ? (
            // FAIL CLOSED: an error is never rendered as "you have no customers".
            <ErrorState
              title="Your customers did not load"
              body={withReference(listError)}
              action={{ label: "Try again", onClick: () => setReloadKey((k) => k + 1) }}
            />
          ) : list === null ? (
            <CardSkeleton lines={4} />
          ) : visible.length === 0 ? (
            <EmptyState
              title={showArchived ? "No archived customers" : "No customers yet"}
              body={
                showArchived
                  ? "Customers you archive appear here."
                  : "Customers appear here once you create a delivery for them."
              }
              action={
                showArchived || !mayWrite
                  ? undefined
                  : { label: "Create a delivery", href: "/app/business/deliveries/new" }
              }
            />
          ) : (
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Deliveries</th>
                    <th scope="col">Last delivery</th>
                    <th scope="col">
                      <span className="cr-visually-hidden-h">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr key={c.key}>
                      <td>
                        <Cluster gap={2}>
                          <Text size="sm">{c.displayName}</Text>
                          {c.archived ? <Badge tone="warning">Archived</Badge> : null}
                          {c.hasActiveDelivery ? <Badge tone="info">Active delivery</Badge> : null}
                          {c.hasConflictingAddress ? (
                            <Badge tone="neutral">Multiple addresses</Badge>
                          ) : null}
                        </Cluster>
                      </td>
                      {/* MASKED. The registry forbids unnecessary PII here. */}
                      <td>
                        <Text size="sm" muted>
                          {c.maskedEmail ?? c.maskedPhone ?? "—"}
                        </Text>
                      </td>
                      <td>{c.deliveryCount}</td>
                      <td>
                        {c.lastDeliveryAt
                          ? new Date(c.lastDeliveryAt).toLocaleDateString()
                          : "—"}
                      </td>
                      <td>
                        <Link
                          href={`/app/business/customers?customer=${encodeURIComponent(c.key)}`}
                          className={buttonClassName({ size: "sm" })}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
