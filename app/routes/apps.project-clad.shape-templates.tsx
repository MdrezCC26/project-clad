import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getAppProxyContext } from "../utils/appProxy.server";
import { loadShapeStorefrontChrome } from "../utils/shapeStorefrontPage.server";
import { listShapeTemplates } from "../utils/shapeLibrary.server";
import {
  formatLength,
  girthOf,
  profileToSvg,
  shapeBuilderPath,
} from "../utils/shapeProfile";
import {
  ShapeProfileCard,
  ShapeStorefrontShell,
} from "../components/ShapeStorefrontShell";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId, customerEmail } = getAppProxyContext(request);
  const [chrome, templates] = await Promise.all([
    loadShapeStorefrontChrome({ request, shop, customerId, customerEmail }),
    listShapeTemplates(shop),
  ]);
  return { ...chrome, templates };
};

export default function ShapeTemplatesPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <ShapeStorefrontShell
      active="templates"
      title="Shape templates"
      subtitle="Start from an L, Z, U, C, or S. Selecting a card opens the builder with those lengths already set."
      proxyStylesHref={data.proxyStylesHref}
      themeStyles={data.themeStyles}
      storefrontAppNav={data.storefrontAppNav}
      logoUrl={data.logoUrl}
      backgroundLogoUrl={data.backgroundLogoUrl}
      navAccountInitial={data.navAccountInitial}
      navAccountFirstName={data.navAccountFirstName}
      shapeCartCount={data.shapeCartCount}
    >
      <div className="pc-shape-grid">
        {data.templates.map((t) => (
          <ShapeProfileCard
            key={t.id}
            href={shapeBuilderPath({ legs: t.legs })}
            name={t.name}
            svg={profileToSvg(t.legs, 280)}
            meta={`${t.legs.map((l, i) => `L${i + 1} ${formatLength(l.length)}"`).join(" · ")} · ${formatLength(girthOf(t.legs))}" girth`}
          />
        ))}
      </div>
    </ShapeStorefrontShell>
  );
}
