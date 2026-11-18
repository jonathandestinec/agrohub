import type { Metadata } from "next";

export const SITE_NAME = "AgroHub";
export const SITE_DESCRIPTION =
  "Farmer cooperatives in Nigeria sell their members' harvests to bulk buyers. The buyer pays upfront and the payment is held until delivery is confirmed.";

// The site-wide metadata. `baseUrl` makes the share image and icon URLs absolute, which link
// previews (WhatsApp, X, LinkedIn) need. The images come from the metadata files in src/app
// (icon.svg, apple-icon.tsx, opengraph-image.tsx, twitter-image.tsx).
export function siteMetadata(baseUrl: string): Metadata {
  return {
    metadataBase: new URL(baseUrl),
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    openGraph: {
      siteName: SITE_NAME,
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      type: "website",
      locale: "en_NG",
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
    },
  };
}
