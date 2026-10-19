import type { MetadataRoute } from "next";

/** /manifest.webmanifest: lets owners "Add to home screen" and open the dashboard like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nextto — You're next.",
    short_name: "Nextto",
    description: "Bookings, invoices and M-Pesa payments for Kenyan service businesses.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f6f4ef",
    theme_color: "#15171f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
