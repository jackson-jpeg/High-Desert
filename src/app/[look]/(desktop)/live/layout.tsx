import type { Metadata } from "next";
import { RouteHeading } from "@/components/desktop/RouteHeading";

export const metadata: Metadata = {
  title: "Live",
  description:
    "High Desert Live: a 24-hour Art Bell station. Everyone tuned in hears the same show at the same second, with the phone lines open.",
  alternates: { canonical: "/live" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RouteHeading>High Desert Live</RouteHeading>
      {children}
    </>
  );
}
