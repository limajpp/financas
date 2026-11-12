/** "Agora não" hides the install card for this long. */
export const INSTALL_HINT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** Where the device remembers when the card was dismissed. */
export const INSTALL_HINT_KEY = "install-hint-dismissed-at";

/**
 * Safari on an iPhone or iPad: the only browser there whose share menu installs the app the way
 * the card explains. Chrome, Firefox and Edge on iOS and in-app browsers say so in the user agent
 * (or lack "Safari"); an iPad in desktop mode reports a Mac with a touch screen.
 */
export function isIosSafari(userAgent: string, maxTouchPoints: number) {
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  const safari =
    /Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo/.test(userAgent);
  return ios && safari;
}

/** Whether the home screen shows the install card. */
export function shouldShowInstallHint(input: {
  userAgent: string;
  maxTouchPoints: number;
  /** Opened from the home screen (`navigator.standalone` or `display-mode: standalone`). */
  standalone: boolean;
  /** When "Agora não" was tapped, in ms, or null. */
  dismissedAt: number | null;
  now: number;
}) {
  if (input.standalone || !isIosSafari(input.userAgent, input.maxTouchPoints)) return false;
  return input.dismissedAt === null || input.now - input.dismissedAt >= INSTALL_HINT_SNOOZE_MS;
}
