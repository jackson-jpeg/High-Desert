interface Window {
  umami?: {
    track(eventName: string, data?: Record<string, string | number | boolean>): void;
  };
}
