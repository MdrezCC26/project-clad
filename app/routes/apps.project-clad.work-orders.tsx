import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { getThemeStyles } from "../utils/themeAssets.server";
import proxyStylesText from "../styles/project-clad-proxy.css?raw";

/**
 * Work orders are managed from the embedded Shopify admin app (staff), not the storefront.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = requireAppProxyCustomer(request);
  const themeStyles = await getThemeStyles(shop);
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
  });
  return {
    themeStyles,
    storefrontTheme: settings?.storefrontTheme || "default",
    backgroundLogoDataUrl: settings?.backgroundLogoDataUrl || null,
    logoDataUrl: settings?.logoDataUrl || null,
  };
};

export default function StorefrontWorkOrdersInfo() {
  const data = useLoaderData<typeof loader>();
  const inlineStyles = data.themeStyles?.styles || [];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: proxyStylesText }} />
      {inlineStyles.map((css, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      <main
        className={`project-clad-page project-clad-page--projects${data.backgroundLogoDataUrl ? " project-clad-page--card-bg-logo" : ""}`}
        data-theme={data.storefrontTheme || "default"}
        style={
          data.backgroundLogoDataUrl
            ? {
                ["--project-clad-bg-logo" as string]: `url(${data.backgroundLogoDataUrl})`,
              }
            : undefined
        }
      >
        <div className="page-width project-clad-container project-clad-container--full-width">
          {data.logoDataUrl ? (
            <div className="project-clad-logo">
              <a href="/apps/project-clad/projects" className="project-clad-logo__link">
                <img
                  src={data.logoDataUrl}
                  alt="Logo"
                  className="project-clad-logo__img"
                />
              </a>
            </div>
          ) : null}
          <header className="project-clad-header">
            <h1 className="main-page-title page-title">Work orders</h1>
            <p className="project-clad-muted">
              Work orders are managed in <strong>Shopify Admin</strong>: open the{" "}
              <strong>ProjectClad</strong> app, then use <strong>Work orders</strong> in the app
              navigation.
            </p>
            <p style={{ marginTop: "1rem" }}>
              <a className="project-clad-button" href="/apps/project-clad/projects">
                Back to projects
              </a>
            </p>
          </header>
        </div>
      </main>
    </>
  );
}
