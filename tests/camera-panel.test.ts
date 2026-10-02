/**
 * DOM test for the camera-diagnostics panel (Screens.showCameraDiagnostics).
 * Runs the real production panel code in jsdom — no WebGL, no webcam needed.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { Screens, type ScreenCallbacks } from '../src/ui/screens.ts';
import {
  cameraDiagnosticsText,
  cameraFixHint,
  type CameraDiagnostics,
} from '../src/ui/camera-diagnostics.ts';

function makeScreens(): { screens: Screens; cb: ScreenCallbacks } {
  const root = document.createElement('div');
  root.id = 'screens';
  document.body.appendChild(root);
  const cb = {
    onStart: vi.fn(),
    onResume: vi.fn(),
    onRestart: vi.fn(),
    onQuitToMenu: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenCalibration: vi.fn(),
    onOpenHowTo: vi.fn(),
    onOpenCameraSetup: vi.fn(),
    onCloseOverlay: vi.fn(),
    onCalibrationDone: vi.fn(),
  } satisfies ScreenCallbacks;
  return { screens: new Screens(root, cb), cb };
}

const diag: CameraDiagnostics = {
  secureContext: true,
  protocol: 'file:',
  mediaDevices: true,
  videoInputs: 0,
  errorName: 'NotFoundError',
  errorMessage: 'Requested device not found',
};

describe('showCameraDiagnostics', () => {
  it('renders facts, hint, and three working buttons', () => {
    const { screens } = makeScreens();
    const onRetry = vi.fn();
    const onCopy = vi.fn();
    const onKeyboard = vi.fn();

    screens.showCameraDiagnostics(diag, cameraFixHint(diag), { onRetry, onCopy, onKeyboard });

    const rows: Record<string, string> = {};
    document.querySelectorAll('.diag-table dt').forEach((dt) => {
      rows[dt.textContent ?? ''] = dt.nextElementSibling?.textContent ?? '';
    });
    expect(rows['Error']).toContain('NotFoundError');
    expect(rows['Secure context']).toBe('yes');
    expect(rows['Cameras seen']).toBe('0');
    expect(document.querySelector('.diag-hint')?.textContent).toContain('snap connect brave:camera');

    const actions = [...document.querySelectorAll('[data-action]')].map((b) =>
      b.getAttribute('data-action'),
    );
    expect(actions).toEqual(['cam-retry', 'cam-copy', 'cam-keyboard']);

    (document.querySelector('[data-action="cam-retry"]') as HTMLButtonElement).click();
    (document.querySelector('[data-action="cam-copy"]') as HTMLButtonElement).click();
    (document.querySelector('[data-action="cam-keyboard"]') as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onKeyboard).toHaveBeenCalledTimes(1);

    screens.hideAll();
    expect(document.querySelector('.diag-table')).toBeNull();
  });

  it('cameraDiagnosticsText produces a paste-ready report', () => {
    const text = cameraDiagnosticsText(diag);
    expect(text).toContain('error=NotFoundError');
    expect(text).toContain('videoInputs=0');
    expect(text).toContain('protocol=file:');
  });
});
