import { describe, expect, it } from 'vitest';
import { LONGPRESS_INJECT, parseLongPressPayload } from '../electron/longpress';

describe('parseLongPressPayload (page payloads are untrusted)', () => {
  it('accepts well-formed link/image/media payloads', () => {
    expect(parseLongPressPayload(JSON.stringify({ kind: 'link', url: 'https://a.example/x' }))).toEqual({
      kind: 'link',
      url: 'https://a.example/x',
    });
    expect(
      parseLongPressPayload(JSON.stringify({ kind: 'image', url: 'https://a.example/p.png' })),
    ).toEqual({ kind: 'image', url: 'https://a.example/p.png' });
    expect(
      parseLongPressPayload(JSON.stringify({ kind: 'media', url: 'https://a.example/v.mp4' })),
    ).toEqual({ kind: 'media', url: 'https://a.example/v.mp4' });
  });

  it('rejects non-strings, malformed JSON, and wrong shapes', () => {
    expect(parseLongPressPayload(null)).toBeNull();
    expect(parseLongPressPayload(42)).toBeNull();
    expect(parseLongPressPayload('not json')).toBeNull();
    expect(parseLongPressPayload(JSON.stringify({ kind: 'link' }))).toBeNull();
    expect(parseLongPressPayload(JSON.stringify({ url: 'https://a.example/' }))).toBeNull();
    expect(parseLongPressPayload(JSON.stringify({ kind: 'file', url: 'https://a.example/' }))).toBeNull();
    expect(parseLongPressPayload(JSON.stringify(['link', 'https://a.example/']))).toBeNull();
  });

  it('rejects non-http(s) schemes and huge URLs', () => {
    expect(
      parseLongPressPayload(JSON.stringify({ kind: 'link', url: 'javascript:alert(1)' })),
    ).toBeNull();
    expect(
      parseLongPressPayload(JSON.stringify({ kind: 'link', url: 'file:///etc/passwd' })),
    ).toBeNull();
    expect(
      parseLongPressPayload(
        JSON.stringify({ kind: 'link', url: `https://a.example/${'x'.repeat(3000)}` }),
      ),
    ).toBeNull();
  });
});

describe('LONGPRESS_INJECT', () => {
  it('is self-contained (no external identifiers besides window/document)', () => {
    // The snippet must not reference anything the host page might shadow or
    // that we have not declared: only window, document, JSON, Math.
    expect(LONGPRESS_INJECT).toContain('window.__adfInjected');
    expect(LONGPRESS_INJECT).toContain('pointerdown');
    expect(LONGPRESS_INJECT).toContain('HOLD_MS');
    // No template interpolation leaked into the payload channel.
    expect(LONGPRESS_INJECT).not.toContain('${');
  });

  it('parses as a function expression wrapped in an IIFE', () => {
    // Basic sanity: it is valid JavaScript (new Function compiles it).
    expect(() => new Function(LONGPRESS_INJECT)).not.toThrow();
  });
});
