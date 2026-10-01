import type { ActionFunctionArgs } from "react-router";
import { getAppProxyContext } from "../utils/appProxy.server";
import {
  QUOTE_MAX_TOTAL_FILE_BYTES,
  createQuoteRequest,
  parseQuoteRequestForm,
} from "../utils/quoteRequest.server";

/** Attachments cap plus headroom for the text fields and multipart boundaries. */
const MAX_REQUEST_BYTES = QUOTE_MAX_TOTAL_FILE_BYTES + 2 * 1024 * 1024;

export const loader = () =>
  Response.json({ error: "Method not allowed." }, { status: 405 });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  // Quote requests are public: a valid proxy signature is required, a signed-in customer is not.
  let context: ReturnType<typeof getAppProxyContext>;
  try {
    context = getAppProxyContext(request);
  } catch (thrown) {
    if (thrown instanceof Response) {
      return Response.json(
        { error: "This page has expired. Reload it and send your request again." },
        { status: thrown.status },
      );
    }
    throw thrown;
  }

  if (!/multipart\/form-data/i.test(request.headers.get("Content-Type") || "")) {
    return Response.json({ error: "Unsupported request." }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    return Response.json(
      {
        error: `Attachments total more than ${QUOTE_MAX_TOTAL_FILE_BYTES / 1024 / 1024}MB. Email large drawing sets instead.`,
        fieldErrors: { drawings: "Attachments are too large to send through the form" },
      },
      { status: 413 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Could not read the upload. Try again." }, { status: 400 });
  }

  // Honeypot: pretend success so bots don't retry.
  const honeypot = formData.get("website_url");
  if (typeof honeypot === "string" && honeypot.trim()) {
    return Response.json({ ok: true });
  }

  const parsed = await parseQuoteRequestForm(formData);
  if (!parsed.ok) {
    return Response.json(
      { error: parsed.error, fieldErrors: parsed.fieldErrors },
      { status: 422 },
    );
  }

  try {
    const { reference } = await createQuoteRequest({
      shop: context.shop,
      customerId: context.customerId,
      input: parsed.value,
    });
    return Response.json({ ok: true, reference });
  } catch (error) {
    console.error("[quote-request] save failed:", error);
    return Response.json(
      { error: "We couldn't save your request. Please try again." },
      { status: 500 },
    );
  }
};
