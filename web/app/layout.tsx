import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Footer, StaleBanner } from "@/components/Footer";
import { Header } from "@/components/Header";
import { SITE_NAME } from "@/lib/site";
import { SettingsProvider } from "@/lib/settings";

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s – ${SITE_NAME}` },
  description: "Daily fair prices, stock and trends for sealed Pokémon, One Piece and Flesh and Blood products on Cardmarket.",
};

export const viewport: Viewport = { themeColor: "#f2f5f7" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SettingsProvider>
          <Header />
          <StaleBanner />
          <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 sm:px-6">{children}</main>
          <Footer />
        </SettingsProvider>
      </body>
    </html>
  );
}
