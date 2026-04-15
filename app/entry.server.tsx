import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { applyHostToShopifyAppUrlFromEnv } from "./utils/publicAppOrigin";

applyHostToShopifyAppUrlFromEnv();

export const streamTimeout = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  addDocumentResponseHeaders(request, responseHeaders);

  // App-proxy HTML must not be cached by intermediaries or the browser, or customers
  // keep an old shell (nav, CSS) after deploy until a hard refresh.
  try {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/apps/project-clad")) {
      responseHeaders.set(
        "Cache-Control",
        "private, no-store, no-cache, max-age=0, must-revalidate",
      );
      responseHeaders.set("Pragma", "no-cache");
      /* Shopify / some CDNs honor this in addition to Cache-Control */
      responseHeaders.set("CDN-Cache-Control", "no-store");
      responseHeaders.set("Surrogate-Control", "no-store");
    }
  } catch {
    // ignore malformed request URL
  }

  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
