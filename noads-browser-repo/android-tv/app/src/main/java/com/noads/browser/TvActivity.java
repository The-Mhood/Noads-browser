package com.noads.browser;

import android.app.AlertDialog;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

/**
 * 10-foot television front end. Everything is reachable with a D-pad remote:
 * buttons are focusable, the WebView scrolls with the directional pad, and
 * address entry goes through a dialog that brings up the leanback on-screen
 * keyboard. No touchscreen required.
 */
public class TvActivity extends BrowserActivity {

    private TextView addressLabel;
    private TextView shieldCount;
    private View topBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_tv);

        addressLabel = findViewById(R.id.tv_address);
        shieldCount = findViewById(R.id.tv_shield_count);
        topBar = findViewById(R.id.tv_top_bar);
        WebView webView = findViewById(R.id.tv_web);
        attachBrowser(webView, topBar);

        wireButton(R.id.tv_btn_back, v -> {
            if (web.canGoBack()) web.goBack();
        });
        wireButton(R.id.tv_btn_forward, v -> {
            if (web.canGoForward()) web.goForward();
        });
        wireButton(R.id.tv_btn_reload, v -> web.reload());
        wireButton(R.id.tv_btn_home, v -> navigate("https://duckduckgo.com"));
        wireButton(R.id.tv_btn_address, v -> showAddressDialog());

        navigate("https://duckduckgo.com");
    }

    private void wireButton(int id, View.OnClickListener listener) {
        Button b = findViewById(id);
        b.setFocusable(true);
        b.setOnClickListener(listener);
    }

    /** Remote-friendly URL entry: a dialog with an EditText; Android TV shows
     *  its leanback on-screen keyboard automatically. */
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
        // Keep DPAD focus usable: when nothing in the top bar is focused and
        // the user presses UP, return focus to the toolbar.
        if (keyCode == KeyEvent.KEYCODE_DPAD_UP && web != null && web.hasFocus()
                && !web.canScrollVertically(-1)) {
            findViewById(R.id.tv_btn_address).requestFocus();
            return true;
        }
        return super.onKeyDown(keyCode, event);
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
}
