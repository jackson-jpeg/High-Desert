import { ShowShell } from "@/components/shows/ShowShell";

/** Tonight pages: the show pages' frame (docs/show-pages.md). */
export default function TonightLayout({ children }: { children: React.ReactNode }) {
  return <ShowShell>{children}</ShowShell>;
}
