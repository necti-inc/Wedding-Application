import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-plus-jakarta",
});

export const metadata = {
  title: "Our Wedding Photos",
  description: "Share and view wedding photos",
};

export const viewport = {
  themeColor: "#3C3D3C",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={plusJakarta.variable}>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
