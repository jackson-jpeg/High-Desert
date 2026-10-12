import type { Metadata } from "next";
import { LookPicker } from "./LookPicker";

export const metadata: Metadata = {
  title: "Look",
  robots: { index: false, follow: false },
  alternates: { canonical: "/look" },
};

/** The owner's look switcher (docs/looks.md). Useless to anyone else: the
 *  switch is checked by the server against the admin sign-in. */
export default function LookPage() {
  return (
    <main className="hd-look-page min-h-dvh flex items-center justify-center p-4 bg-midnight text-desktop-gray">
      <LookPicker />
    </main>
  );
}
