export type ProjectCladStorefrontFooterProps = {
  logoDataUrl: string | null;
  logoAlt?: string;
  logoHref?: string;
};

export function ProjectCladStorefrontFooter({
  logoDataUrl,
  logoAlt = "Canadian Cladding",
  logoHref = "/",
}: ProjectCladStorefrontFooterProps) {
  return (
    <footer
      className="project-clad-storefront-footer project-clad-storefront-footer--fullbleed"
      role="contentinfo"
    >
      {logoDataUrl ? (
        <a href={logoHref} className="project-clad-storefront-footer__logo-link">
          <img
            src={logoDataUrl}
            alt={logoAlt}
            className="project-clad-storefront-footer__logo-img"
          />
        </a>
      ) : (
        <span className="project-clad-storefront-footer__fallback">{logoAlt}</span>
      )}
    </footer>
  );
}
