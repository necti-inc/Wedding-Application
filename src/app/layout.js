import { Plus_Jakarta_Sans, Great_Vibes } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-plus-jakarta",
});

const greatVibes = Great_Vibes({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-great-vibes",
});

export const metadata = {
  title: "Close Family Cowboy & Cocktail Evening Photo Gallery",
  description: "Share and view photos from our Close Family Cowboy & Cocktail Evening",
  openGraph: {
    title: "Close Family Cowboy & Cocktail Evening Photo Gallery",
    description: "Share and view photos from our Close Family Cowboy & Cocktail Evening",
  },
  twitter: {
    card: "summary_large_image",
    title: "Close Family Cowboy & Cocktail Evening Photo Gallery",
  },
};

export const viewport = {
  themeColor: "#2A2B2A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${greatVibes.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
