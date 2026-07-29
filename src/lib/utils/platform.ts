let _isIOS: boolean | null = null;

export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (_isIOS !== null) return _isIOS;
  _isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  return _isIOS;
}

/** The buckets `playback_failures.ua_class` accepts. */
export type UaClass =
  | "ios-safari"
  | "ios-pwa"
  | "android-chrome"
  | "desktop-safari"
  | "desktop-firefox"
  | "desktop-chromium"
  | "other";

/**
 * A coarse platform bucket for failure telemetry.
 *
 * Deliberately not the raw user-agent string. The question this data answers is
 * "is this an iOS media-stack problem or does it happen everywhere", and a
 * seven-value enum answers it without storing something that helps identify
 * anyone. Whatever is not needed is not collected.
 */
export function uaClass(): UaClass {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;

  if (isIOSDevice()) {
    // Installed PWAs run standalone; the media stack is the same but the
    // lifecycle (and so the restore path) is not.
    const standalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      (typeof matchMedia === "function" &&
        matchMedia("(display-mode: standalone)").matches);
    return standalone ? "ios-pwa" : "ios-safari";
  }

  if (/Android/.test(ua)) return "android-chrome";
  // Order matters: Chrome's UA contains "Safari", Edge's contains "Chrome".
  if (/Firefox\//.test(ua)) return "desktop-firefox";
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return "desktop-chromium";
  if (/Safari\//.test(ua)) return "desktop-safari";
  return "other";
}
