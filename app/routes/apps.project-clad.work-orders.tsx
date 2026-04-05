import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { getThemeStyles } from "../utils/themeAssets.server";
import { PROJECT_CLAD_CURSOR_GLOW_SCRIPT } from "../utils/projectCladCursorGlowScript";
import { rewriteProjectCladProxyFontUrls } from "../utils/projectCladProxyStyles.server";

/**
 * Work orders are managed from the embedded Shopify admin app (staff), not the storefront.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const proxyStylesCss = rewriteProjectCladProxyFontUrls(request);
  const { shop } = requireAppProxyCustomer(request);
  const themeStyles = await getThemeStyles(shop);
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
  });
  return {
    proxyStylesCss,
    themeStyles,
    backgroundLogoDataUrl: settings?.backgroundLogoDataUrl || null,
    logoDataUrl: settings?.logoDataUrl || null,
  };
};

export const links: LinksFunction = ({ data }) => {
  const hrefs = data?.themeStyles?.urls || [];
  return [...hrefs.map((href) => ({ rel: "stylesheet", href }))];
};

export default function StorefrontWorkOrdersInfo() {
  const data = useLoaderData<typeof loader>();
  const inlineStyles = data.themeStyles?.styles || [];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: data.proxyStylesCss }} />
      {inlineStyles.map((css, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      <main
        className={`project-clad-page project-clad-page--projects${data.backgroundLogoDataUrl ? " project-clad-page--card-bg-logo" : ""}`}
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
      <script
        dangerouslySetInnerHTML={{ __html: PROJECT_CLAD_CURSOR_GLOW_SCRIPT }}
      />
    </>
  );
}
