"use client";

import * as React from "react";
import qrcode from "qrcode-generator";
import { useRouter } from "next/navigation";
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
import { Field, Input, Select } from "@/components/couranr/forms";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/couranr/states";
import {
  fetchMyBusinessAccounts,
  isApiFailure,
  withReference,
  type ApiFailure,
  type BusinessAccountOption,
} from "@/components/couranr/requests/client";
import { fetchWebsiteTools, saveWebsiteTools, type WebsiteToolsView } from "./client";
import { memberMay } from "@/lib/couranr/settings/permissions";
import {
  DEFAULT_EMBED,
  HOSTED_REQUEST_ROUTE_EXISTS,
  embedSnippet,
  hostedRequestUrl,
  validateEmbed,
  type EmbedConfig,
} from "@/lib/couranr/settings/websiteTools";

/**
 * MER-013 — website tools.
 *
 * Registry-required states: DRAFT, PUBLISHED, INVALID EMBED SETTINGS, DISABLED.
 *
 * The honesty problem this screen has to solve: `/request/[merchantSlug]` does
 * not exist yet — it is PUB-004's contract — so the link a merchant copies
 * here does not resolve. Rather than hide the tools until then, every surface
 * that shows the URL carries an explicit "not live yet" state derived from
 * HOSTED_REQUEST_ROUTE_EXISTS, which a test pins to the filesystem. A merchant
 * can design and publish their button; they are never told it works.
 *
 * The registry constraint (`:407`): "Do not turn Couranr into the merchant's
 * product checkout." The embed is an anchor to a request form, never an
 * iframe or a script, and nothing on this screen mentions a price.
 */

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  disabled: "Disabled",
};

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning"> = {
  draft: "neutral",
  published: "success",
  disabled: "warning",
};

/** Renders the QR as an SVG path string. Client-side; nothing is uploaded. */
function qrSvg(value: string): { svg: string; count: number } {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  let path = "";
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (qr.isDark(r, c)) path += `M${c},${r}h1v1h-1z`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count} ${count}" ` +
    `shape-rendering="crispEdges" width="256" height="256">` +
    `<rect width="${count}" height="${count}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/></svg>`;
  return { svg, count };
}

