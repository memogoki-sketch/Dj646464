package de.dj64.tv

import android.content.Context
import java.net.URLEncoder

class Store(context: Context) {
    private val p = context.getSharedPreferences("dj64", Context.MODE_PRIVATE)
    private val pp = context.getSharedPreferences("dj64pos", Context.MODE_PRIVATE)

    // ---- Profile (Kunden): Profil 0 = bisherige Daten ohne Präfix
    private val profileKeys = listOf("url", "server", "user", "pass", "epg", "hidden", "favorites", "recent")

    var activeProfile: Int
        get() = p.getInt("activeProfile", 0)
        set(value) = p.edit().putInt("activeProfile", value).apply()

    private fun key(id: Int, base: String) = if (id == 0) base else "p${id}_$base"
    private fun k(base: String) = key(activeProfile, base)

    fun profiles(): List<Pair<Int, String>> {
        val l = (p.getString("profiles", null) ?: "").split('\n').mapNotNull {
            val a = it.split('\t', limit = 2)
            if (a.size == 2) a[0].toIntOrNull()?.let { id -> id to a[1] } else null
        }
        return if (l.isEmpty()) listOf(0 to "Hauptprofil") else l
    }

    private fun saveProfiles(l: List<Pair<Int, String>>) =
        p.edit().putString("profiles", l.joinToString("\n") { "${it.first}\t${it.second}" }).apply()

    fun profileName(id: Int): String = profiles().firstOrNull { it.first == id }?.second ?: "Profil"

    fun addProfile(name: String): Int {
        val l = profiles()
        val id = (l.maxOfOrNull { it.first } ?: 0) + 1
        saveProfiles(l + (id to name))
        return id
    }

    fun renameProfile(id: Int, name: String) = saveProfiles(profiles().map { if (it.first == id) id to name else it })

    fun deleteProfile(id: Int) {
        val l = profiles().filter { it.first != id }
        if (l.isEmpty()) return
        val e = p.edit()
        profileKeys.forEach { e.remove(key(id, it)) }
        e.apply()
        saveProfiles(l)
        if (activeProfile == id) activeProfile = l[0].first
    }

    // ---- Film/Serie: Spulen und Fortsetzen
    var fwdSec: Int
        get() = p.getInt("fwd", p.getInt("seek", 10))
        set(value) = p.edit().putInt("fwd", value).apply()
    var backSec: Int
        get() = p.getInt("back", p.getInt("seek", 10))
        set(value) = p.edit().putInt("back", value).apply()
    var accelSeek: Boolean
        get() = p.getBoolean("accel", true)
        set(value) = p.edit().putBoolean("accel", value).apply()
    var resumeMode: Int // 0 automatisch, 1 fragen, 2 aus
        get() = p.getInt("resume", 1)
        set(value) = p.edit().putInt("resume", value).apply()

    fun pos(url: String): Long = (pp.getString(url, null) ?: "").substringBefore('|').toLongOrNull() ?: 0L

    fun setPos(url: String, ms: Long) {
        val e = pp.edit()
        e.putString(url, "$ms|${System.currentTimeMillis()}")
        val all = pp.all
        if (all.size > 200) {
            all.entries.filter { it.key != url }
                .minByOrNull { (it.value as? String ?: "").substringAfter('|', "0").toLongOrNull() ?: 0L }
                ?.let { e.remove(it.key) }
        }
        e.apply()
    }

    fun clearPos(url: String) = pp.edit().remove(url).apply()

    private fun str(key: String): String = p.getString(key, null) ?: ""
    private fun put(key: String, value: String) = p.edit().putString(key, value).apply()

    // ---- Zugangsdaten
    var url: String // M3U-Wiedergabeliste
        get() = str(k("url")).ifBlank { if (activeProfile == 0) Config.DEFAULT_PLAYLIST_URL else "" }
        set(value) = put(k("url"), value)
    var server: String
        get() = str(k("server"))
        set(value) = put(k("server"), value)
    var user: String
        get() = str(k("user"))
        set(value) = put(k("user"), value)
    var pass: String
        get() = str(k("pass"))
        set(value) = put(k("pass"), value)
    var epgManual: String
        get() = str(k("epg"))
        set(value) = put(k("epg"), value)

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

