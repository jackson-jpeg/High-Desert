import { ShowShell } from "@/components/shows/ShowShell";

/** Topic pages: the show pages' frame (docs/show-pages.md). */
export default function TopicLayout({ children }: { children: React.ReactNode }) {
  return <ShowShell>{children}</ShowShell>;
}
