package com.noads.browser.tv;

import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Generic Android TV shell for Noads Browser.
 *
 * This deliberately uses the system WebView rather than Electron, because
 * Electron is not an Android runtime. The browser chrome is native TV UI and
 * the active tab is a WebView below it. The toolbar remains visible when a
 * page asks for HTML5/video fullscreen; the WebView custom view is placed in
 * the page area rather than replacing the whole Activity.
 */
public final class MainActivity extends android.app.Activity {
    private static final int BG = Color.rgb(11, 14, 19);
    private static final int TOOLBAR = Color.rgb(14, 18, 25);
    private static final int FIELD = Color.rgb(22, 28, 38);
    private static final int BORDER = Color.rgb(47, 59, 78);
    private static final int TEXT = Color.rgb(232, 237, 244);
    private static final int MUTED = Color.rgb(139, 152, 171);
    private static final int ACCENT = Color.rgb(124, 92, 255);
    private static final String HOME_URL = "https://noads.local/";
    private static final int MAX_TABS = 8;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ArrayList<BrowserTab> tabs = new ArrayList<>();
    private final Set<String> blockedDomains = new HashSet<>();

    private LinearLayout tabStrip;
    private FrameLayout pageContainer;
    private EditText addressBar;
    private ProgressBar progressBar;
    private TextView shieldButton;
    private BrowserTab activeTab;
    private int nextTabId = 1;
    private boolean blockingEnabled = true;
    private int blockedCount = 0;
    private SharedPreferences preferences;

    private View customFullscreenView;
    private WebChromeClient.CustomViewCallback customFullscreenCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.setNavigationBarColor(BG);
        window.setStatusBarColor(BG);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        preferences = getSharedPreferences("noads_browser_tv", MODE_PRIVATE);
        blockingEnabled = preferences.getBoolean("blocking_enabled", true);
        loadBlocklist();
        buildChrome();

        String lastUrl = preferences.getString("last_url", "");
        BrowserTab first = createTab(false);
        if (lastUrl != null && !lastUrl.trim().isEmpty()) {
            navigate(lastUrl);
        } else {
            loadHome(first);
        }
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable rounded(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        drawable.setStroke(dp(1), BORDER);
        return drawable;
    }

