"use client";

import * as React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Divider,
  Heading,
  Stack,
  Text,
  VisuallyHidden,
} from "@/components/couranr/primitives";
import { Field, Select, Textarea } from "@/components/couranr/forms";
import { CardSkeleton, ErrorState } from "@/components/couranr/states";
import { CouranrLogo } from "@/components/brand/CouranrLogo";
import type { CustomerTopic } from "@/lib/couranr/conversations/states";
import {
  fetchHelp,
  newIdempotencyKey,
  sendHelpMessage,
  submitResolutionRequest,
  saveProblemDraft,
  submitProblemReport,
  uploadCustomerProblemPhoto,
  type HelpView,
  type ProblemReportView,
  type ProblemType,
} from "./client";
import type {
  HelpLifecycleStatus,
  HelpRefundState,
  HelpReturnState,
} from "@/lib/couranr/conversations/helpStatusStates";
import {
  HELP_RESOLUTION_REASONS,
  HELP_RESOLUTION_REASON_LABELS,
  type HelpResolutionPolicy,
  type HelpResolutionReason,
} from "@/lib/couranr/conversations/helpResolutionTypes";

/**
 * PUB-007 — Delivery Help.
 *
 * REQUIRED STATES, from the registry: "Open; waiting on customer; waiting on
 * Couranr; resolved; after-hours; urgent safety escalation."
 *
 * WHAT THIS PAGE MAY NOT DO:
 *
 *   * "No public support phone at MVP." There is no number anywhere on this
 *     page, and the API returns `supportPhone: null` so none can be introduced
 *     by reading the payload.
 *   * "State the normal 15-minute response target during operating hours, not a
 *     guarantee." The copy says "normally replies within", never "will reply"
 *     or "guaranteed".
 *   * TRM-001: no 24/7 claim, no founder voice. It is Couranr that replies.
 *
 * AFTER-HOURS IS STILL NOT RENDERED, and the reason has CHANGED. It used to be
 * that HRS-002 was unresolved, so the zone was unknown and the server reported
 * `operatingHoursApplied: false`; guessing a zone to say "we are closed" would
 * have been worse than saying nothing. HRS-002 was decided on 2026-08-06
 * (America/New_York) and the route now reports `true`, so the deadline this
 * page's target refers to is computed on the operating clock.
 *
 * What is missing now is simply the indicator: this page still states the
 * window without saying whether the current moment is inside it. That is
 * UNBUILT, not declined — recorded here so the next person does not read a
 * stale justification and conclude the decision is still open.
 */

const TOPIC_LABELS: Record<CustomerTopic, string> = {
  availability: "I will not be available",
  access: "Access or entry instructions",
  address_concern: "Something about the address",
  handoff_concern: "How the handoff should work",
  unrecognized_delivery: "I did not expect this delivery",
  delivery_problem: "There is a problem with the delivery",
  other: "Something else",
};

/**
 * The fragments UI_SCREEN_REGISTRY.md gives CUS-001 and CUS-003 —
 * `/help/[token]#address-change` and `#recipient-unavailable`. Opening the page
 * at one preselects its topic, which is what makes them screens in the
 * registry's sense without being separate routes or separate write paths.
 */
const FRAGMENT_TOPICS: Record<string, CustomerTopic> = {
  "address-change": "address_concern",
  "recipient-unavailable": "availability",
  "delivery-problem": "delivery_problem",
};

const REFUSAL = "This help link is not available.";

type Phase =
  | { phase: "loading" }
  | { phase: "refused" }
  | { phase: "failed" }
  | { phase: "ready"; view: HelpView };

