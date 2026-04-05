declare module "*.css";

import type { DetailedHTMLProps, HTMLAttributes } from "react";

/** Polaris / App Bridge custom elements not yet in @shopify/polaris-types. */
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
      "s-card": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        padding?: string;
      };
    }
  }
}
