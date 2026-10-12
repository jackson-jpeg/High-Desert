import { ShowShell } from "@/components/shows/ShowShell";

/** Show pages: their own light frame, not the app shell (docs/show-pages.md). */
export default function ShowLayout({ children }: { children: React.ReactNode }) {
  return <ShowShell>{children}</ShowShell>;
}
