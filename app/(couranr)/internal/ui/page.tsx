import { notFound } from "next/navigation";
import { isPreviewEnabled } from "@/lib/couranr/previewGate";
import {
  CANONICAL_SCREENS,
  implementationProgress,
  screensByGroup,
  type ScreenGroup,
} from "@/lib/couranr/screens";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardFooter,
  CardHeader,
  Cluster,
  Container,
  Divider,
  Grid,
  Heading,
  Stack,
  Table,
  TableScroll,
  Text,
} from "@/components/couranr/primitives";
import { CheckboxRow, Field, Input, Select, Textarea } from "@/components/couranr/forms";
import {
  CardSkeleton,
  ConflictState,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  PermissionDeniedState,
  SuccessState,
  TableSkeleton,
} from "@/components/couranr/states";
import { PreviewInteractive } from "./PreviewInteractive";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Couranr UI foundation (internal)",
  robots: { index: false, follow: false },
};

const GROUPS: ScreenGroup[] = [
  "public",
  "merchant",
  "driver",
  "operations",
  "customer",
];

export default function UiPreviewPage() {
  if (!isPreviewEnabled()) notFound();

  const progress = implementationProgress();

  return (
    <Container>
      <div style={{ paddingBlock: "var(--couranr-space-10)" }}>
        <Stack gap={8}>
          <header>
            <Stack gap={2}>
              <Badge tone="warning">Internal preview — not a public route</Badge>
              <Heading level={1}>Couranr design foundation</Heading>
              <Text muted>
                Primitives, states and tokens defined by UI_SCREEN_REGISTRY.md
                §2, §6 and §7. Every token is <code>--couranr-*</code> and every
                rule is scoped under <code>.cr-root</code>, so legacy pages are
                untouched.
              </Text>
            </Stack>
          </header>

          {/* ---------------------------------------------- Screen registry */}
          <Card>
            <CardHeader
              title="Canonical screen registry"
              description={`${progress.implemented} of ${progress.total} screens implemented — ${progress.coreImplemented}/${progress.coreTotal} Core`}
            />
            <Grid columns={3}>
              {GROUPS.map((g) => {
                const screens = screensByGroup(g);
                const done = screens.filter((s) => s.implemented).length;
                return (
                  <Card key={g} elevation="quiet">
                    <Stack gap={2}>
                      <Text strong style={{ textTransform: "capitalize" }}>
                        {g}
                      </Text>
                      <Text size="sm" muted numeric>
                        {done} / {screens.length} implemented
                      </Text>
                      <Text size="xs" muted>
                        {screens.slice(0, 3).map((s) => s.id).join(", ")}
                        {screens.length > 3 ? ` +${screens.length - 3} more` : ""}
                      </Text>
                    </Stack>
                  </Card>
                );
              })}
            </Grid>
          </Card>

          {/* ------------------------------------------------------ Buttons */}
          <Card>
            <CardHeader
              title="Buttons"
              description="46–52px desktop height, ≥44px touch target, clear hierarchy (§2)."
            />
            <Stack gap={4}>
              <Cluster gap={3}>
                <Button variant="primary">Primary action</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
              </Cluster>
              <Cluster gap={3}>
                <Button variant="primary" size="sm">
                  Small
                </Button>
                <Button variant="primary" disabled>
                  Disabled
                </Button>
                <Button variant="primary" loading>
                  Saving
                </Button>
              </Cluster>
            </Stack>
          </Card>

          {/* -------------------------------------------------------- Forms */}
          <Card>
            <CardHeader
              title="Form fields"
              description="Inline validation with field-level recovery; errors are wired with aria-describedby and never rely on a toast alone (§6)."
            />
            <Grid columns={2}>
              <Field label="Pickup address" required hint="Street, city and ZIP.">
                {(p) => <Input placeholder="123 Main St" {...p} />}
              </Field>

              <Field
                label="Recipient phone"
                required
                error="Enter a 10-digit phone number."
              >
                {(p) => <Input defaultValue="555" {...p} />}
              </Field>

              <Field label="Vehicle" required>
                {(p) => (
                  <Select defaultValue="" {...p}>
                    <option value="" disabled>
                      Select a vehicle
                    </option>
                    <option value="car">Car</option>
                    <option value="van">Van</option>
                  </Select>
                )}
              </Field>

              <Field label="Delivery notes" hint="Visible to the driver.">
                {(p) => <Textarea rows={3} {...p} />}
              </Field>
            </Grid>
            <CardFooter>
              <CheckboxRow
                label="Signature required"
                hint="Adds a signature step to drop-off proof."
              />
            </CardFooter>
          </Card>

          {/* ----------------------------------------------- Badges, alerts */}
          <Grid columns={2}>
            <Card>
              <CardHeader
                title="Badges"
                description="Colour is never the only cue — each carries a label and a shape (§7)."
              />
              <Cluster gap={2}>
                <Badge tone="neutral">Draft</Badge>
                <Badge tone="info">In transit</Badge>
                <Badge tone="success">Delivered</Badge>
                <Badge tone="warning">Needs review</Badge>
                <Badge tone="danger">Failed</Badge>
              </Cluster>
            </Card>

            <Card>
              <CardHeader title="Alerts" />
              <Stack gap={3}>
                <Alert tone="info" title="Estimate only">
                  All time windows and ETAs are estimates. Couranr confirms
                  availability before capture.
                </Alert>
                <Alert tone="danger" title="Payment failed">
                  The card was declined. No delivery was scheduled.
                </Alert>
              </Stack>
            </Card>
          </Grid>

          {/* -------------------------------------------------------- Table */}
          <Card padding="flush">
            <div style={{ padding: "var(--couranr-card-padding)", paddingBottom: 0 }}>
              <CardHeader
                title="Table"
                description="Scrolls inside its own container; the page never scrolls horizontally (§7)."
              />
            </div>
            <TableScroll>
              <Table numeric caption="Recent deliveries">
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Recipient</th>
                    <th scope="col">Status</th>
                    <th scope="col">Miles</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>CR-1042</td>
                    <td>Sample recipient</td>
                    <td>
                      <Badge tone="info">In transit</Badge>
                    </td>
                    <td>4.2</td>
                  </tr>
                  <tr>
                    <td>CR-1041</td>
                    <td>Sample recipient</td>
                    <td>
                      <Badge tone="success">Delivered</Badge>
                    </td>
                    <td>1.8</td>
                  </tr>
                </tbody>
              </Table>
            </TableScroll>
          </Card>

          {/* ------------------------------------- Interactive (client-side) */}
          <PreviewInteractive />

          {/* ------------------------------------------------------- States */}
          <Card>
            <CardHeader
              title="Required states"
              description="Every applicable screen must implement these (§6)."
            />
            <Stack gap={6}>
              <div>
                <Text size="sm" strong>
                  Loading — preserves structure, flashes no unauthorized data
                </Text>
                <div style={{ marginTop: 12 }}>
                  <LoadingState>
                    <Grid columns={2}>
                      <CardSkeleton />
                      <TableSkeleton rows={3} columns={3} />
                    </Grid>
                  </LoadingState>
                </div>
              </div>

              <Divider />

              <Grid columns={2}>
                <Card elevation="quiet">
                  <EmptyState
                    title="No deliveries yet"
                    body="Create your first delivery and it will appear here."
                    action={{ label: "Create delivery" }}
                  />
                </Card>
                <Card elevation="quiet">
                  <ErrorState action={{ label: "Try again" }} />
                </Card>
                <Card elevation="quiet">
                  <SuccessState
                    title="Delivery scheduled"
                    body="Couranr confirmed availability and the merchant has been notified."
                  />
                </Card>
                <Card elevation="quiet">
                  <PermissionDeniedState />
                </Card>
                <Card elevation="quiet">
                  <ConflictState action={{ label: "Reload" }} />
                </Card>
                <Card elevation="quiet">
                  <OfflineState />
                </Card>
              </Grid>
            </Stack>
          </Card>

          {/* -------------------------------------------------------- Tokens */}
          <Card>
            <CardHeader title="Tokens" description="UI_SCREEN_REGISTRY.md §2." />
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Token</th>
                    <th scope="col">Value</th>
                    <th scope="col">Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["--couranr-navy", "#0D1525"],
                    ["--couranr-gold", "#F4B740"],
                    ["--couranr-route-blue", "#2563EB"],
                    ["--couranr-canvas", "#F7F8F5"],
                    ["--couranr-surface", "#FFFFFF"],
                    ["--couranr-border", "#E3E7ED"],
                    ["--couranr-text-muted", "#667085"],
                    ["--couranr-success", "#15803D"],
                  ].map(([token, value]) => (
                    <tr key={token}>
                      <td>
                        <code>{token}</code>
                      </td>
                      <td>{value}</td>
                      <td>
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: 44,
                            height: 22,
                            borderRadius: 6,
                            border: "1px solid var(--couranr-border)",
                            background: `var(${token})`,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>

          <Text size="xs" muted>
            {CANONICAL_SCREENS.length} canonical screens registered.
          </Text>
        </Stack>
      </div>
    </Container>
  );
}
