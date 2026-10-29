import type { Metadata } from "next";
import "./globals.css";
import { connection } from "next/server";
import { appearance } from "@/server/appearance";
export const metadata: Metadata = {
  title: "Creator Intelligence",
  description: "Dados confiáveis. Conversas que viram decisões.",
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const { theme } = await appearance();
  return (
    <html lang="pt-BR" data-theme={theme} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
