/**
 * Ref-counted body scroll lock for overlays.
 * Multiple overlays can call lockScroll/unlockScroll without fighting.
 */
let lockCount = 0;
let savedOverflow = "";

export function lockScroll() {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount++;
}

export function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow;
  }
}
