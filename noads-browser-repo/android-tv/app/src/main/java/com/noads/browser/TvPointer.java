package com.noads.browser;

import android.animation.ObjectAnimator;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.ImageView;

/**
 * Virtual TV pointer: a floating cursor driven by the D-pad with smooth,
 * accelerating movement. It replaces raw focus-tabbing (which is stressful on
 * a remote) with a free-moving pointer that:
 *
 *  - glides across the screen (linear-interpolated, not jumpy),
 *  - accelerates the longer a direction is held,
 *  - scrolls the page when held against a direction (speed ramps up),
 *  - double-tapping UP jumps to the very top, double-tapping DOWN to the bottom,
 *  - clicks whatever is under it when DPAD_CENTER/ENTER is pressed,
 *  - fades out with the chrome and back in when the chrome returns.
 */
public class TvPointer {

    private static final long FRAME_MS = 16;          // ~60 fps
    private static final float BASE_SPEED = 14f;       // dp per frame at first press
    private static final float MAX_SPEED = 70f;        // dp per frame when fully held
    private static final long RAMP_MS = 900;           // ms to reach max speed
    private static final long DOUBLE_TAP_MS = 350;     // window for double-tap
    private static final long SCROLL_START_MS = 250;   // hold this long to start scrolling

    private final ViewGroup root;
    private final WebView web;
    private final ImageView cursor;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private float x = -1, y = -1;              // current pointer position (px), -1 = centered
    private float targetX, targetY;
    private boolean running = false;
    private boolean visible = true;

    // held-direction state
    private int heldDir = 0;                    // KeyEvent dir or 0
    private long heldSince = 0;
    private long lastUpTap = 0, lastDownTap = 0;

    private final Runnable frame = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            step();
            handler.postDelayed(this, FRAME_MS);
        }
    };

    public TvPointer(ViewGroup root, WebView web) {
        this.root = root;
        this.web = web;
        cursor = new ImageView(root.getContext());
        cursor.setImageResource(R.drawable.cursor);
        int size = (int) (28 * root.getResources().getDisplayMetrics().density);
        // The cursor floats above the WebView. Use the window decor view (the
        // true topmost container) so the WebView can never cover it.
        cursor.setLayoutParams(new ViewGroup.LayoutParams(size, size));
        cursor.setVisibility(View.INVISIBLE);
        cursor.setClickable(false);
        cursor.setFocusable(false);
        cursor.setElevation(100000f);
        root.addView(cursor);
    }

    /** Show/hide the pointer with the chrome (header). */
    public void setChromeVisible(boolean chromeVisible) {
        visible = chromeVisible;
        setCursorVisible(chromeVisible);
        if (chromeVisible && x < 0) center();
    }

    public void center() {
        x = root.getWidth() / 2f;
        y = root.getHeight() / 2f;
        targetX = x;
        targetY = y;
        place();
        setCursorVisible(visible);
        android.util.Log.i("TvPointer", "center x=" + x + " y=" + y + " rootW=" + root.getWidth() + " visible=" + visible);
    }

    private void setCursorVisible(boolean show) {
        cursor.setVisibility(show ? View.VISIBLE : View.INVISIBLE);
        if (show) cursor.bringToFront();
    }

    private void place() {
        // Arrow cursor: the tip is the top-left of the drawable, so anchor the
        // cursor's top-left corner to the pointer position (not the center).
        cursor.setTranslationX(x);
        cursor.setTranslationY(y);
    }

    private void step() {
        // ease toward target for smooth (non-static) movement
        x += (targetX - x) * 0.35f;
        y += (targetY - y) * 0.35f;
        place();
    }

    private void start() {
        if (!running) {
            running = true;
            handler.post(frame);
        }
    }

    /** Current held speed in dp/frame, ramping up with hold time. */
    private float heldSpeed() {
        long held = System.currentTimeMillis() - heldSince;
        float t = Math.min(1f, held / (float) RAMP_MS);
        return BASE_SPEED + (MAX_SPEED - BASE_SPEED) * t;
    }

    private void scroll(int dir) {
        float speed = heldSpeed();
        float density = root.getResources().getDisplayMetrics().density;
        int px = (int) (speed * density);
        if (dir == KeyEvent.KEYCODE_DPAD_UP) web.scrollBy(0, -px);
        else if (dir == KeyEvent.KEYCODE_DPAD_DOWN) web.scrollBy(0, px);
        else if (dir == KeyEvent.KEYCODE_DPAD_LEFT) web.scrollBy(-px, 0);
        else if (dir == KeyEvent.KEYCODE_DPAD_RIGHT) web.scrollBy(px, 0);
    }

    private void click() {
        if (x < 0) center();
        long now = android.os.SystemClock.uptimeMillis();
        // Dispatch a tap at the pointer location into the WebView.
        web.dispatchTouchEvent(android.view.MotionEvent.obtain(now, now,
                android.view.MotionEvent.ACTION_DOWN, x, y, 0));
        web.dispatchTouchEvent(android.view.MotionEvent.obtain(now, now + 60,
                android.view.MotionEvent.ACTION_UP, x, y, 0));
    }

    /** Feed a D-pad event; returns true if the pointer consumed it. */
    public boolean onKey(int keyCode, KeyEvent event) {
        if (!visible) return false;
        boolean down = event.getAction() == KeyEvent.ACTION_DOWN;
        long now = System.currentTimeMillis();

        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                if (down) click();
                return true;

            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_DPAD_LEFT:
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                if (down) {
                    if (x < 0) center();
                    // double-tap detection on vertical axis
                    if (keyCode == KeyEvent.KEYCODE_DPAD_UP) {
                        if (now - lastUpTap < DOUBLE_TAP_MS) { web.scrollTo(0, 0); lastUpTap = 0; return true; }
                        lastUpTap = now;
                    } else if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                        if (now - lastDownTap < DOUBLE_TAP_MS) { web.scrollTo(0, Integer.MAX_VALUE / 2); lastDownTap = 0; return true; }
                        lastDownTap = now;
                    }
                    heldDir = keyCode;
                    heldSince = now;
                    start();
                    moveTarget(keyCode);
                } else {
                    if (heldDir == keyCode) heldDir = 0;
                }
                // keep stepping while held (for scroll ramp)
                if (heldDir != 0) handler.postDelayed(this::heldTick, FRAME_MS);
                return true;
            default:
                return false;
        }
    }

    private void heldTick() {
        if (heldDir == 0) return;
        long held = System.currentTimeMillis() - heldSince;
        if (held > SCROLL_START_MS) {
            scroll(heldDir);
        } else {
            moveTarget(heldDir);
        }
        step();
        if (heldDir != 0) handler.postDelayed(this::heldTick, FRAME_MS);
    }

    private void moveTarget(int dir) {
        float density = root.getResources().getDisplayMetrics().density;
        float step = heldSpeed() * density;
        if (dir == KeyEvent.KEYCODE_DPAD_UP) targetY -= step;
        else if (dir == KeyEvent.KEYCODE_DPAD_DOWN) targetY += step;
        else if (dir == KeyEvent.KEYCODE_DPAD_LEFT) targetX -= step;
        else if (dir == KeyEvent.KEYCODE_DPAD_RIGHT) targetX += step;
        targetX = Math.max(0, Math.min(root.getWidth(), targetX));
        targetY = Math.max(0, Math.min(root.getHeight(), targetY));
    }
}
