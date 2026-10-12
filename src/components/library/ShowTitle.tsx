import { cn } from "@/lib/utils/cn";
import { splitShowTitle } from "@/lib/live/format";

/**
 * A show's title where a phone truncates it (2026-10-11).
 *
 * Every catalog title is "Show - Episode" ("Midnight in the Desert - Alien
 * Experimentation on Humans"), so at 390 px the line read "Midnight in the
 * Desert - Alien Experi…" on every card: the show's name ate the room and the
 * episode, the part that tells two rows apart, was cut. The show goes in a
 * small kicker and the episode gets the line (`splitShowTitle`, the same split
 * the Live studio uses). A title with no " - " is all episode.
 */

const KICKER = "text-hd-micro uppercase tracking-wider text-bevel-dark truncate block leading-tight";

/** The show's name as a kicker, or nothing when the title has no show part. */
export function ShowKicker({ title, className }: { title: string; className?: string }) {
  const { show } = splitShowTitle(title);
  if (!show) return null;
  return (
    <span data-show-kicker="" className={cn(KICKER, className)} title={title}>
      {show}
    </span>
  );
}

/** The episode part alone, truncated, with the full title on hover. */
export function ShowEpisode({ title, className }: { title: string; className?: string }) {
  const { episode } = splitShowTitle(title);
  return (
    <span data-show-episode="" className={cn("truncate block min-w-0", className)} title={title}>
      {episode}
    </span>
  );
}

/** Kicker over episode. `className` styles the episode line (size, colour, weight). */
export function ShowTitle({
  title,
  className,
  kickerClassName,
  wrapperClassName,
}: {
  title: string;
  className?: string;
  kickerClassName?: string;
  wrapperClassName?: string;
}) {
  return (
    <span className={cn("flex flex-col min-w-0", wrapperClassName)}>
      <ShowKicker title={title} className={kickerClassName} />
      <ShowEpisode title={title} className={className} />
    </span>
  );
}
