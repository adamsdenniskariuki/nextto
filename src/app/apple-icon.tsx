import { ImageResponse } from "next/og";

/**
 * File-based metadata: Next turns this into /apple-icon and adds the
 * <link rel="apple-touch-icon"> tag. ImageResponse renders JSX (a subset of
 * CSS flexbox) to a PNG at build time, so the icon stays in code, not Figma.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const dot = (d: number, color: string, opacity = 1) => (
    <div style={{ width: d, height: d, borderRadius: d, background: color, opacity }} />
  );
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "#15171f",
      }}
    >
      {dot(30, "#f6f4ef", 0.4)}
      {dot(30, "#f6f4ef", 0.7)}
      {dot(44, "#ff5a36")}
    </div>,
    size,
  );
}
