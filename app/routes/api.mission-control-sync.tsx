import type { LoaderFunctionArgs } from "react-router";
import {
  exportMissionControlSync,
  verifyMissionControlIngestKey,
} from "../utils/missionControl.server";

/**
 * Mission Control pull sync — LAN ops dashboard polls this endpoint because
 * production Project Clad cannot push to localhost.
 *
 * GET /api/mission-control-sync?shop=rnc2a0-d3.myshopify.com
 *   &since=2026-06-02T10:00:00.000Z   (optional incremental)
 *   &full=1                           (optional full export + prune list)
 *
 * Auth: `x-mc-ingest-key` must match MISSION_CONTROL_INGEST_KEY on this host.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!verifyMissionControlIngestKey(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const shop = (url.searchParams.get("shop") || "").trim();
  if (!shop) {
    return Response.json({ error: "Missing shop" }, { status: 400 });
  }

  const full = url.searchParams.get("full") === "1";
  const sinceRaw = (url.searchParams.get("since") || "").trim();
  let since: Date | null = null;
  if (!full && sinceRaw) {
    const parsed = new Date(sinceRaw);
    if (Number.isNaN(parsed.getTime())) {
      return Response.json({ error: "Invalid since" }, { status: 400 });
    }
    since = parsed;
  }

  const payload = await exportMissionControlSync({ shop, since, full });
  return Response.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
};
