import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

export const metadata = {
  title: "SEC Filing NLP Alpha Engine",
  description: "Advanced Financial Textual Sentiment Research and Portfolio Backtest Dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
