import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/onboard",
        destination: "/onboard/index.html",
      },
    ];
  },
};

export default nextConfig;
