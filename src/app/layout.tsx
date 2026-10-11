import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZIMOTA – Gestion industrielle intégrée",
  description: "Achats, réception, stocks, production, qualité, livraison, SAV et pilotage – Groupe ZIMOTA",
  icons: { icon: "/logo.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
