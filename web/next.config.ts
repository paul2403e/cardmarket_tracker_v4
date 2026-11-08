import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    // Produktbilder kommen direkt von Cardmarkets Bild-Server
    remotePatterns: [{ protocol: "https", hostname: "product-images.s3.cardmarket.com" }],
    unoptimized: true,
  },
};

export default config;
