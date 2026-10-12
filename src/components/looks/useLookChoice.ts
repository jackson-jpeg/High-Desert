"use client";

import { useCallback, useState } from "react";
import { useLook } from "@/hooks/useLook";
import { chooseLook } from "@/lib/look/choice";
import type { Look } from "@/lib/look/look";

/**
 * The Display setting's state, shared by Win98's Display Properties and
 * Night's chooser: the look on screen, the one picked, and applying it
 * (src/lib/look/choice.ts: cookie, then reload). Applying the look already on
 * screen does nothing.
 */
export function useLookChoice() {
  const current = useLook();
  const [choice, setChoice] = useState<Look>(current);
  const changed = choice !== current;
  const apply = useCallback(() => {
    if (choice !== current) chooseLook(choice);
  }, [choice, current]);
  return { current, choice, setChoice, changed, apply };
}
