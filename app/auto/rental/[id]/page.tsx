import RentalDetailClient from "./RentalDetailClient";

export const dynamic = "force-dynamic";

export default function RentalDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <RentalDetailClient rentalId={params.id} />;
}