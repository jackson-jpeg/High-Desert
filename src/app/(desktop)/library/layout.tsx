import type { Metadata } from "next";

export const metadata: Metadata = { title: "High Desert — Library" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
