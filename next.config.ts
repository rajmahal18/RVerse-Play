import type { NextConfig } from "next";

const appUrl = process.env.NEXT_PUBLIC_APP_URL;
const appHost = appUrl ? new URL(appUrl).host : undefined;

const nextConfig: NextConfig = {
  ...(appHost && appHost !== "localhost:3000" ? { allowedDevOrigins: [appHost] } : {}),
};

export default nextConfig;
