package de.dj64.tv

import android.content.Context
import java.net.URLEncoder

class Store(context: Context) {
    private val p = context.getSharedPreferences("dj64", Context.MODE_PRIVATE)

    private fun str(key: String): String = p.getString(key, null) ?: ""
    private fun put(key: String, value: String) = p.edit().putString(key, value).apply()

    // ---- Zugangsdaten
    var url: String // M3U-Wiedergabeliste
        get() = str("url").ifBlank { Config.DEFAULT_PLAYLIST_URL }
        set(value) = put("url", value)
    var server: String
        get() = str("server")
        set(value) = put("server", value)
    var user: String
        get() = str("user")
        set(value) = put("user", value)
    var pass: String
        get() = str("pass")
        set(value) = put("pass", value)
    var epgManual: String
        get() = str("epg")
        set(value) = put("epg", value)

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

    private fun xtreamBase(): String? {
        val s = server.trim().trimEnd('/')
        if (s.isEmpty() || user.isBlank()) return null
        return if ("://" in s) s else "http://$s"
    }

    fun usesXtream(): Boolean = xtreamBase() != null

    fun playlistUrl(): String {
        val base = xtreamBase()
        if (base != null) {
            return "$base/get.php?username=${enc(user.trim())}&password=${enc(pass)}&type=m3u_plus&output=ts"
        }
        return url.trim()
    }

    fun epgUrl(headerUrl: String): String {
        if (epgManual.isNotBlank()) return epgManual.trim()
        val base = xtreamBase()
        if (base != null) return "$base/xmltv.php?username=${enc(user.trim())}&password=${enc(pass)}"
        return headerUrl
    }

    // ---- Player und Darstellung
    var seekSec: Int
        get() = p.getInt("seek", 10)
        set(value) = p.edit().putInt("seek", value).apply()
    var volume: Int
        get() = p.getInt("volume", 100)
        set(value) = p.edit().putInt("volume", value).apply()
    var resize: Int // 0 = Anpassen, 1 = Gestreckt, 2 = Zoom
        get() = p.getInt("resize", 0)
        set(value) = p.edit().putInt("resize", value).apply()
    var theme: Int // 0 = Blau-Gelb, 1 = Violett, 2 = Grün
        get() = p.getInt("theme", 0)
        set(value) = p.edit().putInt("theme", value).apply()
    var fontStyle: Int // 0 = Modern, 1 = Kompakt, 2 = Klassisch
        get() = p.getInt("font", 0)
        set(value) = p.edit().putInt("font", value).apply()
    var margin: Int // Bildrand (Overscan), Index 0..4
        get() = p.getInt("margin", 0)
        set(value) = p.edit().putInt("margin", value).apply()
    var uiScale: Float
        get() = p.getFloat("uiScale", 1f)
        set(value) = p.edit().putFloat("uiScale", value).apply()

    // ---- Merkliste
    var lastUrl: String?
        get() = p.getString("last", null)
        set(value) = p.edit().putString("last", value).apply()

    var hiddenGroups: Set<String>
        get() = HashSet(p.getStringSet("hidden", emptySet()) ?: emptySet())
        set(value) = p.edit().putStringSet("hidden", HashSet(value)).apply()

    private fun favorites(): MutableSet<String> =
        HashSet(p.getStringSet("favorites", emptySet()) ?: emptySet())

    fun favoriteSet(): Set<String> = favorites()

    fun toggleFavorite(url: String): Boolean {
        val set = favorites()
        val nowFavorite = if (set.contains(url)) {
            set.remove(url); false
        } else {
            set.add(url); true
        }
        p.edit().putStringSet("favorites", set).apply()
        return nowFavorite
    }
}
