import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  buildStorefrontCustomerLoginUrl,
  getAppProxyContext,
} from "../utils/appProxy.server";
import { loadShapeStorefrontChrome } from "../utils/shapeStorefrontPage.server";
import { shapeBuilderIslandSrc } from "../utils/shapeBuilderIsland.server";
import { profileFromSearchParams } from "../utils/shapeProfile";
import { ShapeStorefrontShell } from "../components/ShapeStorefrontShell";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId, customerEmail, returnPath } =
    getAppProxyContext(request);
  const chrome = await loadShapeStorefrontChrome({
    request,
    shop,
    customerId,
    customerEmail,
  });
  const url = new URL(request.url);
  const parsed = profileFromSearchParams(url.searchParams);
  const islandSrc = shapeBuilderIslandSrc(request);
  return {
    ...chrome,
    islandSrc,
    initialLegs: parsed.legs,
    initialGauge: parsed.gauge,
    initialColor: parsed.color,
    loginUrl: customerId ? null : buildStorefrontCustomerLoginUrl(returnPath),
  };
};

export default function ShapeBuilderPage() {
  const data = useLoaderData<typeof loader>();
  const config = {
    initialLegs: data.initialLegs,
    initialGauge: data.initialGauge,
    initialColor: data.initialColor,
    libraryUrl: "/apps/project-clad/api/shape-library",
    libraryHref: "/apps/project-clad/shape-library",
    cartUrl: "/apps/project-clad/api/shape-cart",
    cartHref: "/apps/project-clad/shape-cart",
    loginUrl: data.loginUrl,
  };

  return (
    <ShapeStorefrontShell
      active="builder"
      title="Custom shape builder"
      subtitle="Draw the profile, then add it to your cart. Price is calculated from gauge, girth, length, and bends when the part lands in the cart."
      proxyStylesHref={data.proxyStylesHref}
      themeStyles={data.themeStyles}
      storefrontAppNav={data.storefrontAppNav}
      logoUrl={data.logoUrl}
      backgroundLogoUrl={data.backgroundLogoUrl}
      navAccountInitial={data.navAccountInitial}
      navAccountFirstName={data.navAccountFirstName}
      shapeCartCount={data.shapeCartCount}
      extraScripts={<script src={data.islandSrc} defer />}
    >
      <div
        id="pc-shape-builder-root"
        className="pc-shape-builder-mount"
        data-config={JSON.stringify(config)}
      >
        <p className="pc-shape-builder-pending">Loading the shape builder…</p>
      </div>
    </ShapeStorefrontShell>
  );
}
