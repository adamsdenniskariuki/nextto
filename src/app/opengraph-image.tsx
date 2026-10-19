import { ImageResponse } from "next/og";

/**
 * The default social card (WhatsApp, X, LinkedIn previews) for every page that
 * doesn't define its own. Generated at build time from JSX.
 */
export const alt = "Nextto — You're next. Bookings, invoices and M-Pesa for Kenyan businesses.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: "#f6f4ef",
        color: "#15171f",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 44, fontWeight: 800 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            width: 84,
            height: 84,
            borderRadius: 26,
            background: "#15171f",
          }}
        >
          <div
            style={{ width: 14, height: 14, borderRadius: 14, background: "#f6f4ef", opacity: 0.4 }}
          />
          <div
            style={{ width: 14, height: 14, borderRadius: 14, background: "#f6f4ef", opacity: 0.7 }}
          />
          <div style={{ width: 20, height: 20, borderRadius: 20, background: "#ff5a36" }} />
        </div>
        <div style={{ display: "flex" }}>
          Nextto<span style={{ color: "#c2381a" }}>.</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 128, fontWeight: 800, letterSpacing: -4 }}>
          You&rsquo;re next<span style={{ color: "#c2381a" }}>.</span>
        </div>
        <div style={{ fontSize: 40, color: "#5b5f6b" }}>
          Bookings, invoices and M-Pesa payments for Kenyan service businesses.
        </div>
      </div>
    </div>,
    size,
  );
}
