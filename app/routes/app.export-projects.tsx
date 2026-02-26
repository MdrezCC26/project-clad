import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getCsvForProjectIds } from "../utils/exportProjectsCsv.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") || "";
  if (!projectId) {
    return new Response("Project is required.", { status: 400 });
  }

  const csv = await getCsvForProjectIds(session.shop, [projectId]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="projectclad-projects.csv"`,
    },
  });
};
