package com.noads.browser;

import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

/**
 * 10-foot television front end driven by a virtual pointer (TvPointer).
 * The D-pad moves a smooth on-screen cursor; DPAD_CENTER clicks. The header
 * auto-hides after a few seconds of inactivity and the pointer hides with it,
 * reappearing the moment any direction is pressed. Holding a direction scrolls
 * the page with accelerating speed; double-tap UP jumps to the top, double-tap
 * DOWN to the bottom.
 */
public class TvActivity extends BrowserActivity {

    private static final long CHROME_AUTOHIDE_MS = 4000;

    private TextView addressLabel;
    private TextView shieldCount;
    private View topBar;
    private TvPointer pointer;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean chromeVisible = true;

    private final Runnable hideChromeTask = this::hideChrome;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_tv);

        addressLabel = findViewById(R.id.tv_address);
        shieldCount = findViewById(R.id.tv_shield_count);
        topBar = findViewById(R.id.tv_top_bar);
        WebView webView = findViewById(R.id.tv_web);
        attachBrowser(webView, topBar);

        pointer = new TvPointer((ViewGroup) findViewById(android.R.id.content), webView);
        pointer.setChromeVisible(true);
        pointer.center();

        wireButton(R.id.tv_btn_back, v -> { if (web.canGoBack()) web.goBack(); });
        wireButton(R.id.tv_btn_forward, v -> { if (web.canGoForward()) web.goForward(); });
        wireButton(R.id.tv_btn_reload, v -> web.reload());
        wireButton(R.id.tv_btn_home, v -> navigate("https://duckduckgo.com"));
        wireButton(R.id.tv_btn_address, v -> showAddressDialog());

        scheduleChromeHide();
        navigate("https://duckduckgo.com");
    }

    private void wireButton(int id, View.OnClickListener listener) {
        Button b = findViewById(id);
        b.setFocusable(true);
        b.setOnClickListener(listener);
    }

    private void scheduleChromeHide() {
        handler.removeCallbacks(hideChromeTask);
        handler.postDelayed(hideChromeTask, CHROME_AUTOHIDE_MS);
    }

    private void hideChrome() {
        if (!chromeVisible) return;
        chromeVisible = false;
        topBar.animate().alpha(0f).setDuration(250).withEndAction(() -> topBar.setVisibility(View.GONE));
        pointer.setChromeVisible(false);
    }

    private void showChrome() {
        if (chromeVisible) { scheduleChromeHide(); return; }
        chromeVisible = true;
        topBar.setVisibility(View.VISIBLE);
        topBar.animate().alpha(1f).setDuration(180);
        pointer.setChromeVisible(true);
        scheduleChromeHide();
    }

    private void showAddressDialog() {
        final EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint(R.string.address_hint);
        input.setText(addressLabel.getText());
        input.setSelectAllOnFocus(true);
        new AlertDialog.Builder(this)
                .setTitle(R.string.address_dialog_title)
                .setView(input)
                .setPositiveButton(R.string.go, (d, w) -> navigate(input.getText().toString()))
                .setNegativeButton(android.R.string.cancel, null)
                .show();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Any D-pad press wakes the chrome and feeds the pointer.
        if (isDpad(keyCode)) {
            showChrome();
            if (pointer != null && pointer.onKey(keyCode, event)) return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (isDpad(keyCode) && pointer != null && pointer.onKey(keyCode, event)) return true;
        return super.onKeyUp(keyCode, event);
    }

    private boolean isDpad(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_UP
                || keyCode == KeyEvent.KEYCODE_DPAD_DOWN
                || keyCode == KeyEvent.KEYCODE_DPAD_LEFT
                || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
                || keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                || keyCode == KeyEvent.KEYCODE_ENTER;
    }

    @Override
    protected void onBlockedCountChanged(int count) {
        runOnUiThread(() -> shieldCount.setText(getString(R.string.blocked_count, count)));
    }

    @Override
    protected void onLocationChanged(String url) {
        String shown = url == null ? "" : url.replaceFirst("^https?://", "");
        runOnUiThread(() -> addressLabel.setText(shown));
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
