"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Cluster,
  Grid,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import { CardSkeleton, ErrorState, LoadingState } from "@/components/couranr/states";
import { call, isApiFailure, withReference } from "@/components/couranr/requests/client";
import { fetchOperationsProofUrl } from "@/components/couranr/dispatch/client";
import { formatProofWhen, proofStageLabel, proofTypeLabel } from "@/components/couranr/dispatch/MerchantProofPanel";

/**
 * OPS-012 / CUS-004 — ONE custody bundle, in the order the shipment moved.
 *
 * An investigator working a claim currently reads the manifest on one screen,
 * the proof list on another, the incident in a third and the customer's own
 * report in a fourth, and has to hold the ordering in their head. This renders
 * the chain once: what the sender said was in the box, what it was worth, what
 * they agreed to, who handed it over and when, what the driver photographed
 * before and after sealing it, which seal, where and when it was handed to the
 * recipient, how that recipient was verified, and what has been claimed since.
 *
 * It DECIDES nothing. There is no resolve button, no credit button and no
 * amount of money anywhere on this panel — reviewing custody is not settling
 * it, and the two live on different screens on purpose. The incident and claim
 * commands stay where they already are, in IncidentsWorkspace and
 * CustomerProblemReports.
 *
 * Media is never inlined and never linked. Each photograph is opened on demand
 * through the existing Operations signed-URL endpoints, whose TTL is chosen by
 * viewer role server-side; the URL lives for the length of one click handler
 * and is never put in state or written into the DOM.
 */

/* ───────────────────────────────────────────────────────── the view type ── */

/**
 * The bundle as the ROUTE returns it.
 *
 * Declared here rather than imported from `lib/couranr/operations/custodyBundle`
 * because that module is server-only: it holds the service-role client, and
 * `tests/couranr-server-only.test.ts` walks type imports too, so importing the
 * type would drag the module into the browser bundle.
 */
export type CustodyEvidenceView = {
  proofId: string;
  proofStage: string;
  proofType: string;
  finalizedAt: string | null;
  capturedAt: string | null;
  hasMedia: boolean;
};

export type CustodyView = {
  deliveryId: string;
  requestId: string;
  reference: string | null;
  fulfillmentState: string;
  declaration: {
    description: string | null;
    packageCount: number | null;
    orderReference: string | null;
    handlingNotes: string | null;
    manifestSource: string | null;
    manifestPolicyVersion: string | null;
    declaredValueCents: number | null;
    protectionLevel: string | null;
    protectionPolicyVersion: string | null;
    restrictedClass: string | null;
    protectionGoverned: boolean;
  };
  senderTerms: {
    termsVersion: string | null;
    termsAcceptedAt: string | null;
    electronicConsentAt: string | null;
    adultAttestedAt: string | null;
  };
  pickup: {
    credential: CustodyCredentialView | null;
    place: CustodyPlaceView | null;
    observedPackageCount: number | null;
    prepackPhoto: CustodyEvidenceView | null;
    sealedPackagePhoto: CustodyEvidenceView | null;
    documentationRequired: boolean;
    credentialAfterDocumentation: boolean | null;
  };
  seal: {
    sealIdentifier: string | null;
    appliedAt: string | null;
    dropoffCondition: string | null;
    dropoffRecordedAt: string | null;
    sealedPackagePhoto: CustodyEvidenceView | null;
    dropoffSealPhoto: CustodyEvidenceView | null;
  } | null;
  dropoff: {
    place: CustodyPlaceView | null;
    proofMethodUsed: string | null;
    recipientCredential: CustodyCredentialView | null;
    recipientAdultAttestation: {
      version: string | null;
      attestedAt: string | null;
      required: boolean;
    };
    identity: {
      required: boolean;
      recorded: boolean;
      provider: string | null;
      state: string | null;
      identityVerified: boolean | null;
      adultVerified: boolean | null;
      authorizedRecipientMatch: boolean | null;
      verifiedAt: string | null;
      policyVersion: string | null;
    };
    sealConditionRequired: boolean;
  };
  evidence: CustodyEvidenceView[];
  claims: Array<{
    claimId: string;
    problemType: string;
    details: string;
    state: string;
    submittedAt: string | null;
    resolvedAt: string | null;
    version: number;
    evidence: Array<{ evidenceId: string; finalizedAt: string | null }>;
  }>;
  incidents: Array<{
    incidentId: string;
    incidentType: string;
    incidentState: string;
    severity: string;
    summary: string | null;
    openedAt: string | null;
    resolvedAt: string | null;
    closedAt: string | null;
    version: number;
  }>;
  unavailable: string[];
};

