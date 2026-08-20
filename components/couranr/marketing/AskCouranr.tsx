"use client";

import * as React from "react";
import Link from "next/link";
import { Button, Card, Heading, Stack, Text } from "@/components/couranr/primitives";
import { IconChat } from "./MarketingIcons";
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
 *
 * THE TRIGGER IS A CIRCULAR ICON BUTTON BELOW 768px. Both the artboard and the
 * desktop implementation use a labelled pill, and the mobile artboard keeps the
 * label — but an artboard is a static composition and cannot show what a fixed
 * 145px-wide pill does in a live 390px viewport: it lands on top of the hero's
 * primary CTA and covers the end of its label. A floating launcher that
 * occludes a call to action is a functional defect the mock could not depict.
 * The label survives as the button's accessible name, so nothing is lost to
 * assistive technology, and the icon is the chat glyph the artboard's own pill
 * carries.
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
        <span className="cr-askc__icon" aria-hidden="true">
          <IconChat />
        </span>
        <span className="cr-askc__label">Ask Couranr</span>
      </button>
    </div>
  );
}