    private StateListDrawable focusBackground(int normalColor, int focusedColor) {
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[]{android.R.attr.state_focused}, rounded(focusedColor, 8));
        states.addState(new int[]{}, rounded(normalColor, 8));
        return states;
    }

    private Button actionButton(String label, int widthDp) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(TEXT);
        button.setTextSize(16);
        button.setGravity(Gravity.CENTER);
        button.setAllCaps(false);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setFocusable(true);
        button.setBackground(focusBackground(TOOLBAR, Color.rgb(51, 37, 95)));
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(widthDp), dp(42)));
        return button;
    }

    private void buildChrome() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        setContentView(root);

        HorizontalScrollView tabScroll = new HorizontalScrollView(this);
        tabScroll.setHorizontalScrollBarEnabled(false);
        tabScroll.setBackgroundColor(Color.rgb(7, 9, 13));
        tabStrip = new LinearLayout(this);
        tabStrip.setOrientation(LinearLayout.HORIZONTAL);
        tabStrip.setGravity(Gravity.CENTER_VERTICAL);
        tabStrip.setPadding(dp(10), dp(3), dp(10), dp(3));
        tabScroll.addView(tabStrip, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(48)));
        root.addView(tabScroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(10), dp(7), dp(10), dp(7));
        toolbar.setBackgroundColor(TOOLBAR);
        root.addView(toolbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));

        Button back = actionButton("‹", 42);
        back.setContentDescription("Back");
        back.setOnClickListener(v -> goBack());
        toolbar.addView(back);

        Button forward = actionButton("›", 42);
        forward.setContentDescription("Forward");
        forward.setOnClickListener(v -> goForward());
        toolbar.addView(forward);

        Button reload = actionButton("↻", 42);
        reload.setContentDescription("Reload");
        reload.setOnClickListener(v -> reloadPage());
        toolbar.addView(reload);

        Button home = actionButton("⌂", 42);
        home.setContentDescription("Home");
        home.setOnClickListener(v -> goHome());
        toolbar.addView(home);

        addressBar = new EditText(this);
        addressBar.setSingleLine(true);
        addressBar.setTextColor(TEXT);
        addressBar.setHintTextColor(MUTED);
        addressBar.setHint("Search or enter website address");
        addressBar.setTextSize(15);
        addressBar.setPadding(dp(14), 0, dp(14), 0);
        addressBar.setSelectAllOnFocus(false);
        addressBar.setImeOptions(EditorInfo.IME_ACTION_GO);
        addressBar.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        addressBar.setBackground(rounded(FIELD, 8));
        addressBar.setFocusable(true);
        addressBar.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO
                    || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                navigate(addressBar.getText().toString());
                return true;
            }
            return false;
        });
        LinearLayout.LayoutParams addressParams = new LinearLayout.LayoutParams(
                0, dp(42), 1f);
        addressParams.setMargins(dp(8), 0, dp(8), 0);
        toolbar.addView(addressBar, addressParams);

        Button go = actionButton("Go", 58);
        go.setTextSize(14);
        go.setOnClickListener(v -> navigate(addressBar.getText().toString()));
        toolbar.addView(go);

        Button newTab = actionButton("+", 42);
        newTab.setContentDescription("New tab");
        newTab.setOnClickListener(v -> createTab(true));
        toolbar.addView(newTab);

        shieldButton = new TextView(this);
        shieldButton.setGravity(Gravity.CENTER);
        shieldButton.setTextColor(TEXT);
        shieldButton.setTextSize(12);
        shieldButton.setFocusable(true);
        shieldButton.setPadding(dp(7), 0, dp(7), 0);
        shieldButton.setBackground(focusBackground(TOOLBAR, Color.rgb(51, 37, 95)));
        shieldButton.setOnClickListener(v -> toggleBlocking());
        LinearLayout.LayoutParams shieldParams = new LinearLayout.LayoutParams(dp(100), dp(42));
        shieldParams.setMargins(dp(8), 0, 0, 0);
        toolbar.addView(shieldButton, shieldParams);
        updateShieldLabel();

        Button menu = actionButton("☰", 42);
        menu.setContentDescription("Browser menu");
        menu.setOnClickListener(v -> showBrowserMenu());
        toolbar.addView(menu);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        progressBar.setVisibility(View.GONE);
        progressBar.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        root.addView(progressBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(2)));

        pageContainer = new FrameLayout(this);
        pageContainer.setBackgroundColor(Color.WHITE);
        root.addView(pageContainer, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    }

    private BrowserTab createTab(boolean focusAddress) {
        if (tabs.size() >= MAX_TABS) {
            Toast.makeText(this, "Maximum of " + MAX_TABS + " tabs", Toast.LENGTH_SHORT).show();
            if (activeTab != null) activateTab(activeTab);
            return activeTab;
        }
        BrowserTab tab = new BrowserTab(nextTabId++);
        tabs.add(tab);
        activateTab(tab);
        if (focusAddress) {
            addressBar.requestFocus();
            addressBar.selectAll();
        }
        return tab;
    }

    private void closeTab(BrowserTab tab) {
        int index = tabs.indexOf(tab);
        if (index < 0) return;
        if (tabs.size() == 1) {
            loadHome(tab);
            return;
        }
        if (tab.webView.getParent() != null) {
            pageContainer.removeView(tab.webView);
        }
        tab.webView.stopLoading();
        tab.webView.destroy();
        tabs.remove(tab);
        if (tab == activeTab) {
            activeTab = tabs.get(Math.max(0, index - 1));
            attachActiveWebView();
        }
        updateTabs();
        updateAddress();
    }

    private void activateTab(BrowserTab tab) {
        if (!tabs.contains(tab)) return;
        if (customFullscreenView != null) hideCustomFullscreen();
        activeTab = tab;
        attachActiveWebView();
        updateTabs();
        updateAddress();
        tab.webView.requestFocus();
    }

    private void attachActiveWebView() {
        if (pageContainer == null || activeTab == null) return;
        if (activeTab.webView.getParent() != null) {
            ((ViewGroup) activeTab.webView.getParent()).removeView(activeTab.webView);
        }
        pageContainer.removeAllViews();
        pageContainer.addView(activeTab.webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void updateTabs() {
        if (tabStrip == null) return;
        tabStrip.removeAllViews();
        for (BrowserTab tab : tabs) {
            TextView tabView = new TextView(this);
            String title = tab.title == null || tab.title.trim().isEmpty()
                    ? "New Tab" : tab.title.trim();
            if (title.length() > 22) title = title.substring(0, 21) + "…";
            tabView.setText(title);
            tabView.setTextColor(tab == activeTab ? TEXT : MUTED);
            tabView.setTextSize(13);
            tabView.setGravity(Gravity.CENTER_VERTICAL);
            tabView.setSingleLine(true);
            tabView.setEllipsize(android.text.TextUtils.TruncateAt.END);
            tabView.setPadding(dp(14), 0, dp(14), 0);
            tabView.setFocusable(true);
            tabView.setBackground(focusBackground(
                    tab == activeTab ? TOOLBAR : Color.TRANSPARENT,
                    Color.rgb(51, 37, 95)));
            tabView.setOnClickListener(v -> activateTab(tab));
            tabView.setOnLongClickListener(v -> {
                closeTab(tab);
                return true;
            });
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(190), dp(40));
            params.setMargins(0, 0, dp(3), 0);
            tabStrip.addView(tabView, params);
        }
        TextView add = new TextView(this);
        add.setText("+");
        add.setTextColor(TEXT);
        add.setTextSize(22);
        add.setGravity(Gravity.CENTER);
        add.setFocusable(true);
        add.setBackground(focusBackground(Color.TRANSPARENT, Color.rgb(51, 37, 95)));
        add.setOnClickListener(v -> createTab(true));
        tabStrip.addView(add, new LinearLayout.LayoutParams(dp(48), dp(40)));
    }

    private void updateAddress() {
        if (addressBar == null || activeTab == null) return;
        String value = activeTab.home ? "" : activeTab.currentUrl;
        addressBar.setText(value == null ? "" : value);
        addressBar.setSelection(addressBar.length());
    }

    private void navigate(String raw) {
        if (activeTab == null || raw == null) return;
        String text = raw.trim();
        if (text.isEmpty()) return;
        String url = resolveNavigation(text);
        if (isBlockedUrl(url)) {
            recordBlocked(url);
            Toast.makeText(this, "Blocked by Noads Browser", Toast.LENGTH_SHORT).show();
            return;
        }
        activeTab.home = false;
        activeTab.currentUrl = url;
        activeTab.title = "Loading…";
        activeTab.webView.loadUrl(url);
        updateTabs();
        updateAddress();
        activeTab.webView.requestFocus();
    }

    private String resolveNavigation(String raw) {
        String lower = raw.toLowerCase(Locale.US);
        if (lower.startsWith("http://") || lower.startsWith("https://")) return raw;
        if (lower.startsWith("www.")) return "https://" + raw;
        if (!raw.contains(" ") && raw.contains(".")) return "https://" + raw;
        try {
            return "https://www.google.com/search?q="
                    + URLEncoder.encode(raw, StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            return "https://www.google.com/search?q=" + raw.replace(" ", "+");
        }
    }

    private void goBack() {
        if (activeTab != null && activeTab.webView.canGoBack()) {
            activeTab.webView.goBack();
        } else {
            goHome();
        }
    }

    private void goForward() {
        if (activeTab != null && activeTab.webView.canGoForward()) {
            activeTab.webView.goForward();
        }
    }

    private void reloadPage() {
        if (activeTab != null) activeTab.webView.reload();
    }

    private void goHome() {
        if (activeTab != null) loadHome(activeTab);
    }

    private void loadHome(BrowserTab tab) {
        tab.home = true;
        tab.currentUrl = "";
        tab.title = "New Tab";
        tab.webView.loadDataWithBaseURL(HOME_URL, HOME_HTML, "text/html", "UTF-8", null);
        if (tab == activeTab) {
            updateAddress();
            updateTabs();
        }
    }

    private void toggleBlocking() {
        blockingEnabled = !blockingEnabled;
        preferences.edit().putBoolean("blocking_enabled", blockingEnabled).apply();
        updateShieldLabel();
        Toast.makeText(this, blockingEnabled ? "Ad blocking enabled" : "Ad blocking paused",
                Toast.LENGTH_SHORT).show();
    }

    private void updateShieldLabel() {
        if (shieldButton == null) return;
        shieldButton.setText(blockingEnabled ? "Shield ON" : "Shield OFF");
        shieldButton.setContentDescription(blockingEnabled
                ? "Ad blocking enabled" : "Ad blocking disabled");
    }

    private void showBrowserMenu() {
        final String[] items = new String[]{
                "New tab", "Close current tab", blockingEnabled ? "Pause ad blocking" : "Enable ad blocking",
                "Clear browsing data", "About Noads Browser"
        };
        new AlertDialog.Builder(this)
                .setTitle("Noads Browser")
                .setItems(items, (dialog, which) -> {
                    if (which == 0) createTab(true);
                    else if (which == 1 && activeTab != null) closeTab(activeTab);
                    else if (which == 2) toggleBlocking();
                    else if (which == 3) clearBrowsingData();
                    else showAbout();
                })
                .show();
    }

    private void clearBrowsingData() {
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
        if (activeTab != null) activeTab.webView.clearCache(true);
        Toast.makeText(this, "Browsing data cleared", Toast.LENGTH_SHORT).show();
    }

    private void showAbout() {
        new AlertDialog.Builder(this)
                .setTitle("Noads Browser for Android TV")
                .setMessage("Version 0.1.7-TV\n\nA remote-friendly browser with network ad blocking and inline video fullscreen.\n\nLong-press a tab to close it.")
                .setPositiveButton("OK", null)
                .show();
    }

    private void loadBlocklist() {
        try (InputStream input = getAssets().open("blocklist.json")) {
            String content = new String(readAll(input), StandardCharsets.UTF_8);
            String[] pieces = content.split(",");
            for (String piece : pieces) {
                String domain = piece.replace("[", "")
                        .replace("]", "")
                        .replace("\"", "")
                        .trim()
                        .toLowerCase(Locale.US);
                if (!domain.isEmpty() && domain.matches("[a-z0-9][a-z0-9.-]*[a-z0-9]")) {
                    blockedDomains.add(domain);
                }
            }
        } catch (IOException error) {
            Toast.makeText(this, "Ad block list could not be loaded", Toast.LENGTH_LONG).show();
        }
    }

    private byte[] readAll(InputStream input) throws IOException {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        return output.toByteArray();
    }

    private boolean isBlockedUrl(String url) {
        if (!blockingEnabled || url == null) return false;
        try {
            Uri uri = Uri.parse(url);
            String host = uri.getHost();
            if (host == null) return false;
            host = host.toLowerCase(Locale.US);
            for (String domain : blockedDomains) {
                if (host.equals(domain) || host.endsWith("." + domain)) return true;
            }
        } catch (Exception ignored) {
            return false;
        }
        return false;
    }

    private void recordBlocked(String url) {
        blockedCount++;
        mainHandler.post(this::updateShieldLabel);
    }

    private void showDownload(String url, String userAgent, String contentDisposition,
                              String mimeType) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(URLUtil.guessFileName(url, contentDisposition, mimeType));
            request.setDescription("Noads Browser download");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);
            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (manager != null) manager.enqueue(request);
            Toast.makeText(this, "Download started", Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            Toast.makeText(this, "Download could not be started", Toast.LENGTH_SHORT).show();
        }
    }

    private void enterCustomFullscreen(View view, WebChromeClient.CustomViewCallback callback,
                                       BrowserTab tab) {
        if (customFullscreenView != null) {
            callback.onCustomViewHidden();
            return;
        }
        customFullscreenView = view;
        customFullscreenCallback = callback;
        if (tab.webView.getParent() != null) {
            ((ViewGroup) tab.webView.getParent()).removeView(tab.webView);
        }
        pageContainer.removeAllViews();
        pageContainer.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        view.setFocusable(true);
        view.requestFocus();
    }

    private void hideCustomFullscreen() {
        if (customFullscreenView == null) return;
        pageContainer.removeView(customFullscreenView);
        if (customFullscreenCallback != null) customFullscreenCallback.onCustomViewHidden();
        customFullscreenView = null;
        customFullscreenCallback = null;
        attachActiveWebView();
        if (activeTab != null) activeTab.webView.requestFocus();
    }

    private void persistLastUrl() {
        if (activeTab == null || activeTab.home) {
            preferences.edit().remove("last_url").apply();
        } else {
            preferences.edit().putString("last_url", activeTab.currentUrl).apply();
        }
    }

    @Override
    public void onBackPressed() {
        if (customFullscreenView != null) {
            hideCustomFullscreen();
        } else if (activeTab != null && activeTab.webView.canGoBack()) {
            activeTab.webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        persistLastUrl();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (customFullscreenView != null) hideCustomFullscreen();
        for (BrowserTab tab : tabs) tab.webView.destroy();
        tabs.clear();
        super.onDestroy();
    }

    private final class BrowserTab {
        final int id;
        final WebView webView;
        String title = "New Tab";
        String currentUrl = "";
        boolean home = true;

        BrowserTab(int tabId) {
            id = tabId;
            webView = makeWebView(this);
        }
    }

    private WebView makeWebView(BrowserTab tab) {
        WebView webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setUserAgentString(settings.getUserAgentString() + " NoadsBrowserTV/0.1.7");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new BrowserClient(tab));
        webView.setWebChromeClient(new BrowserChrome(tab));
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
                showDownload(url, userAgent, contentDisposition, mimeType));
        webView.setOnLongClickListener(v -> false);
        return webView;
    }

    private final class BrowserClient extends WebViewClient {
        private final BrowserTab tab;

        BrowserClient(BrowserTab owner) {
            tab = owner;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (isBlockedUrl(url)) {
                recordBlocked(url);
                Toast.makeText(MainActivity.this, "Blocked by Noads Browser", Toast.LENGTH_SHORT).show();
                return true;
            }
            return !isWebUrl(url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (isBlockedUrl(url)) {
                recordBlocked(url);
                return true;
            }
            return !isWebUrl(url);
        }

        private boolean isWebUrl(String url) {
            String lower = url == null ? "" : url.toLowerCase(Locale.US);
            if (lower.startsWith("http://") || lower.startsWith("https://")) return true;
            try {
                Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                startActivity(intent);
            } catch (Exception ignored) {
                // Unsupported external scheme: keep it inside the browser.
            }
            return false;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (isBlockedUrl(url)) {
                recordBlocked(url);
                return new WebResourceResponse("text/plain", "UTF-8",
                        new ByteArrayInputStream(new byte[0]));
            }
            return super.shouldInterceptRequest(view, request);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            if (isBlockedUrl(url)) {
                recordBlocked(url);
                return new WebResourceResponse("text/plain", "UTF-8",
                        new ByteArrayInputStream(new byte[0]));
            }
            return super.shouldInterceptRequest(view, url);
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            tab.home = HOME_URL.equals(url) || url.startsWith(HOME_URL);
            tab.currentUrl = tab.home ? "" : url;
            tab.title = tab.home ? "New Tab" : "Loading…";
            if (tab == activeTab) {
                progressBar.setVisibility(View.VISIBLE);
                progressBar.setProgress(8);
                updateAddress();
                updateTabs();
            }
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!tab.home) tab.currentUrl = url;
            if (tab == activeTab) {
                progressBar.setProgress(100);
                progressBar.setVisibility(View.GONE);
                updateAddress();
                updateTabs();
            }
            // Conservative cosmetic filtering for common ad surfaces. Network
            // blocking remains the primary protection and this is best-effort.
            view.evaluateJavascript(COSMETIC_FILTER_JS, null);
            super.onPageFinished(view, url);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request,
                                    WebResourceError error) {
            if (request.isForMainFrame() && tab == activeTab) {
                progressBar.setVisibility(View.GONE);
                Toast.makeText(MainActivity.this, "Page could not be loaded", Toast.LENGTH_SHORT).show();
            }
            super.onReceivedError(view, request, error);
        }

    }

    private final class BrowserChrome extends WebChromeClient {
        private final BrowserTab tab;

        BrowserChrome(BrowserTab owner) {
            tab = owner;
        }

        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            if (tab == activeTab) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
            super.onProgressChanged(view, newProgress);
        }

        @Override
        public void onReceivedTitle(WebView view, String title) {
            if (title != null && !title.trim().isEmpty()) tab.title = title;
            if (tab == activeTab) updateTabs();
            super.onReceivedTitle(view, title);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (tab == activeTab) enterCustomFullscreen(view, callback, tab);
            else callback.onCustomViewHidden();
        }

        @Override
        public void onHideCustomView() {
            hideCustomFullscreen();
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture,
                                      android.os.Message resultMsg) {
            // Keep popup links in the current browser tab; the blocker and
            // page navigation policy remain centralized in BrowserClient.
            return false;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            // Do not grant camera/microphone access automatically on a TV.
            request.deny();
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin,
                                                        GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("OK", (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.cancel())
                    .show();
            return true;
        }
    }

    private static final String COSMETIC_FILTER_JS =
            "(function(){try{" +
                    "var s='[class*=\\\"ad-\\\"],[class*=\\\" ads\\\"],[id*=\\\"ad-\\\"],[id*=\\\"adsbox\\\"],[data-ad],.ad-container,.ad-wrapper';" +
                    "document.querySelectorAll(s).forEach(function(e){e.style.setProperty('display','none','important');});" +
                    "}catch(e){}})();";

    private static final String HOME_HTML =
            "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>" +
                    "<style>" +
                    "html,body{height:100%;margin:0}body{background:#0b0e13;color:#e8edf4;font:20px sans-serif;display:grid;place-items:center}" +
                    ".card{width:70%;max-width:900px;padding:48px;border:1px solid #2f3b4e;border-radius:22px;background:#121821;text-align:center}" +
                    "h1{font-size:42px;margin:0 0 16px;color:#fff}p{color:#aeb9c8;line-height:1.5}" +
                    "a{display:inline-block;margin:10px;padding:14px 22px;border-radius:10px;background:#241b50;color:#e8edf4;text-decoration:none}" +
                    "small{color:#8b98ab}" +
                    "</style></head><body><main class='card'><h1>Noads Browser</h1>" +
                    "<p>Use the address bar above to search or enter a website. The browser is ready for your remote.</p>" +
                    "<a href='https://www.google.com'>Google</a><a href='https://www.youtube.com'>YouTube</a>" +
                    "<p><small>Network ad blocking is enabled by default.</small></p></main></body></html>";
}
