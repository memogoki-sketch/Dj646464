package de.dj64.tv

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Baut Archiv-(Catch-up-)Adressen für Xtream-Server und M3U-Vorlagen. */
object Catchup {
    private val xc = Regex("""^(https?://.+?)/live/([^/]+)/([^/]+)/(\d+)\.\w+""")

    fun url(c: Channel, startMs: Long, minutes: Int): String? {
        val src = c.catchupSource
        if (src.isNotBlank()) {
            val sec = startMs / 1000
            val dur = minutes * 60L
            val now = System.currentTimeMillis() / 1000
            val d = Date(startMs)
            fun f(p: String) = SimpleDateFormat(p, Locale.US).format(d)
            var u = src
            val map = mapOf(
                "start" to sec, "utc" to sec, "timestamp" to sec,
                "end" to sec + dur, "duration" to dur, "offset" to (now - sec)
            )
            for ((k, v) in map) u = u.replace("\${$k}", v.toString()).replace("{$k}", v.toString())
            u = u.replace("{Y}", f("yyyy")).replace("{m}", f("MM")).replace("{d}", f("dd"))
                .replace("{H}", f("HH")).replace("{M}", f("mm")).replace("{S}", f("ss"))
            return if (u.startsWith("http")) u else c.url + u
        }
        val m = xc.find(c.url) ?: return null
        val (base, user, pass, id) = m.destructured
        val stamp = SimpleDateFormat("yyyy-MM-dd:HH-mm", Locale.US).format(Date(startMs))
        return "$base/timeshift/$user/$pass/$minutes/$stamp/$id.ts"
    }

    fun has(c: Channel): Boolean = c.kind == Kind.LIVE && c.archiveDays > 0 && url(c, 0L, 1) != null
}
