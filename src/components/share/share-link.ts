import { toast } from "@/stores/toast-store";

/**
 * Hand a link to the share sheet, or copy it where there is none (or the sheet
 * failed for a reason other than the listener closing it). Called inside the
 * tap: nothing is awaited before `navigator.share`, which needs the gesture.
 */
export async function shareLink(
  { title, text, url }: { title: string; text: string; url: string },
  copied = "Link copied",
): Promise<"shared" | "copied" | "cancelled" | "shown"> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return "cancelled";
      // NotAllowedError and the like: fall through to the clipboard.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success(copied);
    return "copied";
  } catch {
    // No clipboard either (an insecure context, a refusal): show it to copy by hand.
    toast.info(url);
    return "shown";
  }
}
