import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AdminOrderQueuePage } from "../components/AdminOrderQueuePage";
import { authenticate } from "../shopify.server";
import { loadAdminOrderQueueJobs } from "../utils/adminOrderQueue.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobs = await loadAdminOrderQueueJobs(session.shop, ["delivered"]);
  return { shop: session.shop, jobs };
};

export default function DeliveredOrdersPage() {
  const { jobs, shop } = useLoaderData<typeof loader>();

  return (
    <AdminOrderQueuePage
      jobs={jobs}
      shop={shop}
      pageHeading="Delivered queue"
      sectionHeading='Delivered (stays here until "Paid")'
      description="Orders with a fulfillment photo or manual Delivered status appear here until marked Paid."
      emptyMessage="No delivered orders."
    />
  );
}