type CustodyCredentialView = {
  state: string;
  verifiedAt: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  failedAttempts: number;
  generation: number;
};

type CustodyPlaceView = {
  recordedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
};

export function fetchCustodyBundle(deliveryId: string) {
  return call<{ custody: CustodyView }>(
    `/api/couranr/operations/deliveries/${deliveryId}/custody`
  );
}

/** One signed-URL exchange for a customer's own claim photograph. */
function fetchClaimEvidenceUrl(claimId: string, evidenceId: string) {
  return call<{ url: string; expiresInSeconds: number }>(
    `/api/couranr/operations/problem-reports/${claimId}?evidenceId=${encodeURIComponent(evidenceId)}`
  );
}

/* ───────────────────────────────────────────────────────────── formatting ── */

/**
 * Cents to dollars, for a DECLARED value only.
 *
 * This is the sender's own statement of what the shipment was worth. It is not
 * a price, not a payout and not an entitlement — nothing on this screen turns
 * it into money, and the copy beside it says so.
 */
function formatDeclared(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "Not declared";
  return `$${(cents / 100).toFixed(2)}`;
}

function when(value: string | null): string {
  return value ? formatProofWhen(value) : "—";
}

function words(value: string | null): string {
  return value ? value.replace(/_/g, " ") : "—";
}

const SECTION_LABELS: Record<string, string> = {
  request: "the sender's declaration and terms",
  evidence: "the driver's photographs",
  seal: "the security seal",
  identity: "the recipient identity check",
  handoff: "the pickup and drop-off records",
  credentials: "the handoff credentials",
  claims: "customer claims",
  claimEvidence: "customer claim photographs",
  incidents: "incidents",
};

const SEAL_TONE: Record<string, "success" | "danger" | "warning"> = {
  intact: "success",
  damaged: "danger",
  missing: "danger",
};

/* ────────────────────────────────────────────────────────────── the panel ── */

