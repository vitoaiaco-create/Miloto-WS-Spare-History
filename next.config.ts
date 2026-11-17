import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Disciplinary charge images are sent to a Server Action as base64
      // (see src/actions/hr-automation.ts); the 1 MB default is too small.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
