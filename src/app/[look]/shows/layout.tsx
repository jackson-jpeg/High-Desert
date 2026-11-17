import { ShowShell } from "@/components/shows/ShowShell";

/** The archive by year: the show pages' frame (docs/show-pages.md). */
export default function ShowsLayout({ children }: { children: React.ReactNode }) {
  return <ShowShell>{children}</ShowShell>;
}