export function WebsiteTools() {
  const router = useRouter();

  const [accounts, setAccounts] = React.useState<BusinessAccountOption[] | null>(null);
  const [accountsError, setAccountsError] = React.useState<ApiFailure | null>(null);
  const [businessAccountId, setBusinessAccountId] = React.useState("");

  const [view, setView] = React.useState<WebsiteToolsView | null>(null);
  const [viewError, setViewError] = React.useState<ApiFailure | null>(null);

  const [embed, setEmbed] = React.useState<EmbedConfig>({ ...DEFAULT_EMBED });
  const [status, setStatus] = React.useState("draft");
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  /**
   * The origin is only known in the browser. Held in state rather than read
   * during render so the server-rendered HTML and the first client render
   * agree — reading `window` inline would hydrate against different markup.
   */
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

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

  const applyView = React.useCallback((v: WebsiteToolsView) => {
    setView(v);
    setStatus(v.status);
    setEmbed({
      label: v.embed.label,
      color: v.embed.color,
      width: v.embed.width,
      variant: v.embed.variant === "link" ? "link" : "button",
    });
  }, []);

  React.useEffect(() => {
    if (!businessAccountId) return;
    let cancelled = false;
    setView(null);
    setViewError(null);
    fetchWebsiteTools(businessAccountId).then((r) => {
      if (cancelled) return;
      if (isApiFailure(r)) {
        setViewError(r);
        return;
      }
      applyView(r.value);
    });
    return () => {
      cancelled = true;
    };
  }, [businessAccountId, reloadKey, applyView]);

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      // Clipboard can be refused by permission. Say so rather than showing a
      // success state for something that did not happen.
      setCopied(null);
      setSaveError("Your browser did not allow copying. Select the text and copy it manually.");
    }
  }

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
      <LoadingState label="Loading your website tools">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }
  if (accountsError && accountsError.status === 401) {
    return (
      <EmptyState
        title="Sign in to see your website tools"
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
        action={{ label: "Set up your workspace", href: "/business/onboarding" }}
      />
    );
  }

  if (viewError && viewError.status === 403) {
    return (
      <EmptyState
        title="You do not have access to these tools"
        body="Ask an owner or manager of this business if you need access."
      />
    );
  }
  if (viewError) {
    return (
      <ErrorState
        title="Your website tools did not load"
        body={withReference(viewError)}
        action={{ label: "Try again", onClick: () => setReloadKey((k) => k + 1) }}
      />
    );
  }
  if (view === null) {
    return (
      <LoadingState label="Loading your website tools">
        <CardSkeleton lines={4} />
      </LoadingState>
    );
  }

  const mayPublish = memberMay(view.viewer, "website_tools.publish");
  const problems = validateEmbed(embed);
  const url = view.slug && origin ? hostedRequestUrl(origin, view.slug) : "";
  const snippet = url ? embedSnippet(url, embed) : "";
  const qr = url ? qrSvg(url) : null;

  /** Names the ACTION. The server owns which status it produces. */
  async function onSave(action: "publish" | "disable" | "save_draft") {
    setSaving(true);
    setSaveError(null);
    const r = await saveWebsiteTools({
      businessAccountId,
      action,
      embed,
    });
    setSaving(false);
    if (isApiFailure(r)) {
      setSaveError(withReference(r));
      return;
    }
    applyView(r.value);
  }

  function downloadQr() {
    if (!qr) return;
    const blob = new Blob([qr.svg], { type: "image/svg+xml" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `couranr-${view!.slug}-qr.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  return (
    <Stack gap={6}>
      {/*
        The standing truth about this whole screen. Shown regardless of publish
        status, because a merchant who published yesterday still needs to know
        the link does not resolve yet.
      */}
      {!HOSTED_REQUEST_ROUTE_EXISTS ? (
        <Alert tone="info" title="Your link goes live when hosted requests launch">
          You can design and publish your button now. Couranr has not launched
          the customer request page yet, so the link will not open for your
          customers until it does. Couranr will tell you when that happens.
        </Alert>
      ) : null}

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

      {saveError ? <ErrorState title="That could not be saved" body={saveError} /> : null}

      {!mayPublish ? (
        <Alert tone="info" title="You have read-only access">
          Your role can view these tools but not change or publish them.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Your delivery request link"
          actions={
            <Badge tone={STATUS_TONE[status] ?? "neutral"}>
              {STATUS_LABEL[status] ?? status}
              {status === "published" && !HOSTED_REQUEST_ROUTE_EXISTS
                ? " — pending launch"
                : ""}
            </Badge>
          }
        />
        {view.slug ? (
          <Stack gap={3}>
            <Field label="Link" hint="Share this with your customers once it is live.">
              {(p) => <Input {...p} value={url} readOnly />}
            </Field>
            <Cluster gap={2}>
              <Button size="sm" onClick={() => copy(url, "link")}>
                Copy link
              </Button>
              {copied === "link" ? (
                <Text size="sm" muted>
                  Copied.
                </Text>
              ) : null}
            </Cluster>
          </Stack>
        ) : (
          // Honest: the column is nullable and some older accounts have none.
          <Text size="sm" muted>
            This business does not have a Couranr link name yet. Couranr Support
            can set one up.
          </Text>
        )}
      </Card>

      {view.slug ? (
        <Grid columns={2}>
          <Card>
            <CardHeader
              title="QR code"
              description="Print it for your counter, window or receipts."
            />
            <Stack gap={3}>
              {qr ? (
                <div
                  aria-label="QR code for your delivery request link"
                  data-testid="couranr-qr"
                  data-qr-modules={qr.count}
                  dangerouslySetInnerHTML={{ __html: qr.svg }}
                />
              ) : null}
              <div>
                <Button size="sm" onClick={downloadQr}>
                  Download SVG
                </Button>
              </div>
            </Stack>
          </Card>

          <Card>
            <CardHeader
              title="Button for your website"
              description="Paste this where you want the button to appear."
            />
            <Stack gap={3}>
              <Field
                label="Button text"
                required
                error={problems.find((p) => p.field === "label")?.message}
              >
                {(p) => (
                  <Input
                    {...p}
                    value={embed.label}
                    disabled={!mayPublish}
                    onChange={(e) => setEmbed({ ...embed, label: e.target.value })}
                  />
                )}
              </Field>
              <Grid columns={2}>
                <Field
                  label="Colour"
                  required
                  error={problems.find((p) => p.field === "color")?.message}
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={embed.color}
                      disabled={!mayPublish}
                      onChange={(e) => setEmbed({ ...embed, color: e.target.value })}
                    />
                  )}
                </Field>
                <Field
                  label="Width (px)"
                  required
                  error={problems.find((p) => p.field === "width")?.message}
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={String(embed.width)}
                      disabled={!mayPublish}
                      onChange={(e) =>
                        setEmbed({ ...embed, width: Number(e.target.value) })
                      }
                    />
                  )}
                </Field>
              </Grid>
              <Field label="Style" required>
                {(p) => (
                  <Select
                    {...p}
                    value={embed.variant}
                    disabled={!mayPublish}
                    onChange={(e) =>
                      setEmbed({ ...embed, variant: e.target.value as EmbedConfig["variant"] })
                    }
                  >
                    <option value="button">Button</option>
                    <option value="link">Text link</option>
                  </Select>
                )}
              </Field>

              {/* Registry-required state: invalid embed settings. */}
              {problems.length > 0 ? (
                <Alert tone="danger" title="These settings cannot be used yet">
                  <Stack gap={1}>
                    {problems.map((p) => (
                      <Text key={p.field} size="sm">
                        {p.message}
                      </Text>
                    ))}
                  </Stack>
                </Alert>
              ) : null}
            </Stack>
          </Card>
        </Grid>
      ) : null}

      {view.slug && problems.length === 0 ? (
        <Card>
          <CardHeader title="Preview and code" />
          <Stack gap={3}>
            <div>
              <Text size="xs" muted>
                Preview
              </Text>
              <div
                data-testid="couranr-embed-preview"
                dangerouslySetInnerHTML={{ __html: snippet }}
              />
            </div>
            <Field label="Paste this into your site">
              {(p) => <Input {...p} value={snippet} readOnly />}
            </Field>
            <Cluster gap={2}>
              <Button size="sm" onClick={() => copy(snippet, "snippet")}>
                Copy code
              </Button>
              {copied === "snippet" ? (
                <Text size="sm" muted>
                  Copied.
                </Text>
              ) : null}
            </Cluster>
          </Stack>
        </Card>
      ) : null}

      {mayPublish && view.slug ? (
        <Card>
          <CardHeader
            title="Publish"
            description="Publishing saves your design. Disabling hides your link from customers."
          />
          <Cluster gap={3}>
            <Button
              variant="primary"
              loading={saving && status !== "published"}
              disabled={problems.length > 0 || saving || status === "published"}
              onClick={() => onSave("publish")}
            >
              Publish
            </Button>
            {status === "published" ? (
              <Button
                loading={saving}
                disabled={saving}
                onClick={() => onSave("disable")}
              >
                Disable link
              </Button>
            ) : null}
            {status === "disabled" ? (
              <Button loading={saving} disabled={saving} onClick={() => onSave("publish")}>
                Re-enable link
              </Button>
            ) : null}
            <Button
              variant="ghost"
              loading={saving}
              disabled={problems.length > 0 || saving}
              onClick={() => onSave("save_draft")}
            >
              Save as draft
            </Button>
          </Cluster>
        </Card>
      ) : null}

      {/*
        No scan counts, click counts or conversion numbers anywhere. There is
        no attribution storage in the system at all — the analytics schema is
        empty — so any number here would be invented.
      */}
      <Card>
        <CardHeader title="Link performance" />
        <Text size="sm" muted>
          Couranr does not measure scans or clicks on your link yet. When it
          does, the numbers will appear here.
        </Text>
      </Card>
    </Stack>
  );
}
