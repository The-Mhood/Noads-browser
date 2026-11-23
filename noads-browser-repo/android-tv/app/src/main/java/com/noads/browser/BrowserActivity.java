package com.noads.browser;

import android.app.Activity;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;

/**
 * Shared WebView browser engine for the phone and TV front ends: network-level
 * ad blocking, video fullscreen via custom view, and navigation helpers.
 */
public abstract class BrowserActivity extends Activity {

    protected WebView web;
    protected AdBlocker blocker;
    private View chromeBar;
    private FrameLayout fullscreenContainer;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    /** Subclasses inflate their layout, then call this with the views. */
    protected void attachBrowser(WebView webView, View chrome) {
        this.web = webView;
        this.chromeBar = chrome;
        this.blocker = AdBlocker.load(this);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setBuiltInZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                if (req != null && req.getUrl() != null && blocker.isBlocked(req.getUrl().toString())) {
                    blocker.incrementBlocked();
                    onBlockedCountChanged(blocker.getBlockedCount());
                    return new WebResourceResponse("text/plain", "utf-8",
                            new ByteArrayInputStream(new byte[0]));
                }
                return super.shouldInterceptRequest(view, req);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                // Only http(s) pages load; other schemes are left to the system.
                return !(url.startsWith("https://") || url.startsWith("http://"));
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                onLocationChanged(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                onPageReady();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                fullscreenView = view;
                fullscreenCallback = callback;
                fullscreenContainer = new FrameLayout(BrowserActivity.this);
                fullscreenContainer.setBackgroundColor(0xFF000000);
                fullscreenContainer.addView(view, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                ((ViewGroup) getWindow().getDecorView()).addView(fullscreenContainer,
                        new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT));
                if (chromeBar != null) chromeBar.setVisibility(View.GONE);
                web.setVisibility(View.GONE);
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            }

            @Override
            public void onHideCustomView() {
                exitFullscreen();
            }
        });
    }

    protected void exitFullscreen() {
        if (fullscreenView == null) return;
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        if (fullscreenContainer != null) {
            ((ViewGroup) getWindow().getDecorView()).removeView(fullscreenContainer);
        }
        fullscreenView = null;
        fullscreenContainer = null;
        fullscreenCallback = null;
        if (chromeBar != null) chromeBar.setVisibility(View.VISIBLE);
        web.setVisibility(View.VISIBLE);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
    }

    /** Turn untrusted input into a URL or a DuckDuckGo HTML search. */
    protected void navigate(String raw) {
        String input = raw == null ? "" : raw.trim();
        if (input.isEmpty() || web == null) return;
        String url;
        if (input.startsWith("http://") || input.startsWith("https://")) {
            url = input;
        } else if (!input.contains(" ") && input.contains(".")) {
            url = "https://" + input;
        } else {
            url = "https://duckduckgo.com/?q=" + Uri.encode(input);
        }
        web.loadUrl(url);
    }

    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            exitFullscreen();
        } else if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    /** Called on the UI thread whenever the blocked-request counter changes. */
    protected abstract void onBlockedCountChanged(int count);

    /** Called when the page URL changes (address display sync). */
    protected abstract void onLocationChanged(String url);

    /** Called when a page finishes loading (subclasses re-inject page UI). */
    protected void onPageReady() {}
}
