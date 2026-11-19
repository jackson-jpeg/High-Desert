import { ShowShell } from "@/components/shows/ShowShell";

/** The privacy page: the show pages' frame (docs/privacy.md). */
export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <ShowShell>{children}</ShowShell>;
}
