package com.noads.browser;

import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.webkit.WebView;

/**
 * TV pointer that lives INSIDE the WebView page (a DOM element), so it is
 * guaranteed to render above page content — overlay views added on top of the
 * WebView's hardware-accelerated surface do not reliably show on Android TV.
 *
 * The D-pad moves a cursor div with smooth accelerating motion; holding a
 * direction scrolls the page faster the longer it's held; double-tap UP jumps
 * to the top, double-tap DOWN to the bottom; DPAD_CENTER/ENTER clicks whatever
 * is under the cursor.
 */
public class TvPointer {

    private static final long FRAME_MS = 16;
    private static final float BASE_SPEED = 12f;   // css px per frame
    private static final float MAX_SPEED = 90f;    // css px per frame held
    private static final long RAMP_MS = 900;
    private static final long DOUBLE_TAP_MS = 350;
    private static final long SCROLL_START_MS = 250;

    private final WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private float x = 200, y = 200;
    private int heldDir = 0;
    private long heldSince = 0;
    private long lastUpTap = 0, lastDownTap = 0;
    private boolean injected = false;

    public TvPointer(WebView web) {
        this.web = web;
    }

    /** Inject the cursor element + driver into the current page. Idempotent. */
    public void inject() {
        web.evaluateJavascript(JS, null);
        injected = true;
    }

    public boolean onKey(int keyCode, KeyEvent event) {
        boolean down = event.getAction() == KeyEvent.ACTION_DOWN;
        long now = System.currentTimeMillis();
        if (!injected) inject();

        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                if (down) eval("noadsClick()");
                return true;
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                if (down) {
                    if (keyCode == KeyEvent.KEYCODE_DPAD_UP) {
                        if (now - lastUpTap < DOUBLE_TAP_MS) { web.scrollTo(0, 0); lastUpTap = 0; return true; }
                        lastUpTap = now;
                    } else if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                        if (now - lastDownTap < DOUBLE_TAP_MS) { eval("window.scrollTo(0, document.body.scrollHeight)"); lastDownTap = 0; return true; }
                        lastDownTap = now;
                    }
                    heldDir = keyCode;
                    heldSince = now;
                    tick();
                } else if (heldDir == keyCode) {
                    heldDir = 0;
                }
                return true;
            default:
                return false;
        }
    }

    private void tick() {
        if (heldDir == 0) return;
        long held = System.currentTimeMillis() - heldSince;
        float t = Math.min(1f, held / (float) RAMP_MS);
        float speed = BASE_SPEED + (MAX_SPEED - BASE_SPEED) * t;
        float dx = 0, dy = 0;
        if (heldDir == KeyEvent.KEYCODE_DPAD_UP) dy = -speed;
        else if (heldDir == KeyEvent.KEYCODE_DPAD_DOWN) dy = speed;
        else if (heldDir == KeyEvent.KEYCODE_DPAD_LEFT) dx = -speed;
        else if (heldDir == KeyEvent.KEYCODE_DPAD_RIGHT) dx = speed;

        x += dx; y += dy;
        if (held > SCROLL_START_MS && (heldDir == KeyEvent.KEYCODE_DPAD_UP || heldDir == KeyEvent.KEYCODE_DPAD_DOWN)) {
            // held against vertical direction: scroll the page too
            int px = (int) (dy * web.getResources().getDisplayMetrics().density);
            web.scrollBy(0, px);
        }
        eval("noadsMove(" + (int) x + "," + (int) y + ")");
        handler.postDelayed(this::tick, FRAME_MS);
    }

    private void eval(String js) {
        web.evaluateJavascript(js, null);
    }

    /** Show the cursor (when chrome shows). */
    public void show() { eval("noadsShow(true)"); }
    /** Hide the cursor (when chrome hides). */
    public void hide() { eval("noadsShow(false)"); }

    // Page-side driver: a bright cursor div + helpers, all namespaced.
    private static final String JS =
        "(function(){"
      + "if(window.__noadsPtr)return;window.__noadsPtr=1;"
      + "var c=document.createElement('div');"
      + "c.id='__noadsCursor';"
      + "c.style.cssText='position:fixed;width:34px;height:34px;z-index:2147483647;"
      + "pointer-events:none;left:200px;top:200px;"
      + "background:no-repeat center/contain url(data:image/svg+xml;utf8,"
      + encodeSvg()
      + ");';"
      + "(document.body||document.documentElement).appendChild(c);"
      + "window.noadsMove=function(nx,ny){c.style.left=nx+'px';c.style.top=ny+'px';};"
      + "window.noadsShow=function(v){c.style.display=v?'block':'none';};"
      + "window.noadsClick=function(){"
      + "var r=c.getBoundingClientRect();"
      + "var el=document.elementFromPoint(r.left+4,r.top+4);"
      + "if(el){el.click();}"
      + "};"
      + "})();";

    private static String encodeSvg() {
        String svg = "<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'>"
            + "<path d='M5 2 L30 17 L18 18.5 L24 31 L19 33 L13 20.5 L5 25 Z' fill='%23000'/>"
            + "<path d='M8 6.5 L26 16.5 L16 17.3 L21 28.5 L18 29.8 L13 18.8 L8 22.5 Z' fill='%23E0332E'/>"
            + "</svg>";
        return svg.replace("#", "%23").replace("'", "%27").replace("<", "%3C").replace(">", "%3E").replace(" ", "%20");
    }
}
