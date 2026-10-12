import { ShowShell } from "@/components/shows/ShowShell";

/** Guest pages share the show pages' frame (docs/show-pages.md). */
export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return <ShowShell>{children}</ShowShell>;
}
