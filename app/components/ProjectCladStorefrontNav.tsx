import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router";
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

/** Matches Shopify Horizon `assets/icon-cart.svg` (storefront header bag). */
function IconCart({ className }: { className?: string }) {
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
        strokeWidth={1}
        d="M3.392 6.875h13.216v8.016c0 .567-.224 1.112-.624 1.513-.4.402-.941.627-1.506.627H5.522a2.13 2.13 0 0 1-1.506-.627 2.15 2.15 0 0 1-.624-1.513zM8.818 2.969h2.333c.618 0 1.211.247 1.649.686a2.35 2.35 0 0 1 .683 1.658v1.562H6.486V5.313c0-.622.246-1.218.683-1.658a2.33 2.33 0 0 1 1.65-.686"
      />
    </svg>
  );
}

const COMPACT_STOREFRONT_NAV_MQ = "(max-width: 749px)";

function useCompactStorefrontNav(): boolean {
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(COMPACT_STOREFRONT_NAV_MQ);
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return compact;
}

type InAppSearchMode = "projects" | "orders";

const StorefrontNavInAppSearch = forwardRef<HTMLDetailsElement, {
  mode: InAppSearchMode;
  compactNav: boolean;
  onCloseActionsMenuDrawer: () => void;
  onCloseStoreMenuDrawer: () => void;
}>(function StorefrontNavInAppSearch(
  { mode, compactNav, onCloseActionsMenuDrawer, onCloseStoreMenuDrawer },
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

  const [searchParams, setSearchParams] = useSearchParams();
  const qFromUrl = searchParams.get("q") ?? "";
  const [draft, setDraft] = useState(qFromUrl);

  useEffect(() => {
    setDraft(qFromUrl);
  }, [qFromUrl]);

  const closeDetails = () => {
    const el = detailsEl.current;
    if (el) el.open = false;
  };

  const apply = () => {
    const trimmed = draft.trim();
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (trimmed) next.set("q", trimmed);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
    if (compactNav) onCloseActionsMenuDrawer();
    onCloseStoreMenuDrawer();
    closeDetails();
  };

  const clear = () => {
    setDraft("");
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("q");
        return next;
      },
      { replace: true },
    );
    if (compactNav) onCloseActionsMenuDrawer();
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
          {qFromUrl ? (
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
}) {
  const initial = accountInitial?.trim().charAt(0).toUpperCase() ?? "";
  const storeMenuDrawerRef = useRef<HTMLDetailsElement>(null);
  const searchDrawerRef = useRef<HTMLDetailsElement>(null);
  const compactNav = useCompactStorefrontNav();
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

  const closeStoreMenuDrawer = () => {
    const el = storeMenuDrawerRef.current;
    if (el) el.open = false;
  };

  const showCartBadge = liveCartCount > 0;

  const toolsInner = (
    <>
      {inAppSearch ? (
        <StorefrontNavInAppSearch
          ref={searchDrawerRef}
          mode={inAppSearch}
          compactNav={compactNav}
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

  return (
    <div className="project-clad-storefront-nav" data-projectclad-storefront-nav>
      <div
        className={`project-clad-storefront-nav__shell${compactNav ? " project-clad-storefront-nav__shell--compact-stacked" : ""}`}
      >
        {compactNav ? (
          <>
            <div className="project-clad-storefront-nav__brand-row">{logoBlock}</div>
            <div className="project-clad-storefront-nav__icon-toolbar">
              {storeMenuDrawer}
              {shellExtra ? (
                <div className="project-clad-storefront-nav__shell-extra project-clad-storefront-nav__shell-extra--compact-toolbar">
                  {shellExtra}
                </div>
              ) : null}
              {toolsRow}
            </div>
          </>
        ) : (
          <>
            <div className="project-clad-storefront-nav__left">
              {storeMenuDrawer}
              {logoBlock}
            </div>
            {shellExtraSlot}
            {toolsRow}
          </>
        )}
      </div>
    </div>
  );
}
