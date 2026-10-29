package com.djergin64.fenerbahcenews;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Fenerbahce News (design by DjErgin64).
 *
 * Die App zeigt dieselbe Oberflaeche wie die Windows-Version (Ordner assets/www).
 * Feeds und Artikelseiten werden nativ geladen und an die Seite uebergeben,
 * dadurch gibt es keine CORS-Probleme und keinen Server.
 */
public class MainActivity extends Activity {

    private static final String UA = "Mozilla/5.0 (Linux; Android) FenerbahceNews/1.1";
    private static final int DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
    private static final Pattern CHARSET = Pattern.compile("charset=[\"']?([\\w-]+)", Pattern.CASE_INSENSITIVE);
    private static final Pattern XML_ENCODING = Pattern.compile("encoding=[\"']([\\w-]+)[\"']", Pattern.CASE_INSENSITIVE);

    private WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final ConcurrentHashMap<String, String> results = new ConcurrentHashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B1F4D);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    // Artikel im Browser des Geraets oeffnen, nie in der App selbst.
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException ignored) {
                        // Kein Browser installiert: nichts tun
                    }
                    return true;
                }
                return false;
            }
        });

        web.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        if (web != null) {
            web.removeJavascriptInterface("AndroidBridge");
            web.destroy();
        }
        super.onDestroy();
    }

    /** Schnittstelle, die die Webseite als window.AndroidBridge sieht. */
    public final class Bridge {

        /** Startet eine Anfrage; das Ergebnis meldet window.__nativeDone(id, ok) und wird mit take(id) abgeholt. */
        @JavascriptInterface
        public void fetch(final String id, final String url, final int maxBytes) {
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    boolean ok = false;
                    String payload;
                    try {
                        payload = httpGet(url, maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES);
                        ok = true;
                    } catch (Exception e) {
                        payload = String.valueOf(e.getMessage());
                    }
                    results.put(id, payload);
                    final String js = "window.__nativeDone && window.__nativeDone('" + id.replaceAll("[^0-9]", "") + "'," + (ok ? 1 : 0) + ")";
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (!isDestroyed() && web != null) web.evaluateJavascript(js, null);
                        }
                    });
                }
            });
        }

        @JavascriptInterface
        public String take(String id) {
            String r = results.remove(id);
            return r == null ? "" : r;
        }

        /** Liest eine mitgelieferte Datei aus assets/www (z. B. sources.json, fixtures.json). */
        @JavascriptInterface
        public String readAsset(String path) {
            if (path == null || !path.startsWith("www/") || path.contains("..")) return "";
            try (InputStream in = getAssets().open(path)) {
                return decode(readBytes(in, 4 * 1024 * 1024), null);
            } catch (IOException e) {
                return "";
            }
        }
    }

    // ---------- Netzwerk ----------

    private String httpGet(String url, int maxBytes) throws IOException {
        String current = url;
        for (int hop = 0; hop < 6; hop++) {
            URL u = new URL(current);
            String proto = u.getProtocol();
            if (!"https".equals(proto) && !"http".equals(proto)) {
                throw new IOException("Protokoll nicht erlaubt");
            }
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            try {
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(12000);
                c.setReadTimeout(12000);
                c.setRequestProperty("User-Agent", UA);
                c.setRequestProperty("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8");
                c.setRequestProperty("Accept-Language", "tr-TR,tr;q=0.9,en;q=0.6");

                int code = c.getResponseCode();
                if (code >= 300 && code < 400) {
                    String loc = c.getHeaderField("Location");
                    if (loc == null) throw new IOException("Weiterleitung ohne Ziel");
                    current = new URL(u, loc).toString();
                    continue;
                }
                if (code < 200 || code >= 300) throw new IOException("HTTP " + code);

                try (InputStream in = c.getInputStream()) {
                    return decode(readBytes(in, maxBytes), c.getContentType());
                }
            } finally {
                c.disconnect();
            }
        }
        throw new IOException("Zu viele Weiterleitungen");
    }

    private static byte[] readBytes(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
            if (out.size() >= max) break;
        }
        return out.toByteArray();
    }

    /** Zeichensatz aus Header oder XML/HTML-Kopf bestimmen (tuerkische Seiten nutzen teils iso-8859-9). */
    private static String decode(byte[] data, String contentType) {
        String label = null;
        if (contentType != null) {
            Matcher m = CHARSET.matcher(contentType);
            if (m.find()) label = m.group(1);
        }
        if (label == null) {
            String head = new String(data, 0, Math.min(400, data.length), StandardCharsets.ISO_8859_1);
            Matcher m = XML_ENCODING.matcher(head);
            if (m.find()) {
                label = m.group(1);
            } else {
                m = CHARSET.matcher(head);
                if (m.find()) label = m.group(1);
            }
        }
        Charset cs = StandardCharsets.UTF_8;
        if (label != null) {
            try {
                cs = Charset.forName(label);
            } catch (Exception ignored) {
                cs = StandardCharsets.UTF_8;
            }
        }
        return new String(data, cs);
    }
}
