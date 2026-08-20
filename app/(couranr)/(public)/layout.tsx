import * as React from "react";
import { PublicShell } from "@/components/couranr/shell/shells";
import { PublicNotice } from "@/components/couranr/marketing/PublicNotice";

export default function PublicGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The service-area bar is site chrome above the header in both PUB-001
  // artboards, so it belongs to the group rather than to one page. The shell
  // gives it geometry; this passes the governed copy.
  return <PublicShell notice={<PublicNotice />}>{children}</PublicShell>;
}
