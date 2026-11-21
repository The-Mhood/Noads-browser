/**
 * Long-press support: hold a link for ~450ms to copy its URL; hold an
 * image/media/object to download it.
 *
 * How it works:
 *  - The page webContents get a minimal preload (pagePreload.ts) exposing
 *    exactly one function: window.__adf.report(payloadString).
 *  - LONGPRESS_INJECT is injected at dom-ready in the main frame. It is
 *    idempotent (flag-guarded) and uses one delegated document listener, so
 *    dynamically-added elements are covered without re-injection per node.
 *  - The payload travels page → main as a JSON string and is re-validated
 *    here (parseLongPressPayload). A page can at worst cause a clipboard
 *    write of an http(s) URL or a user-confirmed save dialog — it cannot
 *    reach Node, IPC beyond one channel, or arbitrary files.
 */

export interface LongPressInfo {
  kind: 'link' | 'image' | 'media';
  url: string;
}

export const LONGPRESS_INJECT = `(function () {
  if (window.__adfInjected) return;
  window.__adfInjected = true;
  var HOLD_MS = 450;
  var MOVE_PX = 6;
  var timer = 0;
  var sx = 0;
  var sy = 0;
  var info = null;
  var suppressUrl = '';
  var suppressUntil = 0;

  function resolve(el) {
    if (!el || !el.closest) return null;
    var a = el.closest('a[href]');
    if (a && a.href) return { kind: 'link', url: a.href };
    var img = el.closest('img');
    if (img && img.src) return { kind: 'image', url: img.src };
    var m = el.closest('video, audio');
    if (m && m.currentSrc) return { kind: 'media', url: m.currentSrc };
    var o = el.closest('object[data], embed[src]');
    if (o) {
      var d = o.getAttribute('data') || o.getAttribute('src');
      if (d) return { kind: 'media', url: d };
    }
    return null;
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    info = resolve(e.target);
    if (!info) return;
    sx = e.clientX;
    sy = e.clientY;
    clearTimeout(timer);
    timer = setTimeout(function () {
      timer = 0;
      var payload = info;
      info = null;
      // Scope suppression to the same link and a short window. An ordinary
      // click or double-click on a different anchor must never be swallowed.
      suppressUrl = payload && payload.url ? payload.url : '';
      suppressUntil = Date.now() + 1200;
      try {
        if (window.__adf && typeof window.__adf.report === 'function') {
          window.__adf.report(JSON.stringify(payload));
        }
      } catch (err) {}
    }, HOLD_MS);
  }, true);

  function cancel(e) {
    if (timer === 0) return;
    var moved =
      e.type === 'pointermove' &&
      (Math.abs(e.clientX - sx) > MOVE_PX || Math.abs(e.clientY - sy) > MOVE_PX);
    if (e.type !== 'pointermove' || moved) {
      clearTimeout(timer);
      timer = 0;
      info = null;
    }
  }
  document.addEventListener('pointermove', cancel, true);
  document.addEventListener('pointerup', cancel, true);
  document.addEventListener('pointercancel', cancel, true);

  // Swallow only the click that follows a completed long-press on the same
  // element, so copying a link does not also navigate to it. Normal anchors,
  // including double-clicks and nested clickable children, are untouched.
  document.addEventListener('click', function (e) {
    if (!suppressUrl) return;
    var clicked = resolve(e.target);
    var sameTarget = clicked && clicked.url === suppressUrl;
    var active = Date.now() < suppressUntil;
    suppressUrl = '';
    suppressUntil = 0;
    if (active && sameTarget) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
})();`;

/**
 * Validate a raw page→main long-press payload. Returns null (→ ignored)
 * for anything malformed: the channel is one-way fire-and-forget.
 */
export function parseLongPressPayload(raw: unknown): LongPressInfo | null {
  if (typeof raw !== 'string' || raw.length > 2048 + 64) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== 'link' && d.kind !== 'image' && d.kind !== 'media') return null;
  if (typeof d.url !== 'string' || d.url.length > 2048) return null;
  try {
    const u = new URL(d.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { kind: d.kind, url: d.url };
}