export function DeliveryHelpPage({ token }: { token: string }) {
  const [state, setState] = React.useState<Phase>({ phase: "loading" });

  const [topic, setTopic] = React.useState<CustomerTopic>("other");
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [justSent, setJustSent] = React.useState(false);

  /**
   * One key per composed message, held until that message is accepted. A retry
   * reuses it, so a double-tap on a flaky connection posts once rather than
   * twice — the server resolves the duplicate to the original.
   */
  const idempotencyKey = React.useRef<string>("");
  if (idempotencyKey.current === "") idempotencyKey.current = newIdempotencyKey();

  const load = React.useCallback(
    async (showLoading = true) => {
      if (showLoading) setState({ phase: "loading" });
      const result = await fetchHelp(token);
      if ("failed" in result) setState({ phase: "failed" });
      else if (!result.resolved) setState({ phase: "refused" });
      else setState({ phase: "ready", view: result.view });
    },
    [token]
  );

  React.useEffect(() => {
    void load(true);
  }, [load]);

  React.useEffect(() => {
    if (state.phase !== "ready" || typeof window === "undefined") return;
    const target = window.location.hash.replace(/^#/, "");
    if (
      target !== "return-status" &&
      target !== "cancellation-return" &&
      target !== "delivery-problem"
    ) return;
    window.requestAnimationFrame(() => {
      document.getElementById(target)?.scrollIntoView({ block: "start" });
    });
  }, [state.phase]);

  // Preselect from the fragment, so CUS-001 and CUS-003 open on their topic.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const preset = FRAGMENT_TOPICS[window.location.hash.replace(/^#/, "")];
    if (preset) setTopic(preset);
  }, []);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (sending || body.trim().length === 0) return;
    setSending(true);
    setSendError(null);

    const outcome = await sendHelpMessage({
      token,
      body,
      topic,
      idempotencyKey: idempotencyKey.current,
    });

    setSending(false);
    // `tsconfig` sets "strict": false, so `!outcome.sent` does not narrow this
    // union — the same reason every command module in this repo ships an
    // explicit `is*Failure` predicate rather than relying on `.ok`.
    if (outcome.sent === false) {
      setSendError(outcome.reason);
      return;
    }

    // Accepted: retire this key so the next message is a new one.
    idempotencyKey.current = newIdempotencyKey();
    setBody("");
    setJustSent(true);
    await load(false);
  }

  if (state.phase === "loading") {
    return (
      <Stack gap={6}>
        <CouranrLogo />
        <VisuallyHidden>Loading your delivery help.</VisuallyHidden>
        <CardSkeleton />
      </Stack>
    );
  }

  if (state.phase === "refused") {
    // ONE SENTENCE for expired, revoked, unknown and malformed. The server
    // already collapsed them; a per-reason message here would put the
    // distinction back. No retry, because retrying resolves nothing.
    return (
      <Stack gap={6}>
        <CouranrLogo />
        <Alert tone="warning" title="Delivery Help">
          <Text>{REFUSAL}</Text>
          <Text>
            If you are expecting a delivery, the business that arranged it can send you a new link.
          </Text>
        </Alert>
      </Stack>
    );
  }

  if (state.phase === "failed") {
    // Distinct from a refusal: we could not find out, so a retry is offered.
    return (
      <Stack gap={6}>
        <CouranrLogo />
        <ErrorState
          title="We could not load this page"
          body="Check your connection and try again."
          action={{ label: "Try again", onClick: () => void load() }}
        />
      </Stack>
    );
  }

  const { view } = state;
  const waitingOnCouranr = view.messages.length > 0;

  return (
    <Stack gap={6}>
      <CouranrLogo />

      <Stack gap={2}>
        <Heading level={1}>Delivery Help</Heading>
        <Text muted>
          Tell Couranr what you need and we will take it from here. This link is for one delivery.
        </Text>
      </Stack>

      <Card>
        <CardHeader
          title="How quickly we reply"
          description={
            /* "Normally" and "target", never "guaranteed" — PUB-007's mandatory
               correction, and TRM-001's no-24/7 rule. */
            `Couranr normally replies to messages within ${view.supportTargetMinutes} minutes during operating hours. Operating hours are Monday to Friday, 6:00 AM to 6:00 PM.`
          }
        />
        <Text muted>
          Couranr does not offer phone support. Everything is handled here so it stays attached to
          your delivery.
        </Text>
      </Card>

      <CancellationReturnRequestPanel
        token={token}
        policy={view.resolutionPolicy}
        onSent={() => load(false)}
      />

      <ReturnRefundStatusPanel status={view.returnStatus} />

      <DeliveryProblemPanel
        token={token}
        reports={view.problemReports}
        onChanged={() => load(false)}
      />

      <Divider />

      <Stack gap={3}>
        <Heading level={2}>Your messages</Heading>

        {view.messages.length === 0 ? (
          <Text muted>
            You have not sent anything yet. Choose what this is about and tell us what is happening.
          </Text>
        ) : (
          <Stack gap={3}>
            {/* Derived from what the customer can actually see. The server does
                not send a "waiting on" for this surface, and inventing one from
                a guessed timezone is exactly what HRS-002 forbids. */}
            <Badge tone={waitingOnCouranr ? "info" : "neutral"}>
              {waitingOnCouranr ? "Waiting on Couranr" : "Open"}
            </Badge>

            {view.messages.map((m) => (
              <Card key={m.id}>
                <Stack gap={2}>
                  <Text muted size="sm">
                    {(m.topic ? TOPIC_LABELS[m.topic] : null) ?? "Update"} ·{" "}
                    {new Date(m.createdAt).toLocaleString()}
                  </Text>
                  <Text>{m.body}</Text>
                </Stack>
              </Card>
            ))}
          </Stack>
        )}
      </Stack>

      <Divider />

      <form onSubmit={onSend}>
        <Stack gap={3}>
          <Heading level={2}>Send a message</Heading>

          <Field label="What is this about?" required>
            {(p) => (
              <Select
                {...p}
                value={topic}
                onChange={(e) => setTopic(e.target.value as CustomerTopic)}
              >
                {view.topics.map((t) => (
                  <option key={t} value={t}>
                    {TOPIC_LABELS[t] ?? t}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Tell us what is happening" required>
            {(p) => (
              <Textarea
                {...p}
                value={body}
                maxLength={4000}
                rows={5}
                onChange={(e) => {
                  setBody(e.target.value);
                  setJustSent(false);
                }}
                placeholder="For example: I will not be home until after 6pm."
              />
            )}
          </Field>

          {/* Said plainly rather than discovered. A customer who expects a
              message to move their delivery and finds it did not is worse off
              than one who was told up front. */}
          <Text muted size="sm">
            Sending a message does not change your delivery on its own. Couranr will read it and
            confirm anything that needs to change.
          </Text>

          {sendError ? (
            <Alert tone="danger" title="Not sent">
              {sendError}
            </Alert>
          ) : null}
          {justSent ? (
            <Alert tone="success" title="Sent">
              Couranr has your message.
            </Alert>
          ) : null}

          <Button type="submit" disabled={sending || body.trim().length === 0}>
            {sending ? "Sending…" : "Send to Couranr"}
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}


const RETURN_COPY: Record<HelpReturnState, { label: string; tone: "neutral" | "info" | "warning"; body: string }> = {
  none: {
    label: "No return open",
    tone: "neutral",
    body: "No physical return is currently recorded for this delivery.",
  },
  required: {
    label: "Return required",
    tone: "warning",
    body: "Couranr has recorded that this delivery must be returned. The return trip has not started yet.",
  },
  returning: {
    label: "Returning",
    tone: "info",
    body: "The delivery is on its governed return route.",
  },
  returned: {
    label: "Returned",
    tone: "neutral",
    body: "Couranr has recorded the return handoff as complete.",
  },
};

const REFUND_COPY: Record<
  HelpRefundState,
  { label: string; tone: "neutral" | "info" | "success" | "warning"; body: string }
> = {
  none: {
    label: "No refund decision",
    tone: "neutral",
    body: "No Couranr delivery-service refund decision is currently recorded.",
  },
  pending: {
    label: "Refund pending",
    tone: "info",
    body: "A Couranr delivery-service refund is in progress. This page will update when Couranr records the provider result.",
  },
  refunded: {
    label: "Refunded",
    tone: "success",
    body: "Couranr records the delivery-service refund as completed.",
  },
  not_due: {
    label: "No refund due",
    tone: "neutral",
    body: "Couranr records that no delivery-service refund is due for this resolution.",
  },
  needs_review: {
    label: "Refund needs review",
    tone: "warning",
    body: "Refund processing needs Couranr review. You can use the message form on this page if you need help.",
  },
};

function ReturnRefundStatusPanel({ status }: { status: HelpLifecycleStatus }) {
  return (
    <div id="return-status">
      <Card>
        <CardHeader
          title="Return & delivery refund"
          description="Status for this delivery only."
        />
        {!status.available ? (
          <Alert tone="warning" title="Status temporarily unavailable">
            Couranr could not load the return or refund status just now. Delivery Help is still available below.
          </Alert>
        ) : (
          <Stack gap={4}>
            <Stack gap={2}>
              <Badge tone={RETURN_COPY[status.returnState].tone}>
                {RETURN_COPY[status.returnState].label}
              </Badge>
              <Text>{RETURN_COPY[status.returnState].body}</Text>
              <StatusTime label="Return required" value={status.returnRequiredAt} />
              <StatusTime label="Return started" value={status.returnStartedAt} />
              <StatusTime label="Return completed" value={status.returnedAt} />
            </Stack>

            <Divider />

            <Stack gap={2}>
              <Badge tone={REFUND_COPY[status.refundState].tone}>
                {REFUND_COPY[status.refundState].label}
              </Badge>
              <Text>{REFUND_COPY[status.refundState].body}</Text>
              <StatusTime label="Refund status updated" value={status.refundUpdatedAt} />
            </Stack>
          </Stack>
        )}

        <Text muted size="sm">
          This page covers Couranr delivery-service status only. Product refunds, replacements,
          merchandise value, and merchandise-return decisions are handled by the business that sold
          the item. Payment amounts and payment-method details are not shown on a Delivery Help link.
        </Text>
      </Card>
    </div>
  );
}

function StatusTime({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <Text size="sm" muted>
      {label} · {new Date(value).toLocaleString()}
    </Text>
  );
}



const PROBLEM_LABELS:Record<ProblemType,string>={
  damaged:"Damaged or in different condition",
  missing:"Something is missing",
  wrong_item:"Wrong item",
  undelivered:"Not delivered",
};
const PROBLEM_STATE_LABELS:Record<ProblemReportView["state"],string>={
  draft:"Draft",
  reported:"Reported",
  awaiting_evidence:"Awaiting evidence",
  under_review:"Under review",
  resolved:"Resolved",
};
type SelectedProblemPhoto={id:string;file:File};

function DeliveryProblemPanel({
  token,reports,onChanged,
}:{
  token:string;
  reports:ProblemReportView[]|null;
  onChanged:()=>Promise<void>|void;
}){
  // The server returns newest first. Keep the latest resolved report visible
  // rather than silently replacing its required "Resolved" case status with a
  // blank new-report form.
  const active=reports?.[0]??null;
  const draft=active?.state==="draft"?active:null;
  const remainingPhotoSlots=Math.max(0,5-(active?.evidenceCount??0));
  const [problemType,setProblemType]=React.useState<ProblemType>(draft?.problemType??"damaged");
  const [details,setDetails]=React.useState(draft?.details??"");
  const [photos,setPhotos]=React.useState<SelectedProblemPhoto[]>([]);
  const [busy,setBusy]=React.useState(false);
  const [error,setError]=React.useState<string|null>(null);
  const [success,setSuccess]=React.useState<string|null>(null);
  const [submitKey,setSubmitKey]=React.useState(()=>newIdempotencyKey());
  // Hidden retry state: once submit starts, the exact report id + key must be
  // replayed until Couranr confirms the outcome. Creating a fresh draft while
  // the first submit outcome is unknown can never be safe.
  const pendingSubmit=React.useRef<{reportId:string;idempotencyKey:string}|null>(null);

  React.useEffect(()=>{
    if(!draft)return;
    setProblemType(draft.problemType);
    setDetails(draft.details);
  },[draft?.id,draft?.problemType,draft?.details]);

  function choosePhotos(list:FileList|null){
    setError(null);
    const files=Array.from(list??[]);
    if(files.length>remainingPhotoSlots){
      setError(
        remainingPhotoSlots===0
          ?"This report already has five photos."
          :`Choose up to ${remainingPhotoSlots} more ${remainingPhotoSlots===1?"photo":"photos"}.`
      );
      return;
    }
    setPhotos(files.map((file)=>({id:crypto.randomUUID(),file})));
  }

  async function uploadPhotos(reportId:string){
    for(const photo of photos){
      const outcome=await uploadCustomerProblemPhoto({
        token,reportId,clientEvidenceId:photo.id,file:photo.file,
      });
      if(outcome.sent===false)throw new Error(outcome.reason);
    }
  }

  async function submit(){
    if(busy)return;
    // Once a submit outcome is unknown, current form edits are irrelevant:
    // first resolve the exact in-flight report id + key. Only a brand-new
    // submission validates the current draft fields.
    if(!pendingSubmit.current&&!details.trim()){
      setError("Add a short description of what happened.");
      return;
    }
    setBusy(true);setError(null);setSuccess(null);
    try{
      // If a previous submit request may have reached Couranr, resolve that
      // exact request first. Never call saveProblemDraft while its outcome is
      // unknown: the committed report may already be "reported".
      if(pendingSubmit.current){
        const replay=await submitProblemReport({
          token,
          reportId:pendingSubmit.current.reportId,
          idempotencyKey:pendingSubmit.current.idempotencyKey,
        });
        if(replay.sent===false)throw new Error(replay.reason);
        pendingSubmit.current=null;
        setSubmitKey(newIdempotencyKey());
        setPhotos([]);
        setSuccess("Couranr has your delivery report.");
        await onChanged();
        return;
      }

      const saved=await saveProblemDraft({token,problemType,details});
      if(saved.sent===false)throw new Error(saved.reason);
      await uploadPhotos(saved.report.id);

      const request={
        reportId:saved.report.id,
        idempotencyKey:submitKey,
      };
      pendingSubmit.current=request;
      const submitted=await submitProblemReport({
        token,reportId:request.reportId,idempotencyKey:request.idempotencyKey,
      });
      if(submitted.sent===false)throw new Error(submitted.reason);

      pendingSubmit.current=null;
      setSubmitKey(newIdempotencyKey());
      setPhotos([]);
      setSuccess("Couranr has your delivery report.");
      await onChanged();
    }catch(e:any){
      setError(e?.message||"We could not submit that report. Try again.");
    }finally{setBusy(false);}
  }

  async function addRequestedEvidence(){
    if(!active||active.state!=="awaiting_evidence"||photos.length===0||busy)return;
    setBusy(true);setError(null);setSuccess(null);
    try{
      await uploadPhotos(active.id);
      setPhotos([]);
      setSuccess("The additional evidence was attached.");
      await onChanged();
    }catch(e:any){
      setError(e?.message||"We could not attach that evidence. Try again.");
    }finally{setBusy(false);}
  }

  if(reports===null){
    return (
      <Card id="delivery-problem">
        <CardHeader title="Report a delivery problem"/>
        <Alert tone="warning" title="Problem reports are temporarily unavailable">
          You can still send Couranr a Delivery Help message below.
        </Alert>
      </Card>
    );
  }

  if(active&&active.state!=="draft"){
    return (
      <Card id="delivery-problem">
        <CardHeader
          title="Delivery problem report"
          description={PROBLEM_LABELS[active.problemType]}
          actions={
            <Badge tone={active.state==="resolved"?"success":"warning"}>
              {PROBLEM_STATE_LABELS[active.state]}
            </Badge>
          }
        />
        <Stack gap={3}>
          <Text>{active.details}</Text>
          <Text size="sm" muted>
            {active.evidenceCount} {active.evidenceCount===1?"photo":"photos"} attached.
          </Text>
          {active.state==="reported"?(
            <Alert tone="info" title="Reported">
              Couranr has the report and will review the delivery issue.
            </Alert>
          ):null}
          {active.state==="under_review"?(
            <Alert tone="info" title="Under review">
              Couranr Operations is reviewing the delivery evidence.
            </Alert>
          ):null}
          {active.state==="resolved"?(
            <Alert tone="success" title="Resolved">
              Couranr Operations has completed review of this delivery report.
            </Alert>
          ):null}
          {active.state==="awaiting_evidence"?(
            <Stack gap={3}>
              <Alert tone="warning" title="Couranr needs more evidence">
                Add useful photos here. Do not photograph faces, IDs or payment information.
              </Alert>
              <Field
                label="Add photos"
                hint={remainingPhotoSlots>0
                  ?`JPEG, PNG, WebP or HEIC. Up to ${remainingPhotoSlots} more.`
                  :"Five photos are already attached."}
              >
                {(a)=><input {...a} type="file" multiple
                  disabled={remainingPhotoSlots===0}
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  onChange={(e)=>choosePhotos(e.currentTarget.files)}/>}
              </Field>
              <Button type="button" disabled={busy||photos.length===0||remainingPhotoSlots===0}
                onClick={()=>void addRequestedEvidence()}>
                {busy?"Uploading…":"Attach evidence"}
              </Button>
            </Stack>
          ):null}
          {success?<Alert tone="success" title="Attached">{success}</Alert>:null}
          {error?<Alert tone="danger" title="Not attached">{error}</Alert>:null}
          <Text size="sm" muted>
            This report does not automatically change the delivery, create a refund, or decide
            responsibility. The business remains responsible for the merchandise and merchandise refunds.
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Card id="delivery-problem">
      <CardHeader
        title="Report a delivery problem"
        description="Tell Couranr what happened and attach useful evidence."
        actions={draft?<Badge tone="neutral">Draft saved</Badge>:undefined}
      />
      <Stack gap={4}>
        <Field label="What went wrong?" required>
          {(a)=>(
            <Select {...a} value={problemType}
              onChange={(e)=>setProblemType(e.target.value as ProblemType)}>
              {Object.entries(PROBLEM_LABELS).map(([value,label])=>(
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Add details" required hint="Describe what you expected and what happened.">
          {(a)=><Textarea {...a} rows={4} maxLength={4000} value={details}
            onChange={(e)=>setDetails(e.target.value)}/>}
        </Field>
        <Field
          label="Add photos"
          hint={remainingPhotoSlots>0
            ?`Optional. JPEG, PNG, WebP or HEIC. Up to ${remainingPhotoSlots}.`
            :"Five photos are already attached."}
        >
          {(a)=><input {...a} type="file" multiple
            disabled={remainingPhotoSlots===0}
            accept="image/jpeg,image/png,image/webp,image/heic"
            onChange={(e)=>choosePhotos(e.currentTarget.files)}/>}
        </Field>
        {photos.length?(
          <Text size="sm" muted>
            {photos.length} {photos.length===1?"photo":"photos"} ready to attach.
          </Text>
        ):null}
        <Alert tone="info" title="What this report does">
          Couranr reviews the delivery issue. It does not automatically refund merchandise or decide
          compensation. The business remains responsible for the merchandise and merchandise refunds.
        </Alert>
        {success?<Alert tone="success" title="Report submitted">{success}</Alert>:null}
        {error?<Alert tone="danger" title="Report not submitted">{error}</Alert>:null}
        <Button type="button" disabled={busy||!details.trim()} onClick={()=>void submit()}>
          {busy?"Submitting…":"Submit delivery report"}
        </Button>
      </Stack>
    </Card>
  );
}

function CancellationReturnRequestPanel({
  token,
  policy,
  onSent,
}: {
  token: string;
  policy: HelpResolutionPolicy;
  onSent: () => Promise<void>;
}) {
  const [reason, setReason] = React.useState<HelpResolutionReason>("customer_request");
  const [note, setNote] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const key = React.useRef("");
  if (key.current === "") key.current = newIdempotencyKey();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!policy.available || !policy.canSubmit || sending) return;
    setSending(true);
    setError(null);
    setSent(false);

    const result = await submitResolutionRequest({
      token,
      reason,
      note,
      idempotencyKey: key.current,
    });
    setSending(false);

    if (result.sent === false) {
      setError(result.reason);
      return;
    }

    key.current = newIdempotencyKey();
    setNote("");
    setSent(true);
    await onSent();
  }

  return (
    <div id="cancellation-return">
      <Card>
        <CardHeader
          title="Cancellation or return request"
          description="Couranr Operations reviews this request. The form itself never changes custody, money or delivery state."
        />

        {!policy.available ? (
          <Alert tone="warning" title="Policy temporarily unavailable">
            Couranr could not load the current cancellation or return policy. You can still use the
            message form below.
          </Alert>
        ) : (
          <Stack gap={4}>
            <Stack gap={2}>
              <Badge tone={policy.canSubmit ? "info" : "neutral"}>{policy.stageLabel}</Badge>
              <Heading level={3}>{policy.title}</Heading>
              <Text>{policy.policySummary}</Text>
              <Text muted size="sm">
                Policy reference: {policy.policyReference}. The amount shown here is delivery-service
                policy, not a statement that you personally are the payer.
              </Text>
            </Stack>

            {policy.canSubmit && policy.submitLabel ? (
              <form onSubmit={submit}>
                <Stack gap={3}>
                  <Field label="Why do you need Couranr to review this?" required>
                    {(p) => (
                      <Select
                        {...p}
                        value={reason}
                        onChange={(e) =>
                          setReason(e.target.value as HelpResolutionReason)
                        }
                      >
                        {HELP_RESOLUTION_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {HELP_RESOLUTION_REASON_LABELS[r]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field label="Additional details (optional)">
                    {(p) => (
                      <Textarea
                        {...p}
                        value={note}
                        maxLength={1200}
                        rows={4}
                        onChange={(e) => {
                          setNote(e.target.value);
                          setSent(false);
                        }}
                        placeholder="Add only what Couranr needs to review the delivery."
                      />
                    )}
                  </Field>

                  <Text muted size="sm">
                    Submitting sends a structured review request into Delivery Help. It does not
                    cancel the delivery, start a return, approve a fee, issue a refund, change the
                    payer or authorize a new charge.
                  </Text>

                  {error ? (
                    <Alert tone="danger" title="Request not sent">
                      {error}
                    </Alert>
                  ) : null}
                  {sent ? (
                    <Alert tone="success" title="Request sent for review">
                      Couranr has the request. The delivery has not changed unless Couranr confirms
                      an approved action separately.
                    </Alert>
                  ) : null}

                  <Button type="submit" disabled={sending}>
                    {sending ? "Sending…" : policy.submitLabel}
                  </Button>
                </Stack>
              </form>
            ) : (
              <Text muted size="sm">
                A new cancellation or return request is not opened from this stage. Use the message
                form below if the recorded outcome needs Couranr review.
              </Text>
            )}
          </Stack>
        )}
      </Card>
    </div>
  );
}
