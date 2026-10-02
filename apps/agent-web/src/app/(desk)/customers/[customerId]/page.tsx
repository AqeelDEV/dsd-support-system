import { CustomerView } from "./customer-view";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return <CustomerView customerId={customerId} />;
}
