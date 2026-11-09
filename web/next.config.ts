import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    // Produktbilder kommen direkt von Cardmarkets Bild-Server
    remotePatterns: [{ protocol: "https", hostname: "product-images.s3.cardmarket.com" }],
    unoptimized: true,
  },
  // Adressen von vor dem Spiel-Umschalter (nur Pokémon) bleiben gültig
  async redirects() {
    return [
      { source: "/browse", destination: "/pokemon/browse", permanent: true },
      { source: "/product/:id", destination: "/pokemon/product/:id", permanent: true },
    ];
  },
};

export default config;
