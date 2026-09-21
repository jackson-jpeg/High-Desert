"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog, TextField, Button } from "@/components/win98";
import { useAdminStore } from "@/stores/admin-store";
import { toast } from "@/stores/toast-store";

/**
 * The admin password prompt. Opened only by `hd:admin-prompt`, which the
 * library search box dispatches on a secret input — there is no menu item.
 *
 * It owns its own open/password/error state so typing a password re-renders
 * this dialog, not the whole shell. As with admin mode itself, this is UI
 * gating, not a security boundary (see CLAUDE.md, "Admin Mode").
 */
export function AdminPromptDialog() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("hd:admin-prompt", handler);
    return () => window.removeEventListener("hd:admin-prompt", handler);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setPassword("");
    setError("");
  }, []);

  const handleLogin = useCallback(async () => {
    const ok = await useAdminStore.getState().login(password);
    if (ok) {
      close();
      toast.success("Admin mode enabled");
    } else {
      setError("Wrong password");
    }
  }, [password, close]);

  return (
    <Dialog open={open} onClose={close} title="Admin Access">
      <div className="p-3 flex flex-col gap-2">
        <p className="text-hd-11 text-bevel-dark">Enter the admin password:</p>
        <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }}>
          <TextField
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            placeholder="Password"
            autoFocus
            className="w-full"
          />
          {error && <p className="text-hd-10 text-red-400 mt-1">{error}</p>}
          <div className="flex justify-end gap-2 mt-3">
            <Button size="sm" variant="dark" type="button" onClick={close}>Cancel</Button>
            <Button size="sm" type="submit">OK</Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
