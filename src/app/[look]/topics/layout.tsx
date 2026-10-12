import { ShowShell } from "@/components/shows/ShowShell";

/** The topics index: the show pages' frame (docs/show-pages.md). */
export default function TopicsLayout({ children }: { children: React.ReactNode }) {
  return <ShowShell>{children}</ShowShell>;
}
