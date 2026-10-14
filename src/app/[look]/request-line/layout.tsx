import { ShowShell } from "@/components/shows/ShowShell";

/** The Request Line: the show pages' frame (docs/request-line.md). */
export default function RequestLineLayout({ children }: { children: React.ReactNode }) {
  return <ShowShell>{children}</ShowShell>;
}
