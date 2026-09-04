import Link from "next/link";
import { OperationsPilotDashboard } from "@/components/couranr/operations/OperationsPilotDashboard";
import { buttonClassName } from "@/components/couranr/primitives";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Operations — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Operations"
        description="Live delivery work, payment attention and dispatch — ordered by what needs you now."
        actions={
          <Link
            href="/operations/queue"
            className={buttonClassName({ variant: "secondary" })}
          >
            Open queue
          </Link>
        }
      />
      <OperationsPilotDashboard />
    </>
  );
}
