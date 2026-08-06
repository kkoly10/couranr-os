import * as React from "react";
import { PageHeader } from "@/components/couranr/shell/parts";
import { CustomerBook } from "@/components/couranr/customers/CustomerBook";

export const metadata = { title: "Customers — Couranr" };

/**
 * MER-008 customers list, and MER-009 customer detail at `?customer=`.
 *
 * One route, two states, exactly as the registry declares them.
 *
 * Registry constraint: customer notes are merchant-scoped, and nothing here
 * may imply Couranr owns the customer relationship. The copy says "your
 * customers" throughout, and Couranr never claims to have generated one.
 *
 * `Suspense` is required because the book reads `useSearchParams`.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Customers"
        description="The people you deliver to, and what you have sent them."
      />
      <React.Suspense fallback={null}>
        <CustomerBook />
      </React.Suspense>
    </>
  );
}
