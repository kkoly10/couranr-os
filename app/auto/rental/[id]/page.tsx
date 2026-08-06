import RentalDetailClient from "./RentalDetailClient";

export const dynamic = "force-dynamic";

export default async function RentalDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  return <RentalDetailClient rentalId={params.id} />;
}