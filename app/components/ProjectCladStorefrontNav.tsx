import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";
import type { StorefrontAppNavLink } from "../types/storefrontAppNav";
import {
  CANADIAN_CLADDING_PRIMARY_NAV,
  CANADIAN_CLADDING_TOPBAR_LINKS,
  matchCanadianCladdingPrimaryNavActive,
} from "../utils/canadianCladdingPrimaryNav";
import {
  buildCanadianCladdingLogoSrcSet,
  CANADIAN_CLADDING_STOREFRONT_LOGO_URL,
} from "../utils/canadianCladdingStorefrontLogo";

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

/** Matches theme `cc-storefront-header` cart icon (stroke-width 1.5). */
function IconCart({ className, strokeWidth = 1.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="none"
      width={20}
      height={20}
      aria-hidden="true"
    >
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        d="M3.392 6.875h13.216v8.016c0 .567-.224 1.112-.624 1.513-.4.402-.941.627-1.506.627H5.522a2.13 2.13 0 0 1-1.506-.627 2.15 2.15 0 0 1-.624-1.513zM8.818 2.969h2.333c.618 0 1.211.247 1.649.686a2.35 2.35 0 0 1 .683 1.658v1.562H6.486V5.313c0-.622.246-1.218.683-1.658a2.33 2.33 0 0 1 1.65-.686"
      />
    </svg>
  );
}

type InAppSearchMode = "projects" | "orders";

