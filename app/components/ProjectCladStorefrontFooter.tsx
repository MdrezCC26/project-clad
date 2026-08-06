export type ProjectCladStorefrontFooterProps = {
  logoSrc: string | null;
  logoAlt?: string;
  logoHref?: string;
};

export function ProjectCladStorefrontFooter({
  logoSrc,
  logoAlt = "Canadian Cladding",
  logoHref = "/",
}: ProjectCladStorefrontFooterProps) {
  return (
    <footer
      className="project-clad-storefront-footer project-clad-storefront-footer--fullbleed"
      role="contentinfo"
    >
      {logoSrc ? (
        <a href={logoHref} className="project-clad-storefront-footer__logo-link">
          <img
            src={logoSrc}
            alt={logoAlt}
            loading="lazy"
            decoding="async"
            className="project-clad-storefront-footer__logo-img"
          />
        </a>
      ) : (
        <span className="project-clad-storefront-footer__fallback">{logoAlt}</span>
      )}
    </footer>
  );
}
