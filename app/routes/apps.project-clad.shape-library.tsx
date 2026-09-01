import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getAppProxyContext,
  requireAppProxyCustomer,
} from "../utils/appProxy.server";
import { loadShapeStorefrontChrome } from "../utils/shapeStorefrontPage.server";
import {
  deleteShapeLibraryEntry,
  listShapeLibrary,
} from "../utils/shapeLibrary.server";
import {
  formatLength,
  profileToSvg,
  shapeBuilderPath,
} from "../utils/shapeProfile";
import {
  ShapeProfileCard,
  ShapeStorefrontShell,
} from "../components/ShapeStorefrontShell";
import { requireShapeCalculatorEnabled } from "../utils/shapeFeature";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, customerId, customerEmail } = getAppProxyContext(request);
  const [chrome, entries] = await Promise.all([
    loadShapeStorefrontChrome({ request, shop, customerId, customerEmail }),
    listShapeLibrary(shop),
  ]);
  return {
    ...chrome,
    entries,
    canDelete: Boolean(customerId),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  requireShapeCalculatorEnabled();
  const { shop } = requireAppProxyCustomer(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  if (intent !== "delete-profile") {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }
  const id = String(form.get("id") || "");
  await deleteShapeLibraryEntry(shop, id);
  // Storefront path (not `/shape-library`) so the browser stays on the app proxy.
  return redirect("/apps/project-clad/shape-library");
};

export default function ShapeLibraryPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <ShapeStorefrontShell
      active="library"
      title="Profile library"
      subtitle="Every saved custom profile, available to everyone. Open one to load it in the builder and save a new copy, or delete ones you no longer need."
      proxyStylesHref={data.proxyStylesHref}
      themeStyles={data.themeStyles}
      storefrontAppNav={data.storefrontAppNav}
      logoUrl={data.logoUrl}
      backgroundLogoUrl={data.backgroundLogoUrl}
      navAccountInitial={data.navAccountInitial}
      navAccountFirstName={data.navAccountFirstName}
      shapeCartCount={data.shapeCartCount}
    >
      {data.entries.length === 0 ? (
        <p className="project-clad-muted">
          No saved profiles yet. Build a shape and add it to the cart — it will show up here.
        </p>
      ) : (
        <div className="pc-shape-grid">
          {data.entries.map((entry) => (
            <ShapeProfileCard
              key={entry.id}
              href={shapeBuilderPath({
                legs: entry.legs,
                gauge: entry.gauge || undefined,
                color: entry.color || undefined,
              })}
              name={`${formatLength(entry.girth)}" girth`}
              svg={profileToSvg(entry.legs, 280)}
              meta={[
                entry.gauge ? `${entry.gauge}ga` : null,
                entry.color,
                `${entry.legs.length} lengths`,
                entry.useCount > 1 ? `used ${entry.useCount}×` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              deleteSlot={
                data.canDelete ? (
                  <form
                    method="post"
                    action="/apps/project-clad/shape-library"
                    className="pc-shape-card__delete"
                    onSubmit={(event) => {
                      if (
                        !window.confirm(
                          "Delete this profile from the library? This cannot be undone.",
                        )
                      ) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="intent" value="delete-profile" />
                    <input type="hidden" name="id" value={entry.id} />
                    <button type="submit">Delete</button>
                  </form>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </ShapeStorefrontShell>
  );
}
