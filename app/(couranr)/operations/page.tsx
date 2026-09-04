import Link from "next/link";
import { OperationsPilotDashboard } from "@/components/couranr/operations/OperationsPilotDashboard";
import { Cluster, buttonClassName } from "@/components/couranr/primitives";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Operations — Couranr" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Operations"
        description="Live delivery work, payment attention and dispatch — ordered by what needs you now."
        actions={
          <Cluster gap={2}>
            <Link
              href="/operations/deliveries/new"
              className={buttonClassName({ variant: "primary" })}
            >
              New business delivery
            </Link>
            <Link
              href="/operations/queue"
              className={buttonClassName({ variant: "secondary" })}
            >
              Open queue
            </Link>
          </Cluster>
        }
      />
      <OperationsPilotDashboard />
    </>
  );
}
