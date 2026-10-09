import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beagle Brigade",
  description:
    "Scout sniffs every new npm and PyPI release for malware, in real time.",
  icons: { icon: "/scout-avatar.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
