import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages use native Node.js features (LZMA, etc.) and must not be bundled by Webpack/Turbopack
  serverExternalPackages: ['dukascopy-node', 'fastest-validator', 'prettier', 'lzma-native'],
};

export default nextConfig;
