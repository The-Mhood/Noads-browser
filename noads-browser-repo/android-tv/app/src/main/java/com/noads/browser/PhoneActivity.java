package com.noads.browser;

import android.os.Bundle;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.view.View;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.TextView;

/** Touch-first phone/tablet front end. */
public class PhoneActivity extends BrowserActivity {

    private EditText address;
    private TextView shieldCount;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_phone);

        address = findViewById(R.id.address);
        shieldCount = findViewById(R.id.shield_count);
        WebView webView = findViewById(R.id.web);
        attachBrowser(webView, findViewById(R.id.chrome_bar));

        findViewById(R.id.btn_back).setOnClickListener(v -> {
            if (web.canGoBack()) web.goBack();
        });
        findViewById(R.id.btn_forward).setOnClickListener(v -> {
            if (web.canGoForward()) web.goForward();
        });
        findViewById(R.id.btn_reload).setOnClickListener(v -> web.reload());
        findViewById(R.id.btn_home).setOnClickListener(v -> showHome());
        findViewById(R.id.btn_go).setOnClickListener(v -> submitAddress());

        address.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_SEARCH) {
                submitAddress();
                return true;
            }
            return false;
        });

        showHome();
    }

    private void submitAddress() {
        navigate(address.getText().toString());
        InputMethodManager imm =
                (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(address.getWindowToken(), 0);
        web.requestFocus();
    }

    private void showHome() {
        navigate("https://duckduckgo.com");
    }

    @Override
    protected void onBlockedCountChanged(int count) {
        runOnUiThread(() -> shieldCount.setText(getString(R.string.blocked_count, count)));
    }

    @Override
    protected void onLocationChanged(String url) {
        String shown = url == null ? "" : url.replaceFirst("^https?://", "");
        runOnUiThread(() -> address.setText(shown));
    }
}
