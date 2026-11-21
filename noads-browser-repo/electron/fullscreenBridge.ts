/**
 * Main-world fallback for players whose fullscreen button uses a custom
 * wrapper or does not reliably produce Electron's fullscreen event.
 *
 * It only reacts to high-confidence player controls whose accessible label,
 * title, id, class, or visible text describes fullscreen/maximize/expand
 * behavior. This covers custom controls such as Cinewave's "MAXIMIZE PLAYER"
 * without hijacking ordinary page buttons. The page still owns its player;
 * the bridge reports intent so main can present the page in its dedicated
 * fullscreen window. It never seeks or replaces media.
 */
export const FULLSCREEN_BRIDGE_INJECT = `(function () {
  if (window.__noadsFullscreenBridge) return;
  window.__noadsFullscreenBridge = true;

  function report(entered) {
    try {
      if (window.__adf && typeof window.__adf.reportFullscreenState === 'function') {
        window.__adf.reportFullscreenState(Boolean(entered));
      } else if (window !== window.top && window.top && typeof window.top.postMessage === 'function') {
        // A player can live in a cross-origin iframe without its own preload.
        // Relay the user-activated request to the top frame, where __adf is
        // available and can safely send the signal to Electron main.
        window.top.postMessage({ __noadsFullscreenBridge: true, entered: Boolean(entered) }, '*');
      }
    } catch (e) {
      /* the page may be tearing down */
    }
  }

  function state() {
    var video = document.querySelector('video');
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement ||
      (video && video.webkitDisplayingFullscreen));
  }

  function labelOf(el) {
    return ((el.getAttribute('aria-label') || '') + ' ' +
      (el.getAttribute('title') || '') + ' ' +
      (el.id || '') + ' ' +
      (typeof el.className === 'string' ? el.className : '') + ' ' +
      (el.textContent || '')).toLowerCase();
  }

  function isFullscreenLabel(label) {
    return /full\\s*-?\\s*screen|fullscreen|(?:maxi(?:mize|mise)|expand|enlarge)\\s+(?:the\\s+)?(?:player|video|screen)|(?:player|video)\\s+(?:maxi(?:mize|mise)|expand|enlarge)|(?:theater|theatre)\\s+mode/.test(label);
  }

  function fullscreenControl(target) {
    if (!target || typeof target.closest !== 'function') return null;
    var el = target.closest(
      'button,[role="button"],[aria-label],[title],[class*="fullscreen" i],[id*="fullscreen" i],[class*="maximize" i],[id*="maximize" i],[class*="expand" i],[id*="expand" i]'
    );
    if (!el) return null;
    return isFullscreenLabel(labelOf(el)) ? el : null;
  }

  function isExitControl(el) {
    return /exit|leave|close|compress|shrink|collapse|mini\\s*-?\\s*mize|mini\\s*-?\\s*mise/.test(labelOf(el));
  }

  function requestDocumentFullscreen() {
    if (state()) return;
    var video = document.querySelector('video');
    var target = video && (video.requestFullscreen || video.webkitRequestFullscreen)
      ? video
      : document.documentElement;
    var requestMethod = target && (target.requestFullscreen || target.webkitRequestFullscreen);
    if (!requestMethod) return;
    try {
      var request = requestMethod.call(target);
      if (request && typeof request.catch === 'function') {
        request.catch(function () { report(false); });
      }
    } catch (e) {
      report(false);
      /* The page may reject programmatic fullscreen; main still remains inline. */
    }
  }

  document.addEventListener('fullscreenchange', function () { report(state()); }, true);
  document.addEventListener('webkitfullscreenchange', function () { report(state()); }, true);
  window.addEventListener('message', function (event) {
    if (window !== window.top) return;
    var data = event && event.data;
    if (data && data.__noadsFullscreenBridge === true) {
      report(Boolean(data.entered));
    }
  }, true);
  document.addEventListener('click', function (event) {
    var control = fullscreenControl(event.target);
    if (!control) return;
    var exiting = isExitControl(control) || state();
    if (exiting) {
      // Close the dedicated presentation immediately for custom players that
      // never update document.fullscreenElement. If the page's own handler
      // really did enter/keep native fullscreen, reconcile that result after
      // its click handler has run.
      report(false);
      setTimeout(function () { if (state()) report(true); }, 0);
      return;
    }

    // Report immediately while the click still has user activation. The
    // player's own handler runs afterward; if it does not request fullscreen,
    // request fullscreen for the document as a safe fallback.
    report(true);
    requestDocumentFullscreen();
  }, true);

  // Double-clicking a video is a common native-player fullscreen gesture. It
  // is high confidence because the target must be a video element; ordinary
  // page double-clicks are untouched.
  document.addEventListener('dblclick', function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function' || !target.closest('video')) return;
    if (state()) {
      report(false);
      setTimeout(function () { if (state()) report(true); }, 0);
      return;
    }
    report(true);
    requestDocumentFullscreen();
  }, true);
})();`;
