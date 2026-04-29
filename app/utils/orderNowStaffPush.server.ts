import prisma from "../db.server";
import { shopStringFilter } from "./projectAccess.server";

export type OrderNowStaffPushArgs = {
  shop: string;
  projectId: string;
  jobId: string;
};

/**
 * Best-effort staff alerts when a customer uses **Order now** (app proxy, not
 * Checkout). Emails are handled separately; this is for **phone**-style reach:
 *
 * 1) **ntfy** — install [ntfy](https://ntfy.sh) on your phone, create a private topic,
 *    set `PROJECTCLAD_ORDER_NOW_NTFY_TOPIC` to that topic name (or a full `https://…/topic`
 *    if self-hosting). Optional: `PROJECTCLAD_ORDER_NOW_NTFY_TOKEN` and
 *    `PROJECTCLAD_ORDER_NOW_NTFY_SERVER` (default `https://ntfy.sh`).
 * 2) **Webhook** — e.g. Zapier/Make to SMS or another push provider:
 *    `PROJECTCLAD_ORDER_NOW_WEBHOOK_URL` (POST JSON).
 *
 * Fails only log; does not throw (Order now already succeeded).
 */
export async function notifyOrderNowStaff(
  args: OrderNowStaffPushArgs,
): Promise<void> {
  const topic = process.env.PROJECTCLAD_ORDER_NOW_NTFY_TOPIC?.trim();
  const webhookUrl = process.env.PROJECTCLAD_ORDER_NOW_WEBHOOK_URL?.trim();
  if (!topic && !webhookUrl) {
    console.info(
      "[orderNowStaffPush] skip — set PROJECTCLAD_ORDER_NOW_NTFY_TOPIC and/or PROJECTCLAD_ORDER_NOW_WEBHOOK_URL on the host (e.g. Render → Environment).",
    );
    return;
  }

  const job = await prisma.job.findFirst({
    where: {
      id: args.jobId,
      projectId: args.projectId,
      project: { shop: shopStringFilter(args.shop) },
    },
    select: {
      name: true,
      orderNumber: true,
      project: { select: { name: true } },
    },
  });
  if (!job) {
    console.warn("[orderNowStaffPush] job not found; skipping");
    return;
  }

  const projectName = job.project.name;
  const jobName = job.name;
  const num =
    job.orderNumber != null ? ` #${job.orderNumber}` : "";
  const projectUrl = `https://${args.shop}/apps/project-clad/project?id=${encodeURIComponent(args.projectId)}&job=${encodeURIComponent(args.jobId)}`;
  const title = `Order${num} · ${jobName}`;
  const text = [
    `Project: ${projectName}`,
    `Order: ${jobName}${num ? ` (#${job.orderNumber})` : ""}`,
    projectUrl,
  ].join("\n");

  console.info(
    "[orderNowStaffPush] sending",
    JSON.stringify({
      ntfy: Boolean(topic),
      webhook: Boolean(webhookUrl),
      jobId: args.jobId,
    }),
  );

  const ntfyPromise = topic
    ? postToNtfy({ topic, title, text, clickUrl: projectUrl })
    : Promise.resolve();
  const hookPromise = webhookUrl
    ? postToWebhook({
        url: webhookUrl,
        payload: {
          event: "order_now",
          shop: args.shop,
          projectId: args.projectId,
          jobId: args.jobId,
          projectName,
          jobName,
          orderNumber: job.orderNumber,
          projectUrl,
        },
      })
    : Promise.resolve();

  await Promise.allSettled([ntfyPromise, hookPromise]);
}

/**
 * Uses ntfy JSON publish: `POST {server}/` with `{"topic","message","title",...}`.
 * See https://docs.ntfy.sh/publish/ — more reliable than path-only POSTs.
 */
async function postToNtfy(args: {
  topic: string;
  title: string;
  text: string;
  clickUrl: string;
}) {
  const { title, text, clickUrl } = args;
  const { publishUrl, topicName } = resolveNtfyTopic(args.topic);
  if (!topicName) {
    console.error(
      "[orderNowStaffPush] ntfy: empty topic — set PROJECTCLAD_ORDER_NOW_NTFY_TOPIC to e.g. my-secret-topic or https://ntfy.sh/my-secret-topic",
    );
    return;
  }
  const token = process.env.PROJECTCLAD_ORDER_NOW_NTFY_TOKEN?.trim();

  const body = JSON.stringify({
    topic: topicName,
    title,
    message: text,
    /** 5 = max — best chance of a visible alert on Android; iOS still obeys Focus/DND. */
    priority: 5,
    click: clickUrl,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(publishUrl, {
      method: "POST",
      headers,
      body,
      signal: ac.signal,
    });
    const bodyText = await res.text().catch(() => "");
    if (res.ok) {
      console.info("[orderNowStaffPush] ntfy ok", res.status);
    } else {
      console.error("[orderNowStaffPush] ntfy failed:", res.status, bodyText);
      if (res.status === 401 || res.status === 403) {
        console.error(
          "[orderNowStaffPush] hint: for protected topics, set PROJECTCLAD_ORDER_NOW_NTFY_TOKEN to a valid ntfy access token; remove the token if the topic is public.",
        );
      }
    }
  } catch (e) {
    console.error(
      "[orderNowStaffPush] ntfy request failed:",
      e instanceof Error ? e.message : e,
    );
  } finally {
    clearTimeout(t);
  }
}

/**
 * `PROJECTCLAD_ORDER_NOW_NTFY_TOPIC` can be a short name (`my-secret-topic`) or a full
 * `https://ntfy.sh/my-secret-topic` URL; optional `PROJECTCLAD_ORDER_NOW_NTFY_SERVER`
 * still applies when the topic is a name only.
 */
function resolveNtfyTopic(raw: string): { publishUrl: string; topicName: string } {
  const t = raw.trim();
  if (t.startsWith("https://") || t.startsWith("http://")) {
    try {
      const u = new URL(t);
      const segments = u.pathname.split("/").filter(Boolean);
      const topicName = segments.pop() ?? "";
      const base = u.origin;
      return { publishUrl: `${base}/`, topicName };
    } catch {
      /* fall through */
    }
  }
  const server = (
    process.env.PROJECTCLAD_ORDER_NOW_NTFY_SERVER?.trim() || "https://ntfy.sh"
  ).replace(/\/$/, "");
  return { publishUrl: `${server}/`, topicName: t };
}

async function postToWebhook(args: {
  url: string;
  payload: Record<string, unknown>;
}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(args.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args.payload),
      signal: ac.signal,
    });
    if (res.ok) {
      console.info("[orderNowStaffPush] webhook ok", res.status);
    } else {
      console.error(
        "[orderNowStaffPush] webhook failed:",
        res.status,
        await res.text().catch(() => ""),
      );
    }
  } catch (e) {
    console.error(
      "[orderNowStaffPush] webhook request failed:",
      e instanceof Error ? e.message : e,
    );
  } finally {
    clearTimeout(t);
  }
}