const StorefrontNavInAppSearch = forwardRef<HTMLDetailsElement, {
  mode: InAppSearchMode;
  query: string;
  onApplyQuery: (query: string) => void;
  onClearQuery: () => void;
  onCloseActionsMenuDrawer: () => void;
  onCloseStoreMenuDrawer: () => void;
}>(function StorefrontNavInAppSearch(
  { mode, query, onApplyQuery, onClearQuery, onCloseActionsMenuDrawer, onCloseStoreMenuDrawer },
  ref,
) {
  const detailsEl = useRef<HTMLDetailsElement | null>(null);
  const setDetailsRef = (node: HTMLDetailsElement | null) => {
    detailsEl.current = node;
    if (typeof ref === "function") {
      ref(node);
    } else if (ref) {
      (ref as MutableRefObject<HTMLDetailsElement | null>).current = node;
    }
  };

  const [draft, setDraft] = useState(query);

  useEffect(() => {
    setDraft(query);
  }, [query]);

  const closeDetails = () => {
    const el = detailsEl.current;
    if (el) el.open = false;
  };

  const apply = () => {
    const trimmed = draft.trim();
    onApplyQuery(trimmed);
    onCloseActionsMenuDrawer();
    onCloseStoreMenuDrawer();
    closeDetails();
  };

  const clear = () => {
    setDraft("");
    onClearQuery();
    onCloseActionsMenuDrawer();
    onCloseStoreMenuDrawer();
    closeDetails();
  };

  const placeholder =
    mode === "projects" ? "Search projects…" : "Search orders…";
  const aria =
    mode === "projects" ? "Search projects" : "Search orders in this project";

  return (
    <details
      ref={setDetailsRef}
      className="project-clad-storefront-nav__search-drawer"
      onToggle={(e) => {
        const el = e.currentTarget;
        if (el instanceof HTMLDetailsElement && el.open) {
          onCloseStoreMenuDrawer();
        }
      }}
    >
      <summary
        className="project-clad-storefront-nav__icon-btn project-clad-storefront-nav__icon-btn--search"
        aria-label={aria}
        aria-haspopup="dialog"
      >
        <IconSearch className="project-clad-storefront-nav__icon" />
      </summary>
      {/* Inner panel: stop mousedown from bubbling to details (avoids accidental close). Not a separate control. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="project-clad-storefront-nav__search-panel"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <label className="project-clad-sr-only" htmlFor="projectclad-storefront-nav-q">
          {aria}
        </label>
        <input
          id="projectclad-storefront-nav-q"
          type="search"
          name="projectclad-nav-q"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          className="project-clad-storefront-nav__search-input"
        />
        <div className="project-clad-storefront-nav__search-actions">
          <button type="button" className="project-clad-button project-clad-reject-modal-btn" onClick={apply}>
            Search
          </button>
          {query ? (
            <button type="button" className="project-clad-button project-clad-reject-modal-btn" onClick={clear}>
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </details>
  );
});

StorefrontNavInAppSearch.displayName = "StorefrontNavInAppSearch";

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
  /**
   * When set, the search icon filters this app view via the `q` URL param instead of linking to the
   * storefront search page.
   */
  inAppSearch = null,
  inAppSearchQuery = "",
  onInAppSearchQueryChange,
  /**
   * When true, menu stays left, logo + optional suffix are centered, tools (+ shellExtra) align right
   * (projects list mockup).
   */
  brandCenterLayout = false,
  /** e.g. "PROJECTS" → rendered as "/ PROJECTS" next to the logo when `brandCenterLayout`. */
  brandSuffix = null,
  /** Uses the literal Canadian Cladding header structure (top black bar + main nav). */
  htmlTemplateHeader = false,
  /**
   * When set with `htmlTemplateHeader`, forces which main-nav item shows the active underline
   * (overrides pathname-based detection — useful for app proxy / locale paths).
   */
  htmlTemplateNavActive = null,
  /**
   * When true with `htmlTemplateHeader`, omits search / account / cart icon cluster (e.g. projects
   * list where the top bar already links to account & cart).
   */
  hideTrailingIcons = false,
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
  inAppSearch?: InAppSearchMode | null;
  inAppSearchQuery?: string;
  onInAppSearchQueryChange?: (query: string) => void;
  brandCenterLayout?: boolean;
  brandSuffix?: string | null;
  htmlTemplateHeader?: boolean;
  htmlTemplateNavActive?: "shop" | "projects" | null;
  hideTrailingIcons?: boolean;
}) {
  const initial = accountInitial?.trim().charAt(0).toUpperCase() ?? "";
  const storeMenuDrawerRef = useRef<HTMLDetailsElement>(null);
  const searchDrawerRef = useRef<HTMLDetailsElement>(null);
  const [liveCartCount, setLiveCartCount] = useState(() =>
    Math.max(0, Math.floor(Number(cartItemCount) || 0)),
  );
  const [showBackToTop, setShowBackToTop] = useState(false);

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

  useEffect(() => {
    if (!htmlTemplateHeader) {
      setShowBackToTop(false);
      return;
    }

    const onScroll = () => {
      setShowBackToTop(window.scrollY > 120);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [htmlTemplateHeader]);

  const location = useLocation();
  const htmlPrimaryNavPath = location.pathname;

  const closeStoreMenuDrawer = () => {
    const el = storeMenuDrawerRef.current;
    if (el) el.open = false;
  };

  const showCartBadge = liveCartCount > 0;
  const handleBackToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toolsInner = (
    <>
      {inAppSearch ? (
        <StorefrontNavInAppSearch
          ref={searchDrawerRef}
          mode={inAppSearch}
          query={inAppSearchQuery}
          onApplyQuery={(query) => {
            onInAppSearchQueryChange?.(query);
          }}
          onClearQuery={() => {
            onInAppSearchQueryChange?.("");
          }}
          onCloseActionsMenuDrawer={() => {}}
          onCloseStoreMenuDrawer={closeStoreMenuDrawer}
        />
      ) : (
        <a
          href={searchUrl}
          className="project-clad-storefront-nav__icon-btn"
          aria-label="Search"
          onClick={closeStoreMenuDrawer}
        >
          <IconSearch className="project-clad-storefront-nav__icon" />
        </a>
      )}
      <a
        href={accountUrl}
        className={`project-clad-storefront-nav__icon-btn${initial ? " project-clad-storefront-nav__icon-btn--avatar" : ""}`}
        aria-label="Account"
        onClick={closeStoreMenuDrawer}
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
        onClick={closeStoreMenuDrawer}
      >
        <IconCart className="project-clad-storefront-nav__icon" />
        {showCartBadge ? (
          <span className="project-clad-storefront-nav__cart-badge" aria-hidden="true">
            {liveCartCount > 99 ? "99+" : String(liveCartCount)}
          </span>
        ) : null}
      </a>
    </>
  );

  const toolsRow = (
    <div className="project-clad-storefront-nav__tools">{toolsInner}</div>
  );

  const shellExtraSlot = shellExtra ? (
    <div className="project-clad-storefront-nav__shell-extra">{shellExtra}</div>
  ) : null;

  const storeMenuDrawer = (
    <details
      ref={storeMenuDrawerRef}
      className="project-clad-storefront-nav__drawer"
      onToggle={(e) => {
        const el = e.currentTarget;
        if (el instanceof HTMLDetailsElement && el.open) {
          const s = searchDrawerRef.current;
          if (s) s.open = false;
        }
      }}
    >
      <summary className="project-clad-storefront-nav__menu-btn" aria-label="Open menu">
        <IconMenu className="project-clad-storefront-nav__icon" />
      </summary>
      <div className="project-clad-storefront-nav__drawer-panel">
        <nav className="project-clad-storefront-nav__drawer-nav" aria-label="Store menu">
          {links.map((btn, i) => (
            <a
              key={`drawer-${btn.url}-${i}`}
              href={btn.url}
              className="project-clad-storefront-nav__link project-clad-storefront-nav__link--drawer"
              onClick={closeStoreMenuDrawer}
            >
              {btn.label}
            </a>
          ))}
        </nav>
      </div>
    </details>
  );

  const logoBlock = (
    <a href={logoHref} className="project-clad-storefront-nav__logo-link">
      {logoDataUrl ? (
        <img src={logoDataUrl} alt={logoAlt} className="project-clad-storefront-nav__logo-img" />
      ) : (
        <span className="project-clad-storefront-nav__logo-fallback">{logoAlt}</span>
      )}
    </a>
  );

  const suffixText = brandSuffix?.trim() ?? "";
  const brandLockup =
    suffixText && brandCenterLayout ? (
      <div className="project-clad-storefront-nav__brand-lockup">
        {logoBlock}
        <span className="project-clad-storefront-nav__brand-suffix">
          <span className="project-clad-storefront-nav__brand-slash" aria-hidden="true">
            /
          </span>
          <strong className="project-clad-storefront-nav__brand-context">{suffixText}</strong>
        </span>
      </div>
    ) : null;

  /* Header uses the live theme wordmark asset (not admin logoDataUrl — that asset is often smaller). */
  const storefrontLogoSrc = CANADIAN_CLADDING_STOREFRONT_LOGO_URL;
  const storefrontLogoSrcSet = buildCanadianCladdingLogoSrcSet(storefrontLogoSrc);

  const ccAppHeaderMainNav = (
    <nav className="cc-app-header__nav" aria-label="Primary">
      {CANADIAN_CLADDING_PRIMARY_NAV.map((item) => {
        const active =
          (htmlTemplateNavActive === "projects" && item.key === "projects") ||
          (htmlTemplateNavActive === "shop" && item.key === "siding") ||
          (htmlTemplateNavActive == null &&
            matchCanadianCladdingPrimaryNavActive(
              htmlPrimaryNavPath,
              item.key,
              item.url,
            ));
        return (
          <a
            key={item.key}
            href={item.url}
            className={active ? "is-active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );

  const ccAppHeader = (
    <header className="cc-app-header" id="ccAppHeader" data-cc-app-header>
      <div className="cc-app-header__topbar">
        <div className="cc-app-header__topbar-left">
          <span>48 Hour lead time</span>
          <span className="cc-app-header__sep" aria-hidden="true">
            ·
          </span>
          <span>Ottawa, ON</span>
        </div>
        <nav className="cc-app-header__topbar-right" aria-label="Quick links">
          {showBackToTop ? (
            <button
              type="button"
              className="project-clad-storefront-nav__html-back-to-top"
              onClick={handleBackToTop}
              aria-label="Back to top"
            >
              Back to top
            </button>
          ) : null}
          <a href={CANADIAN_CLADDING_TOPBAR_LINKS.contact} className="cc-app-header__hide-mobile">
            Contact
          </a>
          <a href={CANADIAN_CLADDING_TOPBAR_LINKS.colours} className="cc-app-header__hide-mobile">
            Colours
          </a>
          <a href={accountUrl}>Account</a>
          <a href={cartUrl} className="cc-app-header__topbar-cart">
            <span className="cc-app-header__cart-icon-wrap" aria-hidden="true">
              <IconCart className="cc-app-header__cart-icon" strokeWidth={1.5} />
            </span>
            <span>Cart{showCartBadge ? ` [${liveCartCount}]` : ""}</span>
          </a>
        </nav>
      </div>
      <div className="cc-app-header__inner">
        <div className="cc-app-header__mainbar">
          <div className="cc-app-header__leading">
            <a href={logoHref} className="cc-app-header__logo-link" aria-label={logoAlt}>
              <img
                src={storefrontLogoSrc}
                alt={logoAlt}
                srcSet={storefrontLogoSrcSet}
                height={60}
                loading="eager"
                className="cc-app-header__logo-img"
                sizes="(max-width: 749px) 52vw, 560px"
              />
            </a>
          </div>
          {ccAppHeaderMainNav}
          {!hideTrailingIcons ? (
            <div className="project-clad-storefront-nav__html-trailing">
              {shellExtraSlot}
              {toolsRow}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );

  return (
    <div className="project-clad-storefront-nav" data-projectclad-storefront-nav>
      {htmlTemplateHeader ? (
        ccAppHeader
      ) : (
        <div
          className={`project-clad-storefront-nav__shell project-clad-storefront-nav__shell--flat${brandCenterLayout ? " project-clad-storefront-nav__shell--brand-center" : ""}`}
        >
          {brandCenterLayout ? (
            <>
              <div className="project-clad-storefront-nav__shell-leading">{storeMenuDrawer}</div>
              <div className="project-clad-storefront-nav__shell-brand">{brandLockup ?? logoBlock}</div>
              <div className="project-clad-storefront-nav__shell-trailing">
                {shellExtraSlot}
                {toolsRow}
              </div>
            </>
          ) : (
            <>
              <div className="project-clad-storefront-nav__shell-primary">
                {storeMenuDrawer}
                {logoBlock}
              </div>
              {shellExtraSlot}
              {toolsRow}
            </>
          )}
        </div>
      )}
    </div>
  );
}
