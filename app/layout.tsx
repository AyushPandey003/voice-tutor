import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Voice Tutor", description: "On-device voice tutor demo" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
