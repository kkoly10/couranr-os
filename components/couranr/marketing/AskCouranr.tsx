"use client";

import * as React from "react";
import Link from "next/link";
import { Button, Card, Heading, Stack, Text } from "@/components/couranr/primitives";
import { SUPPORT_COPY } from "@/lib/couranr/public/governed";

/**
 * The "Ask Couranr" launcher — PUB-001 required state "assistant closed/open".
 *
 * HONEST BY CONSTRUCTION. The Ask Couranr assistant is B10/Phase 9 work
 * (P9-004) and does not exist; AIS-001 forbids AI deciding anything priced or
 * stateful, and the execution spec's AI-PROVIDER row mandates a disabled/
 * manual fallback. So the OPEN state is a real panel that says exactly what is
 * true — questions reach Couranr Support during operating hours — and offers
 * the real navigation paths. NO fake chat input, no fabricated responses, no
 * pretend typing indicator.
 */
export function AskCouranrLauncher() {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="cr-askc" data-open={open ? "true" : "false"}>
      {open ? (
        <Card elevation="raised" className="cr-askc__panel">
          <Stack gap={3}>
            <Heading level={2}>Ask Couranr</Heading>
            <Text muted size="sm">
              The Ask Couranr assistant is not live yet. {SUPPORT_COPY}
            </Text>
            <Stack gap={2}>
              <Link href="/how-it-works" className="cr-button cr-button--secondary cr-button--sm">
                How Couranr works
              </Link>
              <Link href="/pricing" className="cr-button cr-button--secondary cr-button--sm">
                See delivery pricing
              </Link>
              <Link href="/sign-up" className="cr-button cr-button--primary cr-button--sm">
                Create a business account
              </Link>
            </Stack>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </Stack>
        </Card>
      ) : null}
      <button
        type="button"
        className="cr-askc__pill"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Ask Couranr
      </button>
    </div>
  );
}
