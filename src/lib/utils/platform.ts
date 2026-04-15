let _isIOS: boolean | null = null;

export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (_isIOS !== null) return _isIOS;
  _isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  return _isIOS;
}
