import { ImageResponse } from "next/og";

/* The picture a shared link to the site shows: the name and the tagline. */

export const alt = "Average App: Be the average admit.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background: "#f5f3ee",
          color: "#1f2421",
        }}
      >
        <div style={{ fontSize: 112, fontWeight: 600, letterSpacing: -2 }}>Average App</div>
        <div style={{ display: "flex", marginTop: 16, fontSize: 56, color: "#2f5d4a" }}>
          <span>Be the average</span>
          <span
            style={{
              marginLeft: 14,
              padding: "0 6px",
              color: "#1f2421",
              backgroundImage: "linear-gradient(transparent 40%, #c6dccf 40%, #c6dccf 92%, transparent 92%)",
            }}
          >
            admit
          </span>
          <span>.</span>
        </div>
        <div style={{ marginTop: 40, fontSize: 30, color: "#6b6f6c" }}>Every college essay and short answer, in one place.</div>
      </div>
    ),
    size,
  );
}
