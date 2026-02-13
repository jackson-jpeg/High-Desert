import type { Metadata } from "next";

export const metadata: Metadata = { title: "High Desert — Scanner" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
