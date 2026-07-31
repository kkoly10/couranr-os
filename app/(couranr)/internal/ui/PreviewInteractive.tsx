"use client";

import * as React from "react";
import {
  Button,
  Card,
  CardHeader,
  Cluster,
  Stack,
  Text,
} from "@/components/couranr/primitives";
import {
  ConfirmDialog,
  Dialog,
  Drawer,
  Menu,
  Tabs,
} from "@/components/couranr/interactive";

/**
 * Client-side half of the internal preview: the primitives that carry state.
 * Kept separate so the preview page itself stays a server component.
 */
export function PreviewInteractive() {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  return (
    <Card>
      <CardHeader
        title="Interactive primitives"
        description="Keyboard navigation, focus trapping and Escape-to-close are implemented directly (§7)."
      />

      <Stack gap={6}>
        <Tabs
          label="Delivery detail sections"
          items={[
            {
              id: "summary",
              label: "Summary",
              content: (
                <Text size="sm" muted>
                  Arrow keys move between tabs, Home and End jump to the ends,
                  and only the selected tab is in the tab sequence.
                </Text>
              ),
            },
            {
              id: "proof",
              label: "Proof",
              content: (
                <Text size="sm" muted>
                  Proof states: pending capture, pending sync, verified, failed,
                  unavailable to viewer.
                </Text>
              ),
            },
            {
              id: "activity",
              label: "Activity",
              content: (
                <Text size="sm" muted>
                  Every state transition is recorded as a named server command.
                </Text>
              ),
            },
          ]}
        />

        <Cluster gap={3}>
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </Button>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            Destructive confirm
          </Button>
          <Menu
            label="Delivery actions"
            trigger="Actions"
            items={[
              { label: "View proof" },
              { label: "Message Couranr Support" },
              { label: "Cancel delivery", destructive: true },
            ]}
          />
        </Cluster>
      </Stack>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Revised quote"
        description="Couranr reviewed this request and adjusted the distance."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Close
            </Button>
            <Button variant="primary" onClick={() => setDialogOpen(false)}>
              Approve
            </Button>
          </>
        }
      >
        <Text size="sm">
          Focus is trapped inside this dialog, Escape closes it, and focus
          returns to the button that opened it.
        </Text>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        destructive
        title="Cancel this delivery?"
        confirmLabel="Cancel delivery"
        consequence="The driver will be unassigned and the customer will be notified. This cannot be undone from this screen."
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Delivery detail"
      >
        <Text size="sm" muted>
          Drawers use the same focus behaviour as dialogs.
        </Text>
      </Drawer>
    </Card>
  );
}
