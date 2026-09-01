import type { ReactNode } from "react";
import { ProjectCladStorefrontFooter } from "./ProjectCladStorefrontFooter";
import { ProjectCladStorefrontNav } from "./ProjectCladStorefrontNav";
import type { StorefrontAppNavLink } from "../types/storefrontAppNav";
import type { CanadianCladdingShapeNavKey } from "../utils/canadianCladdingPrimaryNav";
import { PROJECT_CLAD_CURSOR_GLOW_SCRIPT } from "../utils/projectCladCursorGlowScript";

export const SHAPE_PAGE_LINKS = [
  { key: "templates", label: "Templates", href: "/apps/project-clad/shape-templates" },
  { key: "builder", label: "Builder", href: "/apps/project-clad/shape-builder" },
  { key: "library", label: "Profiles", href: "/apps/project-clad/shape-library" },
  { key: "cart", label: "Parts cart", href: "/apps/project-clad/shape-cart" },
] as const;

export type ShapePageKey = (typeof SHAPE_PAGE_LINKS)[number]["key"];

/** Map page keys from the routes onto the primary-nav shape keys. */
function shapeNavActiveForPage(active: ShapePageKey): CanadianCladdingShapeNavKey {
  if (active === "library") return "profiles";
  if (active === "cart") return "shapeCart";
  return active;
}

type ThemeStyles = { urls?: string[]; styles?: string[] } | null;

export function ShapeStorefrontShell(props: {
  active: ShapePageKey;
  title: string;
  subtitle?: string;
  proxyStylesHref: string;
  themeStyles: ThemeStyles;
  storefrontAppNav: {
    links: StorefrontAppNavLink[];
    cartUrl: string;
    searchUrl: string;
    accountUrl: string;
  };
  logoUrl: string | null;
  backgroundLogoUrl: string | null;
  navAccountInitial: string | null;
  navAccountFirstName: string | null;
  /** Staged shape-cart quantity, shown as a badge on Parts cart in the main nav. */
  shapeCartCount?: number;
  extraHead?: ReactNode;
  extraScripts?: ReactNode;
  children: ReactNode;
}) {
  const inlineStyles = props.themeStyles?.styles || [];
  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Onest:wght@300;400;500;600;700&display=swap"
      />
      {(props.themeStyles?.urls ?? []).map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {inlineStyles.map((css, index) => (
        <style key={index} dangerouslySetInnerHTML={{ __html: css }} />
      ))}
      <link rel="stylesheet" href={props.proxyStylesHref} />
      {props.extraHead}
      <main
        className={`project-clad-page project-clad-page--projects project-clad-page--cc-v2 project-clad-enter-done cc-store-neu${
          props.backgroundLogoUrl ? " project-clad-page--card-bg-logo" : ""
        }`}
        style={
          props.backgroundLogoUrl
            ? { ["--project-clad-bg-logo" as string]: `url("${props.backgroundLogoUrl}")` }
            : undefined
        }
      >
        <header className="project-clad-header project-clad-header--fullbleed">
          <ProjectCladStorefrontNav
            logoSrc={props.logoUrl}
            logoHref="/"
            logoAlt="Canadian Cladding"
            links={props.storefrontAppNav.links}
            cartUrl={props.storefrontAppNav.cartUrl}
            searchUrl={props.storefrontAppNav.searchUrl}
            accountUrl={props.storefrontAppNav.accountUrl}
            accountInitial={props.navAccountInitial}
            accountFirstName={props.navAccountFirstName}
            htmlTemplateHeader
            htmlTemplateNavActive={null}
            hideTrailingIcons={true}
            shapeNavActive={shapeNavActiveForPage(props.active)}
            shapeCartCount={props.shapeCartCount ?? 0}
          />
        </header>
        <div className="page-width project-clad-container">
          <header className="pc-shape-page-head">
            <h1 className="pc-shape-page-head__title">{props.title}</h1>
            {props.subtitle ? (
              <p className="pc-shape-page-head__sub">{props.subtitle}</p>
            ) : null}
          </header>
          {props.children}
        </div>
        <ProjectCladStorefrontFooter
          logoSrc={props.logoUrl}
          logoAlt="Canadian Cladding"
          logoHref="/"
        />
      </main>
      <script
        dangerouslySetInnerHTML={{ __html: PROJECT_CLAD_CURSOR_GLOW_SCRIPT }}
      />
      {props.extraScripts}
    </>
  );
}

export function ShapeProfileCard(props: {
  href: string;
  name: string;
  svg: string;
  meta: string;
  /** Optional control rendered under the meta (e.g. delete form). */
  deleteSlot?: ReactNode;
}) {
  return (
    <div className="pc-shape-card">
      <a href={props.href} className="pc-shape-card__link">
        <div
          className="pc-shape-card__art"
          dangerouslySetInnerHTML={{ __html: props.svg }}
        />
        <div className="pc-shape-card__body">
          <h2 className="pc-shape-card__title">{props.name}</h2>
          <p className="pc-shape-card__meta">{props.meta}</p>
        </div>
      </a>
      {props.deleteSlot ? (
        <div className="pc-shape-card__actions">{props.deleteSlot}</div>
      ) : null}
    </div>
  );
}
