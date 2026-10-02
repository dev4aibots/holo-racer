/**
 * Unit tests for camera failure diagnostics (src/ui/camera-diagnostics.ts).
 * These are pure-logic tests: no DOM, no webcam needed.
 */
import { describe, expect, it } from 'vitest';
import { cameraFixHint, type CameraDiagnostics } from '../src/ui/camera-diagnostics.ts';

const base: CameraDiagnostics = {
  secureContext: true,
  protocol: 'file:',
  mediaDevices: true,
  videoInputs: 1,
  errorName: 'NotFoundError',
  errorMessage: 'Requested device not found',
};

describe('cameraFixHint', () => {
  it('flags insecure context / missing mediaDevices first', () => {
    const hint = cameraFixHint({ ...base, mediaDevices: false, secureContext: false });
    expect(hint).toMatch(/secure context/i);
    expect(hint).toMatch(/download/i);
  });

  it('gives the snap/flatpak fix for NotFoundError', () => {
    const hint = cameraFixHint(base);
    expect(hint).toMatch(/snap connect brave:camera/);
    expect(hint).toMatch(/\/dev\/video/);
  });

  it('gives the same device fix for OverconstrainedError', () => {
    const hint = cameraFixHint({ ...base, errorName: 'OverconstrainedError' });
    expect(hint).toMatch(/snap connect brave:camera/);
  });

  it('tells the user to allow the permission for NotAllowedError', () => {
    const hint = cameraFixHint({ ...base, errorName: 'NotAllowedError' });
    expect(hint).toMatch(/Allow/);
    expect(hint).toMatch(/Brave/);
  });

  it('blames the busy camera for NotReadableError', () => {
    const hint = cameraFixHint({ ...base, errorName: 'NotReadableError' });
    expect(hint).toMatch(/busy|another app/i);
  });

  it('covers zero visible cameras on unknown errors', () => {
    const hint = cameraFixHint({ ...base, errorName: 'TypeError', videoInputs: 0 });
    expect(hint).toMatch(/zero cameras/);
  });

  it('falls back to a generic message otherwise', () => {
    const hint = cameraFixHint({ ...base, errorName: 'SomeWeirdError' });
    expect(hint).toMatch(/diagnostics/i);
  });
});
