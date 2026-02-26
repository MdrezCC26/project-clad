import { sessionStorage } from "../shopify.server";

const THEME_API_VERSION = "2024-10";
const CACHE_TTL_MS = 10 * 60 * 1000;

type ThemeCacheEntry = {
  urls: string[];
  styles: string[];
  expiresAt: number;
};

const themeCssCache = new Map<string, ThemeCacheEntry>();

const getCachedThemeAssets = (shop: string) => {
  const cached = themeCssCache.get(shop);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    themeCssCache.delete(shop);
    return null;
  }
  return cached.urls;
};

const setCachedAssets = (shop: string, urls: string[], styles: string[]) => {
  themeCssCache.set(shop, {
    urls,
    styles,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

const fetchJson = async (url: string, accessToken: string) => {
  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    return null;
  }
  return response.json();
};

const PREFERRED_CSS_KEYS = [
  "assets/base.css",
  "assets/theme.css",
  "assets/styles.css",
  "assets/main.css",
  "assets/index.css",
  "assets/theme.scss.css",
];

const normalizeAssetKey = (key: string) => {
  if (key.startsWith("assets/")) return key;
  return `assets/${key}`;
};

const extractCssAssetKeysFromThemeLiquid = (content: string) => {
  const matches = content.matchAll(
    /['"]([^'"]+\.css)['"]\s*\|\s*asset_url/g,
  );
  const keys = new Set<string>();
  for (const match of matches) {
    const file = match[1]?.trim();
    if (file) {
      keys.add(normalizeAssetKey(file));
    }
  }
  return Array.from(keys);
};

const pickCssKeys = (keys: string[]) => {
  const preferred = keys.filter((key) =>
    PREFERRED_CSS_KEYS.includes(key),
  );
  if (preferred.length) {
    return preferred;
  }

  const cssKeys = keys.filter((key) => key.endsWith(".css"));
  const scored = cssKeys.sort((a, b) => {
    const score = (key: string) => {
      const lower = key.toLowerCase();
      if (lower.includes("theme")) return 0;
      if (lower.includes("base")) return 1;
      if (lower.includes("main")) return 2;
      if (lower.includes("style")) return 3;
      return 4;
    };
    return score(a) - score(b);
  });

  return scored;
};

export const getThemeStyles = async (shop: string) => {
  const cached = getCachedThemeAssets(shop);
  if (cached !== null) {
    const entry = themeCssCache.get(shop);
    return {
      urls: cached,
      styles: entry?.styles || [],
    };
  }

  const sessions = await sessionStorage.findSessionsByShop(shop);
  const offlineSession = sessions.find((session) => !session.isOnline);
  if (!offlineSession) {
    return { urls: [], styles: [] };
  }

  const themesResponse = await fetchJson(
    `https://${shop}/admin/api/${THEME_API_VERSION}/themes.json?role=main`,
    offlineSession.accessToken,
  );

  const mainTheme = themesResponse?.themes?.[0];
  if (!mainTheme?.id) {
    setCachedAssets(shop, [], []);
    return { urls: [], styles: [] };
  }

  const configuredKey = process.env.SHOPIFY_THEME_STYLESHEET_KEY;
  let themeLiquidKeys: string[] = [];
  if (!configuredKey) {
    const themeLiquidResponse = await fetchJson(
      `https://${shop}/admin/api/${THEME_API_VERSION}/themes/${mainTheme.id}/assets.json?asset[key]=layout/theme.liquid`,
      offlineSession.accessToken,
    );
    const themeLiquid = themeLiquidResponse?.asset?.value;
    if (typeof themeLiquid === "string") {
      themeLiquidKeys = extractCssAssetKeysFromThemeLiquid(themeLiquid);
    }
  }

  const candidates = configuredKey
    ? [configuredKey]
    : Array.from(new Set([...themeLiquidKeys, ...PREFERRED_CSS_KEYS]));

  for (const key of candidates) {
    const assetResponse = await fetchJson(
      `https://${shop}/admin/api/${THEME_API_VERSION}/themes/${mainTheme.id}/assets.json?asset[key]=${encodeURIComponent(
        key,
      )}`,
      offlineSession.accessToken,
    );

    const publicUrl = assetResponse?.asset?.public_url;
    if (publicUrl) {
      setCachedAssets(shop, [publicUrl], []);
      return { urls: [publicUrl], styles: [] };
    }
    const value = assetResponse?.asset?.value;
    if (value) {
      setCachedAssets(shop, [], [value]);
      return { urls: [], styles: [value] };
    }
  }

  const assetsResponse = await fetchJson(
    `https://${shop}/admin/api/${THEME_API_VERSION}/themes/${mainTheme.id}/assets.json`,
    offlineSession.accessToken,
  );

  const assetKeys =
    assetsResponse?.assets?.map((asset: { key?: string }) => asset.key || "") ||
    [];

  const cssKeys = pickCssKeys(assetKeys);
  const urls: string[] = [];
  const styles: string[] = [];

  for (const key of cssKeys) {
    const assetResponse = await fetchJson(
      `https://${shop}/admin/api/${THEME_API_VERSION}/themes/${mainTheme.id}/assets.json?asset[key]=${encodeURIComponent(
        key,
      )}`,
      offlineSession.accessToken,
    );

    const publicUrl = assetResponse?.asset?.public_url;
    if (publicUrl) {
      urls.push(publicUrl);
    }
    const value = assetResponse?.asset?.value;
    if (value) {
      styles.push(value);
    }
  }

  setCachedAssets(shop, urls, styles);
  return { urls, styles };
};
