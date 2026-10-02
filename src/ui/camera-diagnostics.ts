/**
 * Camera failure diagnostics.
 *
 * When getUserMedia fails, "no camera" is not a useful message — the fix
 * depends entirely on WHY it failed (permission vs no device vs busy vs
 * insecure context). This module gathers the facts and maps each failure
 * to a concrete fix, including Linux/Brave-specific ones.
 */

export interface CameraDiagnostics {
  secureContext: boolean;
  protocol: string;
  mediaDevices: boolean;
  /** Number of videoinput devices, or null when enumeration is unavailable. */
  videoInputs: number | null;
  errorName: string;
  errorMessage: string;
}

export async function gatherCameraDiagnostics(cause: unknown): Promise<CameraDiagnostics> {
  const err = cause as (Error & { name?: string; message?: string }) | null | undefined;
  let videoInputs: number | null = null;
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      const devs = await navigator.mediaDevices.enumerateDevices();
      videoInputs = devs.filter((d) => d.kind === 'videoinput').length;
    }
  } catch {
    /* enumeration itself failed — leave null */
  }
  return {
    secureContext: window.isSecureContext === true,
    protocol: location.protocol,
    mediaDevices: !!navigator.mediaDevices,
    videoInputs,
    errorName: (err && err.name) || 'UnknownError',
    errorMessage: String((err && err.message) || cause || '').slice(0, 220),
  };
}

/** Current camera permission state, for display before/after requesting. */
export async function queryCameraPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const perms = navigator.permissions as unknown as
      | { query?: (q: { name: string }) => Promise<{ state: string }> }
      | undefined;
    if (!perms || typeof perms.query !== 'function') return 'unknown';
    const status = await perms.query({ name: 'camera' });
    const s = status.state;
    return s === 'granted' || s === 'denied' || s === 'prompt' ? s : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** One concrete fix hint per failure shape. Ordered by likelihood on Linux/Brave. */
export function cameraFixHint(d: CameraDiagnostics): string {
  if (!d.mediaDevices || !d.secureContext) {
    return 'This page is not a secure context, so the browser hides the camera API entirely. ' +
      'Download the game file and open it directly in the browser (double-click) — do not play it inside a preview panel.';
  }
  switch (d.errorName) {
    case 'NotAllowedError':
      return 'Permission denied. Brave remembers a Block and will NOT ask again: click the camera/lock icon ' +
        'in the address bar → Camera → Allow, then press Retry. (Also set the shield icon → Fingerprinting to "Allow all".)';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera is visible to the browser. Linux checks: `ls /dev/video*` must list a device; ' +
        'Snap Brave needs `sudo snap connect brave:camera`; Flatpak needs camera access (Flatseal); ' +
        'your user should be in the `video` group. Then fully quit Brave (brave://restart) so it rescans devices.';
    case 'NotReadableError':
      return 'The camera is busy in another app. Quit Zoom / Meet / Teams / Cheese and retry.';
    case 'AbortError':
      return 'The request was aborted — just retry.';
    case 'SecurityError':
      return 'Blocked by page context (iframe permissions). Open the downloaded file directly in the browser.';
    default:
      if (d.videoInputs === 0) {
        return 'The browser sees zero cameras. Check `ls /dev/video*`, snap/flatpak confinement, and restart Brave fully.';
      }
      return 'Unknown camera failure. Copy the diagnostics and send them to the developer.';
  }
}

/** One-line summary for the "copy" button. */
export function cameraDiagnosticsText(d: CameraDiagnostics): string {
  return [
    `secureContext=${d.secureContext}`,
    `protocol=${d.protocol}`,
    `mediaDevices=${d.mediaDevices}`,
    `videoInputs=${d.videoInputs === null ? 'n/a' : d.videoInputs}`,
    `error=${d.errorName}: ${d.errorMessage}`,
    `ua=${navigator.userAgent.slice(0, 120)}`,
  ].join('\n');
}
