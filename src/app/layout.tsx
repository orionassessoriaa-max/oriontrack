import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/providers/AuthProvider";
import DatePickerEnhancer from "@/components/ui/DatePickerEnhancer";
import EscapeToClose from "@/components/ui/EscapeToClose";
import DialogProvider from "@/components/providers/DialogProvider";
import CreativeJobsProvider from "@/components/creatives/CreativeJobsProvider";
import RecarregarAposDeploy from "@/components/providers/RecarregarAposDeploy";
import AvisoManutencao from "@/components/ui/AvisoManutencao";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ORION TRACK — Painel do Corretor",
  description: "Acompanhe seus leads e gerencie seu funil de vendas com o ORION TRACK.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-br"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AvisoManutencao />
        <RecarregarAposDeploy />
        <DatePickerEnhancer />
        <EscapeToClose />
        <DialogProvider>
          <AuthProvider>
            <CreativeJobsProvider>
              {children}
            </CreativeJobsProvider>
          </AuthProvider>
        </DialogProvider>
      </body>
    </html>
  );
}