    // ---- Leistung, Wetter, Start
    var bufLevel: Int // 0 klein, 1 normal, 2 groß, 3 sehr groß
        get() = p.getInt("buf", 1)
        set(value) = p.edit().putInt("buf", value).apply()
    var bufAuto: Boolean
        get() = p.getBoolean("bufAuto", true)
        set(value) = p.edit().putBoolean("bufAuto", value).apply()
    var retryIdx: Int
        get() = p.getInt("retryIdx", 1)
        set(value) = p.edit().putInt("retryIdx", value).apply()
    var preview: Boolean
        get() = p.getBoolean("preview", true)
        set(value) = p.edit().putBoolean("preview", value).apply()
    var previewDelayIdx: Int
        get() = p.getInt("pdelay", 1)
        set(value) = p.edit().putInt("pdelay", value).apply()
    var logos: Boolean
        get() = p.getBoolean("logos", true)
        set(value) = p.edit().putBoolean("logos", value).apply()
    var epgAuto: Boolean
        get() = p.getBoolean("epgAuto", true)
        set(value) = p.edit().putBoolean("epgAuto", value).apply()
    var introMode: Int // 0 voll, 1 kurz, 2 aus
        get() = p.getInt("intro", 1)
        set(value) = p.edit().putInt("intro", value).apply()
    // ---- Sortierung, Zuletzt gesehen, Jugendschutz
    var sortAz: Boolean
        get() = p.getBoolean("sortAz", true)
        set(value) = p.edit().putBoolean("sortAz", value).apply()
    var pcEnabled: Boolean
        get() = p.getBoolean("pcOn", false)
        set(value) = p.edit().putBoolean("pcOn", value).apply()
    var pcHash: String
        get() = str("pcHash")
        set(value) = put("pcHash", value)
    var pcAuto: Boolean
        get() = p.getBoolean("pcAuto", true)
        set(value) = p.edit().putBoolean("pcAuto", value).apply()
    var pcHide: Boolean
        get() = p.getBoolean("pcHide", false)
        set(value) = p.edit().putBoolean("pcHide", value).apply()
    var pcLockSettings: Boolean
        get() = p.getBoolean("pcSet", false)
        set(value) = p.edit().putBoolean("pcSet", value).apply()
    var pcGroups: Set<String>
        get() = HashSet(p.getStringSet("pcGroups", emptySet()) ?: emptySet())
        set(value) = p.edit().putStringSet("pcGroups", HashSet(value)).apply()

    fun recent(): List<String> = str(k("recent")).split('\n').filter { it.isNotBlank() }

    fun addRecent(url: String) {
        val l = ArrayList(recent())
        l.remove(url)
        l.add(0, url)
        put(k("recent"), l.take(30).joinToString("\n"))
    }

    var wxName: String
        get() = str("wxName")
        set(value) = put("wxName", value)
    var wxLat: Float
        get() = p.getFloat("wxLat", 0f)
        set(value) = p.edit().putFloat("wxLat", value).apply()
    var wxLon: Float
        get() = p.getFloat("wxLon", 0f)
        set(value) = p.edit().putFloat("wxLon", value).apply()
    var wxFahrenheit: Boolean
        get() = p.getBoolean("wxF", false)
        set(value) = p.edit().putBoolean("wxF", value).apply()
    var wxCache: String
        get() = str("wxCache")
        set(value) = put("wxCache", value)
    var wxTime: Long
        get() = p.getLong("wxTime", 0L)
        set(value) = p.edit().putLong("wxTime", value).apply()

    // ---- Merkliste
    var lastUrl: String?
        get() = p.getString("last", null)
        set(value) = p.edit().putString("last", value).apply()

    var hiddenGroups: Set<String>
        get() = HashSet(p.getStringSet(k("hidden"), emptySet()) ?: emptySet())
        set(value) = p.edit().putStringSet(k("hidden"), HashSet(value)).apply()

    private fun favorites(): MutableSet<String> =
        HashSet(p.getStringSet(k("favorites"), emptySet()) ?: emptySet())

    fun favoriteSet(): Set<String> = favorites()

    fun toggleFavorite(url: String): Boolean {
        val set = favorites()
        val nowFavorite = if (set.contains(url)) {
            set.remove(url); false
        } else {
            set.add(url); true
        }
        p.edit().putStringSet(k("favorites"), set).apply()
        return nowFavorite
    }
}
