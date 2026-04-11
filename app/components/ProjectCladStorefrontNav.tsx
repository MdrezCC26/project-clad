import { useEffect, useRef, useState, type ReactNode } from "react";
import type { StorefrontAppNavLink } from "../types/storefrontAppNav";

function IconMenu({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
      />
    </svg>
  );
}

function IconAccount({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
      />
    </svg>
  );
}

function IconCart({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"
      />
    </svg>
  );
}

export function ProjectCladStorefrontNav({
  logoDataUrl,
  logoAlt = "Home",
  logoHref = "/",
  links,
  cartUrl,
  searchUrl = "/search",
  accountUrl = "/account",
  accountInitial = null,
  cartItemCount = 0,
  /** Renders inside the raised nav capsule between the logo cluster and search/account/cart. */
  shellExtra = null,
}: {
  logoDataUrl: string | null;
  logoAlt?: string;
  logoHref?: string;
  links: StorefrontAppNavLink[];
  cartUrl: string;
  searchUrl?: string;
  accountUrl?: string;
  /** Single letter for storefront-style account disc (e.g. first name initial). */
  accountInitial?: string | null;
  /** When greater than 0, shows a red count badge on the cart icon. */
  cartItemCount?: number;
  shellExtra?: ReactNode;
}) {
  const initial = accountInitial?.trim().charAt(0).toUpperCase() ?? "";
  const drawerRef = useRef<HTMLDetailsElement>(null);
  const [liveCartCount, setLiveCartCount] = useState(() =>
    Math.max(0, Math.floor(Number(cartItemCount) || 0)),
  );

  useEffect(() => {
    setLiveCartCount(Math.max(0, Math.floor(Number(cartItemCount) || 0)));
  }, [cartItemCount]);

  useEffect(() => {
    let cancelled = false;
    const syncCart = () => {
      fetch("/cart.js", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { item_count?: number } | null) => {
          if (cancelled || !data || typeof data.item_count !== "number") return;
          setLiveCartCount(Math.max(0, data.item_count));
        })
        .catch(() => {});
    };
    syncCart();
    window.addEventListener("pageshow", syncCart);
    window.addEventListener("focus", syncCart);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", syncCart);
      window.removeEventListener("focus", syncCart);
    };
  }, []);

  const closeDrawer = () => {
    const el = drawerRef.current;
    if (el) el.open = false;
  };

  const showCartBadge = liveCartCount > 0;

  return (
    <div className="project-clad-storefront-nav" data-projectclad-storefront-nav>
      <div className="project-clad-storefront-nav__shell">
        <div className="project-clad-storefront-nav__left">
          <details ref={drawerRef} className="project-clad-storefront-nav__drawer">
            <summary
              className="project-clad-storefront-nav__menu-btn"
              aria-label="Open menu"
            >
              <IconMenu className="project-clad-storefront-nav__icon" />
            </summary>
            <div className="project-clad-storefront-nav__drawer-panel">
              <nav className="project-clad-storefront-nav__drawer-nav" aria-label="Store menu">
                {links.map((btn, i) => (
                  <a
                    key={`drawer-${btn.url}-${i}`}
                    href={btn.url}
                    className="project-clad-storefront-nav__link project-clad-storefront-nav__link--drawer"
                    onClick={closeDrawer}
                  >
                    {btn.label}
                  </a>
                ))}
              </nav>
            </div>
          </details>

          <a href={logoHref} className="project-clad-storefront-nav__logo-link">
            {logoDataUrl ? (
              <img
                src={logoDataUrl}
                alt={logoAlt}
                className="project-clad-storefront-nav__logo-img"
              />
            ) : (
              <span className="project-clad-storefront-nav__logo-fallback">{logoAlt}</span>
            )}
          </a>
        </div>

        {shellExtra ? (
          <div className="project-clad-storefront-nav__shell-extra">{shellExtra}</div>
        ) : null}

        <div className="project-clad-storefront-nav__tools">
          <a
            href={searchUrl}
            className="project-clad-storefront-nav__icon-btn"
            aria-label="Search"
          >
            <IconSearch className="project-clad-storefront-nav__icon" />
          </a>
          <a
            href={accountUrl}
            className={`project-clad-storefront-nav__icon-btn${initial ? " project-clad-storefront-nav__icon-btn--avatar" : ""}`}
            aria-label="Account"
          >
            {initial ? (
              <span className="project-clad-storefront-nav__account-initial" aria-hidden="true">
                {initial}
              </span>
            ) : (
              <IconAccount className="project-clad-storefront-nav__icon" />
            )}
          </a>
          <a
            href={cartUrl}
            className={`project-clad-storefront-nav__icon-btn project-clad-storefront-nav__icon-btn--cart${showCartBadge ? " project-clad-storefront-nav__icon-btn--has-badge" : ""}`}
            aria-label={showCartBadge ? `Cart, ${liveCartCount} items` : "Cart"}
          >
            <IconCart className="project-clad-storefront-nav__icon" />
            {showCartBadge ? (
              <span className="project-clad-storefront-nav__cart-badge" aria-hidden="true">
                {liveCartCount > 99 ? "99+" : String(liveCartCount)}
              </span>
            ) : null}
          </a>
        </div>
      </div>
    </div>
  );
}
