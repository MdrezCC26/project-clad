import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <s-page heading="ProjectClad">
      <s-section heading="Z-Bars">
        <s-paragraph>
          Open the Z-Bars addon and play the featured animation.
        </s-paragraph>
        <a href="/app/addon" style={{ display: "inline-block" }}>
          <img
            src="/z-bars-button.png"
            alt="Open Z-Bars addon"
            style={{
              width: "220px",
              borderRadius: "18px",
              border: "2px solid #111",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
            }}
          />
        </a>
      </s-section>
      <s-section slot="aside" heading="Quick access">
        <s-paragraph>
          Use the top navigation or button to launch the addon page.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
