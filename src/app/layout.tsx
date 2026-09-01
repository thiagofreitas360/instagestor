import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InstaGestor",
  description: "Gerenciamento interno de publicações do Instagram",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
