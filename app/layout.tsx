import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Restaurant Extractor",
  description: "Extract publicly available restaurant details from Google Maps.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
