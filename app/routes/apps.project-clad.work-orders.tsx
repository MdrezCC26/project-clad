import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { getCustomersByIds } from "../utils/adminCustomers.server";
import { normalizeStorefrontCustomerId } from "../utils/customerTags.server";
import { requireAppProxyCustomer } from "../utils/appProxy.server";
import { getThemeStyles } from "../utils/themeAssets.server";
import { PROJECT_CLAD_CURSOR_GLOW_SCRIPT } from "../utils/projectCladCursorGlowScript";
import { rewriteProjectCladProxyFontUrls } from "../utils/projectCladProxyStyles.server";
import { ProjectCladStorefrontFooter } from "../components/ProjectCladStorefrontFooter";
import { ProjectCladStorefrontNav } from "../components/ProjectCladStorefrontNav";
import { getStorefrontAppNav } from "../utils/storefrontAppNav";

/**
 * Work orders are managed from the embedded Shopify admin app (staff), not the storefront.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const proxyStylesCss = rewriteProjectCladProxyFontUrls(request);
  const { shop, customerId, customerEmail } = requireAppProxyCustomer(request);
  const themeStyles = await getThemeStyles(shop);
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
  });
  let navAccountInitial: string | null = null;
  try {
    const numericId = normalizeStorefrontCustomerId(customerId);
    const customerInfo = await getCustomersByIds(shop, [numericId]);
    const viewer = customerInfo[numericId] ?? customerInfo[customerId];
    const fn = viewer?.firstName?.trim();
    navAccountInitial = fn
      ? fn.charAt(0).toUpperCase()
      : customerEmail?.trim()
        ? customerEmail.trim().charAt(0).toUpperCase()
        : null;
  } catch {
    navAccountInitial = customerEmail?.trim()
      ? customerEmail.trim().charAt(0).toUpperCase()
      : null;
  }
  return {
    proxyStylesCss,
    themeStyles,
    backgroundLogoDataUrl: settings?.backgroundLogoDataUrl || null,
    logoDataUrl: settings?.logoDataUrl || null,
    storefrontAppNav: getStorefrontAppNav(settings),
    navAccountInitial,
  };
};

export const links: LinksFunction = () => [];

export default function StorefrontWorkOrdersInfo() {
  const data = useLoaderData<typeof loader>();
  const { storefrontAppNav } = data;
  const inlineStyles = data.themeStyles?.styles || [];

  return (
    <>
      {(data.themeStyles?.urls ?? []).map((href: string) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {inlineStyles.map((css, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      <style dangerouslySetInnerHTML={{ __html: data.proxyStylesCss }} />
      <main
        className={`project-clad-page project-clad-page--projects project-clad-page--cc-v2 cc-store-neu${data.backgroundLogoDataUrl ? " project-clad-page--card-bg-logo" : ""}`}
        style={
          data.backgroundLogoDataUrl
            ? {
                ["--project-clad-bg-logo" as string]: `url(${data.backgroundLogoDataUrl})`,
              }
            : undefined
        }
      >
        <header className="project-clad-header project-clad-header--fullbleed">
          <ProjectCladStorefrontNav
            logoDataUrl={data.logoDataUrl}
            logoHref="/"
            logoAlt="Canadian Cladding"
            links={storefrontAppNav.links}
            cartUrl={storefrontAppNav.cartUrl}
            searchUrl={storefrontAppNav.searchUrl}
            accountUrl={storefrontAppNav.accountUrl}
            accountInitial={data.navAccountInitial}
            brandSuffix="WORK ORDERS"
            htmlTemplateHeader
            htmlTemplateNavActive="projects"
            hideTrailingIcons={true}
          />
        </header>
        <div className="page-width project-clad-container project-clad-container--full-width">
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
        </div>
        <ProjectCladStorefrontFooter
          logoDataUrl={data.logoDataUrl}
          logoAlt="Canadian Cladding"
          logoHref="/"
        />
      </main>
      <script
        dangerouslySetInnerHTML={{ __html: PROJECT_CLAD_CURSOR_GLOW_SCRIPT }}
      />
    </>
  );
}
