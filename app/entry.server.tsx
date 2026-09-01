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

  // App-proxy HTML must never be served from an intermediary, and the browser must
  // revalidate before reusing it, or customers keep an old shell (nav, CSS) after
  // deploy until a hard refresh.
  try {
    const url = new URL(request.url);

    /* TEMPORARY DIAGNOSTIC — delete once the Render log has been read.
       Establishes whether the app proxy strips the /apps/project-clad prefix before
       forwarding. That decides whether the no-store branch below ever runs, and
       whether the nested-detail check in apps.project-clad.projects.tsx can match.
       Param names only, never values: the proxy passes logged_in_customer_email. */
    console.log(
      "[pc-probe]",
      url.pathname,
      `prefixMatch=${url.pathname.startsWith("/apps/project-clad")}`,
      `params=${Array.from(url.searchParams.keys()).sort().join("|")}`,
    );

    if (url.pathname.startsWith("/apps/project-clad")) {
      /* Deliberately no-cache and NOT no-store. Both force revalidation before the
         browser may reuse a response, so either one prevents the stale shell. But
         no-store also disqualifies the page from the back/forward cache, which turned
         every back press into a full network refetch — a flash, a lost scroll position
         and a wait. Staleness on a restored page is handled instead by the mutation
         stamp in pc-dirty-guard.js, which refreshes on back only when something
         actually changed. Do not add no-store back. */
      responseHeaders.set(
        "Cache-Control",
        "private, no-cache, max-age=0, must-revalidate",
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
