"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Dialog } from "@/components/win98/Dialog";
import { Button } from "@/components/win98/Button";
import { pauseEngine } from "@/audio/engine";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { notFoundMessage, runCommand, type RunResult } from "./start-menu";
import { Win98Icon } from "./Win98Icon";

/**
 * The Start menu's own dialogs in the Win98 look: Run, Shut Down and Help,
 * plus the screen Shut Down ends on. Copy has no em dashes (CLAUDE.md).
 */

export function RunDialog({ onClose, onResult }: { onClose: () => void; onResult: (r: RunResult) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = runCommand(value);
    if (r.kind === "empty") return;
    if (r.kind === "not-found") {
      setError(notFoundMessage(r.name));
      return;
    }
    onResult(r);
  };

  return (
    <Dialog open onClose={onClose} title="Run" width="380px">
      <form onSubmit={submit} className="flex flex-col gap-3 p-3" data-testid="w98-run">
        <div className="flex items-start gap-3">
          <Win98Icon name="run" size={32} className="flex-shrink-0" />
          <p className="text-hd-12">
            Type the name of a program, and High Desert will open it for you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={inputId} className="text-hd-12">
            <span className="underline underline-offset-2">O</span>pen:
          </label>
          <input
            id={inputId}
            value={value}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            data-testid="w98-run-input"
            className="flex-1 min-w-0 w98-inset-dark bg-inset-well px-1 py-[3px] min-h-touch md:min-h-0 text-hd-12 outline-none"
          />
        </div>
        {error && (
          <p role="alert" className="text-hd-12 text-red-400" data-testid="w98-run-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="submit" variant="dark" data-testid="w98-run-ok">
            OK
          </Button>
          <Button type="button" variant="dark" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type ShutChoice = "standby" | "shutdown" | "restart";

const SHUT_CHOICES: { id: ShutChoice; label: string }[] = [
  { id: "standby", label: "Stand by (pause the show)" },
  { id: "shutdown", label: "Shut down" },
  { id: "restart", label: "Restart" },
];

export function ShutDownDialog({ onClose, onShutDown }: { onClose: () => void; onShutDown: () => void }) {
  const [choice, setChoice] = useState<ShutChoice>("shutdown");
  const name = useId();

  const ok = () => {
    if (choice === "standby") {
      pauseEngine();
      onClose();
    } else if (choice === "shutdown") {
      pauseEngine();
      onShutDown();
    } else {
      window.location.reload();
    }
  };

  return (
    <Dialog open onClose={onClose} title="Shut Down High Desert" width="360px">
      <div className="flex flex-col gap-3 p-3" data-testid="w98-shutdown">
        <div className="flex items-start gap-3">
          <Win98Icon name="shutdown" size={32} className="flex-shrink-0" />
          <fieldset className="flex flex-col gap-1">
            <legend className="text-hd-12 mb-1">What do you want High Desert to do?</legend>
            {SHUT_CHOICES.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-hd-12 min-h-touch md:min-h-0 cursor-pointer">
                <input
                  type="radio"
                  name={name}
                  value={c.id}
                  checked={choice === c.id}
                  onChange={() => setChoice(c.id)}
                  data-testid={`w98-shutdown-${c.id}`}
                />
                {c.label}
              </label>
            ))}
          </fieldset>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="dark" onClick={ok} data-testid="w98-shutdown-ok">
            OK
          </Button>
          <Button variant="dark" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** The screen a Shut Down ends on. Any key or tap brings the station back. */
export function SafeToTurnOff({ onWake }: { onWake: () => void }) {
  const { ref, onKeyDown } = useFocusTrap({ active: true, onEscape: onWake });
  const woke = useRef(false);
  const wake = () => {
    if (woke.current) return;
    woke.current = true;
    onWake();
  };
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [ref]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="High Desert has shut down"
      tabIndex={-1}
      onKeyDown={(e) => {
        onKeyDown(e);
        if (e.key !== "Tab") wake();
      }}
      onClick={wake}
      data-testid="w98-safe-off"
      className="hd-w98-safe-off fixed inset-0 z-[400] flex flex-col items-center justify-center gap-4 p-6 text-center cursor-pointer outline-none"
    >
      <p className="w98-font text-hd-h3 md:text-hd-h2">It&apos;s now safe to turn off your radio.</p>
      <p className="w98-font text-hd-caption">Press any key or tap to tune back in.</p>
    </div>
  );
}

const HELP_TOPICS: { id: string; title: string; body: string }[] = [
  {
    id: "play",
    title: "Playing a show",
    body: "Open the Library from the Start menu, then double-click a show (or tap it on a phone and press Play). The Winamp window at the bottom plays it. PL opens the queue.",
  },
  {
    id: "live",
    title: "High Desert Live",
    body: "Live is one station everyone hears at the same second, around the clock. Tune in from the Live window. While you are tuned in, the station sets the position and the speed.",
  },
  {
    id: "lines",
    title: "The phone lines",
    body: "The Phone Lines window is the station's chat. Type in the box at the bottom and press Call in. Use the Edit menu to change your name or where you are calling from, or to report a call.",
  },
  {
    id: "dial",
    title: "The dial",
    body: "Dial, in the Start menu, tunes through the Library by year, the way the old radio dial did.",
  },
  {
    id: "keys",
    title: "Keyboard",
    body: "Ctrl+Esc opens the Start menu. Space plays and pauses, N and P skip, M mutes. Press ? for every shortcut.",
  },
  {
    id: "rumour",
    title: "A rumour",
    body: "Some callers say there is a hole in this desktop. Nobody has found the bottom of it.",
  },
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [topic, setTopic] = useState(HELP_TOPICS[0].id);
  const current = HELP_TOPICS.find((t) => t.id === topic) ?? HELP_TOPICS[0];
  return (
    <Dialog open onClose={onClose} title="High Desert Help" width="520px">
      <div className="flex flex-col md:flex-row gap-2 p-2" data-testid="w98-help">
        <ul
          role="listbox"
          aria-label="Help topics"
          className="w98-inset-dark bg-inset-well md:w-[180px] flex-shrink-0 p-[2px] flex flex-col"
        >
          {HELP_TOPICS.map((t) => (
            <li
              key={t.id}
              role="option"
              aria-selected={t.id === topic}
              tabIndex={0}
              onClick={() => setTopic(t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setTopic(t.id);
                }
              }}
              className="hd-w98-list-item flex items-center gap-2 px-1 py-[3px] min-h-touch md:min-h-0 text-hd-12 cursor-pointer"
            >
              <Win98Icon name="help" size={16} className="flex-shrink-0" />
              {t.title}
            </li>
          ))}
        </ul>
        <div className="flex-1 w98-inset-dark bg-inset-well p-3 min-h-[160px]">
          <h3 className="text-hd-title font-bold mb-2">{current.title}</h3>
          <p className="text-hd-12 leading-relaxed">{current.body}</p>
        </div>
      </div>
      <div className="flex justify-end p-2 pt-0">
        <Button variant="dark" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