export function CustodyBundlePanel({ deliveryId }: { deliveryId: string }) {
  const [custody, setCustody] = React.useState<CustodyView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [mediaError, setMediaError] = React.useState<string | null>(null);
  const [openingId, setOpeningId] = React.useState<string | null>(null);
  /** Seconds only. The URL itself is used and dropped inside the handler. */
  const [expirySeconds, setExpirySeconds] = React.useState<number | null>(null);
  /** Guards against an older read landing after a newer one. */
  const latestRead = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++latestRead.current;
    setLoading(true);
    const r = await fetchCustodyBundle(deliveryId);
    if (mine !== latestRead.current) return;
    setLoading(false);
    if (isApiFailure(r)) {
      setCustody(null);
      setError(withReference(r));
      return;
    }
    setError(null);
    setCustody(r.value.custody ?? null);
  }, [deliveryId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  /**
   * Opens one photograph and keeps nothing.
   *
   * The signed URL is a bearer capability for a private object: anyone holding
   * it can read the photo until it expires. So it is never put in state, never
   * written to the DOM as an href, never logged and never handed to a parent.
   */
  const openMedia = React.useCallback(
    async (key: string, fetcher: () => Promise<any>) => {
      if (openingId) return;
      setOpeningId(key);
      setMediaError(null);
      setExpirySeconds(null);
      const r = await fetcher();
      setOpeningId(null);
      if (isApiFailure(r)) {
        setMediaError(withReference(r));
        return;
      }
      // A 200 carrying no URL is not a link. `window.open(undefined)` opens a
      // blank tab, which reads as "the photo is missing" rather than "this did
      // not work".
      if (typeof r.value.url !== "string" || r.value.url === "") {
        setMediaError("Couranr did not return a link for that image. Try again.");
        return;
      }
      const opened = window.open(r.value.url, "_blank");
      if (!opened) {
        setMediaError(
          "Your browser blocked the new tab. Allow pop-ups for this page, then open the image again."
        );
        return;
      }
      try {
        opened.opener = null;
      } catch {
        /* the tab is open either way */
      }
      setExpirySeconds(r.value.expiresInSeconds ?? null);
    },
    [openingId]
  );

  if (loading) {
    return (
      <LoadingState label="Loading the custody record">
        <CardSkeleton lines={5} />
      </LoadingState>
    );
  }

  if (error || !custody) {
    return (
      <Card>
        <CardHeader title="Custody record" />
        <ErrorState
          title="Couranr could not load the custody record for this delivery"
          body={`${error ?? "The custody record came back empty."} This does not mean no custody evidence was captured.`}
          action={{ label: "Try again", onClick: () => void load() }}
        />
      </Card>
    );
  }

  const c = custody;
  const openProof = (e: CustodyEvidenceView | null) =>
    e && e.hasMedia
      ? () => void openMedia(e.proofId, () => fetchOperationsProofUrl(e.proofId))
      : null;

  return (
    <Card id="custody-bundle">
      <CardHeader
        title="Custody record"
        description="Everything Couranr recorded about this shipment, in the order it happened. Reviewing it settles nothing."
        actions={
          <Badge tone="neutral">
            {c.reference ? c.reference : words(c.fulfillmentState)}
          </Badge>
        }
      />

      <Stack gap={6}>
        <Text size="xs" muted>
          Locations and accuracy below are reported by the driver&rsquo;s device. They support a review but do not independently prove physical presence or handoff.
        </Text>
        {/*
          The one thing that must never be silent. A section that failed to read
          is NOT a section with nothing in it, and an investigator deciding a
          claim on a chain with a hole in it needs to know the hole is ours.
        */}
        {c.unavailable.length > 0 ? (
          <Alert tone="danger" title="Part of this custody record could not be read">
            Couranr could not read{" "}
            {c.unavailable.map((s) => SECTION_LABELS[s] ?? s).join(", ")}. That is a Couranr read
            failure, not evidence that nothing was recorded. Reload before deciding anything on
            this record.
          </Alert>
        ) : null}

        {mediaError ? (
          <Alert tone="danger" title="That image did not open">
            {mediaError}
          </Alert>
        ) : null}

        {expirySeconds !== null ? (
          <Text size="xs" muted role="status">
            That link works for about {describeSeconds(expirySeconds)} and Couranr does not keep
            it. Open the image again if it expires.
          </Text>
        ) : null}

        {/* ── 1. what the sender said, and what they agreed to ───────────── */}
        <Section title="What the sender declared">
          <Stack gap={2}>
            <Fact label="Description">
              {c.declaration.description ?? "Not recorded"}
            </Fact>
            <Grid columns={4}>
              <Fact label="Declared total value">
                {formatDeclared(c.declaration.declaredValueCents)}
              </Fact>
              <Fact label="Protection level">{words(c.declaration.protectionLevel)}</Fact>
              <Fact label="Protection policy">
                {c.declaration.protectionPolicyVersion ?? "—"}
              </Fact>
              <Fact label="Packages">
                {c.declaration.packageCount === null ? "—" : String(c.declaration.packageCount)}
              </Fact>
            </Grid>
            {c.declaration.restrictedClass && c.declaration.restrictedClass !== "none" ? (
              <Fact label="Restricted class">{words(c.declaration.restrictedClass)}</Fact>
            ) : null}
            {c.declaration.handlingNotes ? (
              <Fact label="Handling notes">{c.declaration.handlingNotes}</Fact>
            ) : null}
            <Text size="xs" muted>
              A declared value is the sender&rsquo;s own statement of worth, recorded before
              pickup. It is not a price, not an entitlement and not an amount Couranr owes. No
              action on this screen turns it into money.
            </Text>
            {!c.declaration.protectionGoverned ? (
              <Alert tone="info" title="No protection policy governs this delivery">
                This shipment carries no protection policy version, so the seal, attestation and
                identity rules below were never applied to it. Judge it on what was recorded, not
                on rules it never saw.
              </Alert>
            ) : null}
            <Grid columns={4}>
              <Fact label="Terms version">{c.senderTerms.termsVersion ?? "—"}</Fact>
              <Fact label="Terms accepted">{when(c.senderTerms.termsAcceptedAt)}</Fact>
              <Fact label="Electronic consent">{when(c.senderTerms.electronicConsentAt)}</Fact>
              <Fact label="Sender adult attestation">{when(c.senderTerms.adultAttestedAt)}</Fact>
            </Grid>
          </Stack>
        </Section>

        {/* ── 2. the pickup ─────────────────────────────────────────────── */}
        <Section title="Pickup">
          <Stack gap={3}>
            <Grid columns={4}>
              <Fact label="Sender credential">{words(c.pickup.credential?.state ?? null)}</Fact>
              <Fact label="Accepted at">{when(c.pickup.credential?.verifiedAt ?? null)}</Fact>
              <Fact label="Failed attempts">
                {c.pickup.credential ? String(c.pickup.credential.failedAttempts) : "—"}
              </Fact>
              <Fact label="Recorded at pickup">{when(c.pickup.place?.recordedAt ?? null)}</Fact>
            </Grid>
            <PlaceLine label="Device-reported pickup location" place={c.pickup.place} />
            {c.pickup.observedPackageCount !== null ? (
              <Fact label="Packages the driver counted">
                {String(c.pickup.observedPackageCount)}
              </Fact>
            ) : null}

            <EvidenceRow
              label="Item before packing"
              evidence={c.pickup.prepackPhoto}
              required={c.pickup.documentationRequired}
              opening={openingId === c.pickup.prepackPhoto?.proofId}
              onOpen={openProof(c.pickup.prepackPhoto)}
            />
            <EvidenceRow
              label="Sealed package"
              evidence={c.pickup.sealedPackagePhoto}
              required={c.pickup.documentationRequired}
              opening={openingId === c.pickup.sealedPackagePhoto?.proofId}
              onOpen={openProof(c.pickup.sealedPackagePhoto)}
            />

            {/*
              The ordering fact. Couranr's database refuses a governed pickup
              whose credential was consumed before the photographs, because a
              sender's confirmation given before the documentation existed
              cannot have been about it. Restating it here is what lets an
              investigator SEE that, rather than infer it from four timestamps.
            */}
            {c.pickup.credentialAfterDocumentation === false ? (
              <Alert tone="danger" title="The sender confirmed before the shipment was documented">
                The pickup credential was accepted BEFORE the item and sealed-package photographs
                were captured. The sender cannot have been confirming this documented, sealed
                shipment.
              </Alert>
            ) : c.pickup.credentialAfterDocumentation === true ? (
              <Text size="xs" muted>
                The sender&rsquo;s credential was accepted after both photographs, so the
                confirmation covers the documented shipment.
              </Text>
            ) : c.pickup.documentationRequired ? (
              <Text size="xs" muted>
                Couranr cannot check the confirmation ordering: one of the credential or
                photograph timestamps is missing.
              </Text>
            ) : null}
          </Stack>
        </Section>

        {/* ── 3. the seal ───────────────────────────────────────────────── */}
        <Section title="Security seal">
          {c.seal ? (
            <Stack gap={3}>
              <Grid columns={4}>
                <Fact label="Seal identifier">{c.seal.sealIdentifier ?? "—"}</Fact>
                <Fact label="Applied">{when(c.seal.appliedAt)}</Fact>
                <Fact label="Condition at drop-off">
                  {c.seal.dropoffCondition ? (
                    <Badge tone={SEAL_TONE[c.seal.dropoffCondition] ?? "neutral"}>
                      {words(c.seal.dropoffCondition)}
                    </Badge>
                  ) : (
                    "Not recorded"
                  )}
                </Fact>
                <Fact label="Condition recorded">{when(c.seal.dropoffRecordedAt)}</Fact>
              </Grid>
              <EvidenceRow
                label="Sealed package (the photograph this seal is bound to)"
                evidence={c.seal.sealedPackagePhoto}
                required={false}
                opening={openingId === c.seal.sealedPackagePhoto?.proofId}
                onOpen={openProof(c.seal.sealedPackagePhoto)}
              />
              <EvidenceRow
                label="Seal at drop-off"
                evidence={c.seal.dropoffSealPhoto}
                required={false}
                opening={openingId === c.seal.dropoffSealPhoto?.proofId}
                onOpen={openProof(c.seal.dropoffSealPhoto)}
              />
              {c.dropoff.sealConditionRequired && !c.seal.dropoffCondition ? (
                <Alert tone="warning" title="No seal condition was recorded at drop-off">
                  This protection level requires the driver to record the seal&rsquo;s condition
                  before the delivery can complete.
                </Alert>
              ) : null}
            </Stack>
          ) : c.unavailable.includes("seal") ? (
            <Alert tone="danger" title="Couranr could not read the seal record">
              This is a read failure. Do not treat it as evidence that no seal was applied.
            </Alert>
          ) : (
            <Text size="sm" muted>
              No security seal was recorded for this delivery. Couranr read this successfully.
              {c.pickup.documentationRequired
                ? " This protection level requires one."
                : " This protection level does not require one."}
            </Text>
          )}
        </Section>

        {/* ── 4. the drop-off ───────────────────────────────────────────── */}
        <Section title="Drop-off">
          <Stack gap={3}>
            <Grid columns={4}>
              <Fact label="Recipient PIN">
                {words(c.dropoff.recipientCredential?.state ?? null)}
              </Fact>
              <Fact label="Verified at">
                {when(c.dropoff.recipientCredential?.verifiedAt ?? null)}
              </Fact>
              <Fact label="Failed attempts">
                {c.dropoff.recipientCredential
                  ? String(c.dropoff.recipientCredential.failedAttempts)
                  : "—"}
              </Fact>
              <Fact label="Proof method used">{words(c.dropoff.proofMethodUsed)}</Fact>
            </Grid>
            <PlaceLine label="Device-reported delivery location" place={c.dropoff.place} />

            <Grid columns={2}>
              <Fact label="Recipient adult attestation">
                {c.dropoff.recipientAdultAttestation.attestedAt
                  ? `${when(c.dropoff.recipientAdultAttestation.attestedAt)} · ${
                      c.dropoff.recipientAdultAttestation.version ?? "no version"
                    }`
                  : c.dropoff.recipientAdultAttestation.required
                    ? "Required and not recorded"
                    : "Not required"}
              </Fact>
              <Fact label="Authorized-recipient match">
                {c.dropoff.identity.authorizedRecipientMatch === null
                  ? c.dropoff.identity.required
                    ? "Required and not recorded"
                    : "Not checked"
                  : c.dropoff.identity.authorizedRecipientMatch
                    ? "Matched"
                    : "DID NOT MATCH"}
              </Fact>
            </Grid>

            {c.dropoff.identity.recorded ? (
              <Grid columns={4}>
                <Fact label="Identity check">{words(c.dropoff.identity.state)}</Fact>
                <Fact label="Provider">{words(c.dropoff.identity.provider)}</Fact>
                <Fact label="Adult verified">
                  {c.dropoff.identity.adultVerified === null
                    ? "—"
                    : c.dropoff.identity.adultVerified
                      ? "Yes"
                      : "No"}
                </Fact>
                <Fact label="Verified at">{when(c.dropoff.identity.verifiedAt)}</Fact>
              </Grid>
            ) : c.unavailable.includes("identity") ? (
              <Alert tone="danger" title="Couranr could not read the identity check">
                This is a read failure, not evidence that no check was performed.
              </Alert>
            ) : c.dropoff.identity.required ? (
              <Alert tone="danger" title="No recipient identity check was recorded">
                This protection level requires a verified Stripe Identity result before the
                delivery can complete.
              </Alert>
            ) : (
              <Text size="sm" muted>
                No recipient identity check was required at this protection level, and none was
                recorded.
              </Text>
            )}
          </Stack>
        </Section>

        {/* ── 5. everything the driver captured ─────────────────────────── */}
        <Section title="All recorded evidence">
          {c.evidence.length === 0 ? (
            <Text size="sm" muted>
              {c.unavailable.includes("evidence")
                ? "Couranr could not read this delivery's photographs. This does not mean none were captured."
                : "Nothing recorded for this delivery yet. Couranr read this successfully."}
            </Text>
          ) : (
            <Stack gap={2}>
              {c.evidence.map((e) => (
                <EvidenceRow
                  key={e.proofId}
                  label={`${proofTypeLabel(e.proofType)} · ${proofStageLabel(e.proofStage)}`}
                  evidence={e}
                  required={false}
                  opening={openingId === e.proofId}
                  onOpen={openProof(e)}
                />
              ))}
            </Stack>
          )}
        </Section>

        {/* ── 6. what the customer has claimed ──────────────────────────── */}
        <Section title="Customer claims">
          {c.claims.length === 0 ? (
            <Text size="sm" muted>
              {c.unavailable.includes("claims")
                ? "Couranr could not read this delivery's claims. This does not mean none were submitted."
                : "No customer has reported a problem with this delivery."}
            </Text>
          ) : (
            <Stack gap={4}>
              {c.claims.map((claim) => (
                <Stack key={claim.claimId} gap={2}>
                  <Cluster gap={2}>
                    <Text as="span" strong>
                      {words(claim.problemType)}
                    </Text>
                    <Badge tone={claim.state === "resolved" ? "success" : "warning"}>
                      {words(claim.state)}
                    </Badge>
                    <Text as="span" size="xs" muted>
                      Submitted {when(claim.submittedAt)}
                    </Text>
                  </Cluster>
                  <Text size="sm">&ldquo;{claim.details}&rdquo;</Text>
                  {claim.evidence.length === 0 ? (
                    <Text size="xs" muted>
                      The customer attached no photographs.
                    </Text>
                  ) : (
                    <Stack gap={1}>
                      {claim.evidence.map((ev) => (
                        <Cluster key={ev.evidenceId} gap={2} justify="between">
                          <Text size="xs" muted>
                            Customer photograph · {when(ev.finalizedAt)}
                          </Text>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={openingId === ev.evidenceId}
                            loadingLabel="Opening…"
                            onClick={() =>
                              void openMedia(ev.evidenceId, () =>
                                fetchClaimEvidenceUrl(claim.claimId, ev.evidenceId)
                              )
                            }
                          >
                            Open image in a new tab
                          </Button>
                        </Cluster>
                      ))}
                    </Stack>
                  )}
                </Stack>
              ))}
              {/*
                CUS-004: a claim is a report, not an instruction to pay. Nothing
                on this screen issues product-value compensation, and resolving
                the claim where it IS resolved does not either.
              */}
              <Alert tone="info" title="A claim does not issue compensation">
                Reviewing or resolving a customer claim records a support outcome. It never issues
                product-value compensation and never moves money on its own — any refund is a
                separate, governed payment action on the payments screen.
              </Alert>
            </Stack>
          )}
        </Section>

        {/* ── 7. incidents ──────────────────────────────────────────────── */}
        <Section title="Incidents">
          {c.incidents.length === 0 ? (
            <Text size="sm" muted>
              {c.unavailable.includes("incidents")
                ? "Couranr could not read this delivery's incidents. This does not mean none were opened."
                : "No incident has been opened against this delivery."}
            </Text>
          ) : (
            <Stack gap={3}>
              {c.incidents.map((i) => (
                <Stack key={i.incidentId} gap={1}>
                  <Cluster gap={2}>
                    <Text as="span" strong>
                      {words(i.incidentType)}
                    </Text>
                    <Badge
                      tone={
                        i.incidentState === "resolved" || i.incidentState === "closed"
                          ? "success"
                          : i.severity === "urgent"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {words(i.incidentState)}
                    </Badge>
                  </Cluster>
                  {i.summary ? <Text size="sm">{i.summary}</Text> : null}
                  <Text size="xs" muted>
                    Opened {when(i.openedAt)}
                    {i.resolvedAt ? ` · resolved ${when(i.resolvedAt)}` : ""}
                    {i.closedAt ? ` · closed ${when(i.closedAt)}` : ""}
                  </Text>
                </Stack>
              ))}
              <Alert tone="info" title="Resolving an incident does not move money">
                An incident records what happened and who reviewed it. Resolving or closing one
                changes the incident state only — it issues no refund, no credit and no capture.
              </Alert>
            </Stack>
          )}
        </Section>
      </Stack>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────── the parts ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap={3}>
      <Text strong>{title}</Text>
      {children}
    </Stack>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text size="xs" muted>
        {label}
      </Text>
      <Text>{children}</Text>
    </div>
  );
}

function PlaceLine({ label, place }: { label: string; place: CustodyPlaceView | null }) {
  if (!place || place.latitude === null || place.longitude === null) {
    return (
      <Text size="xs" muted>
        {label}: not recorded
      </Text>
    );
  }
  return (
    <Text size="xs" muted>
      {label}: {place.latitude.toFixed(5)}, {place.longitude.toFixed(5)}
      {place.accuracyMeters !== null ? ` (reported accuracy ±${Math.round(place.accuracyMeters)} m)` : ""} ·{" "}
      {when(place.recordedAt)}
    </Text>
  );
}

function EvidenceRow({
  label,
  evidence,
  required,
  opening,
  onOpen,
}: {
  label: string;
  evidence: CustodyEvidenceView | null;
  required: boolean;
  opening: boolean;
  onOpen: (() => void) | null;
}) {
  if (!evidence) {
    return (
      <Cluster gap={2} justify="between">
        <Text size="sm" muted>
          {label}: not recorded
        </Text>
        {required ? <Badge tone="danger">Required</Badge> : null}
      </Cluster>
    );
  }
  return (
    <Cluster gap={2} justify="between">
      <Stack gap={1}>
        <Text as="span" size="sm" strong>
          {label}
        </Text>
        <Text size="xs" muted>
          Recorded {when(evidence.finalizedAt ?? evidence.capturedAt)}
        </Text>
      </Stack>
      {evidence.hasMedia && onOpen ? (
        <Button
          variant="secondary"
          size="sm"
          loading={opening}
          loadingLabel="Opening…"
          onClick={onOpen}
        >
          Open image in a new tab
        </Button>
      ) : (
        <Badge tone="neutral">No image</Badge>
      )}
    </Cluster>
  );
}

/** The TTL is chosen server-side by viewer role; this only reads it back. */
function describeSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "a moment";
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  return `${Math.round(seconds / 60)} minutes`;
}
