import { ImageResponse } from "next/og";

// The home-screen icon for iPhone and iPad. iOS rounds the corners itself, so the lime fills the
// square and the leaves sit larger than in the round favicon. Colours: src/styles/tokens.css.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#dcef6a" }}>
        <svg width="180" height="180" viewBox="6 2 20 20">
          <path d="M16 12c0-3 2.5-5 6-5 0 3.5-2.5 6-6 5Z" fill="#173a2a" />
          <path d="M16 16c0-3-2.5-5-6-5 0 3.5 2.5 6 6 5Z" fill="#173a2a" />
        </svg>
      </div>
    ),
    size,
  );
}
