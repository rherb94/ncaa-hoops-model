import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["http://localhost:3000", "https://*.ngrok-free.app"],
  // Ensure all data files are bundled into Vercel serverless functions.
  // Without this, Next.js output file tracing may miss dynamically-built paths
  // like path.join(DATA_DIR, leagueId, "odds_opening", `${date}.json`).
  outputFileTracingIncludes: {
    "/api/**": ["./src/data/**"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "a.espncdn.com",
        pathname: "/i/teamlogos/**",
      },
      {
        protocol: "https",
        hostname: "a.espncdn.com",
        pathname: "/combiner/**",
      },
      {
        protocol: "https",
        hostname: "a.espncdn.com",
        pathname: "/guid/**",
      },
    ],
  },
};

export default nextConfig;
