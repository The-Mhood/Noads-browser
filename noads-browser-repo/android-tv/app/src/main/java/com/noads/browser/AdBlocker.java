package com.noads.browser;

import android.content.Context;
import android.net.Uri;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Network-level ad/tracker domain blocking for the WebView. Loads the same
 * bundled blocklist the desktop app ships (assets/blocklist.json) and answers
 * suffix-match lookups for shouldInterceptRequest.
 */
public final class AdBlocker {
    private final Set<String> domains = new HashSet<>();
    private int blockedCount = 0;

    public static AdBlocker load(Context context) {
        AdBlocker blocker = new AdBlocker();
        try (InputStream in = context.getAssets().open("blocklist.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            JSONArray arr = new JSONArray(new String(out.toByteArray(), StandardCharsets.UTF_8));
            for (int i = 0; i < arr.length(); i++) {
                String d = arr.optString(i, "").trim().toLowerCase(Locale.ROOT);
                if (!d.isEmpty()) blocker.domains.add(d);
            }
        } catch (Exception e) {
            // Missing/invalid list must never crash the browser: run unblocked.
            android.util.Log.e("AdBlocker", "blocklist failed to load", e);
        }
        return blocker;
    }

    /** True when url's host is, or is a subdomain of, a blocked domain. */
    public boolean isBlocked(String url) {
        if (url == null) return false;
        String host;
        try {
            host = Uri.parse(url).getHost();
        } catch (Exception e) {
            return false;
        }
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        for (String d : domains) {
            if (host.equals(d) || host.endsWith("." + d)) return true;
        }
        return false;
    }

    public void incrementBlocked() {
        blockedCount++;
    }

    public int getBlockedCount() {
        return blockedCount;
    }
}
