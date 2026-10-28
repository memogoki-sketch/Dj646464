package de.dj64.tv

import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedInputStream
import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.zip.GZIPInputStream

class Prog(val start: Long, val stop: Long, val title: String)

class Epg(
    private val byId: Map<String, List<Prog>>,
    private val nameToId: Map<String, String>
) {
    fun size(): Int = byId.size

    private fun listFor(c: Channel): List<Prog>? {
        if (c.tvgId.isNotEmpty()) {
            val direct = byId[c.tvgId]
            if (direct != null) return direct
        }
        val id = nameToId[norm(c.name)] ?: return null
        return byId[id]
    }

    fun nowNext(c: Channel, now: Long): Pair<Prog?, Prog?> {
        val l = listFor(c) ?: return Pair(null, null)
        val cur = l.firstOrNull { it.start <= now && now < it.stop }
        val after = cur?.stop ?: now
        val next = l.firstOrNull { it.start >= after }
        return Pair(cur, next)
    }

    companion object {
        fun norm(s: String): String = s.lowercase().filter { it.isLetterOrDigit() }

        fun load(raw: InputStream, now: Long): Epg {
            val buf = BufferedInputStream(raw, 65536)
            buf.mark(4)
            val b1 = buf.read()
            val b2 = buf.read()
            buf.reset()
            val input: InputStream =
                if (b1 == 0x1f && b2 == 0x8b) GZIPInputStream(buf, 65536) else buf

            val parser = Xml.newPullParser()
            parser.setInput(input, null)

            val byId = HashMap<String, ArrayList<Prog>>()
            val nameToId = HashMap<String, String>()
            val fmtTz = SimpleDateFormat("yyyyMMddHHmmss Z", Locale.US)
            val fmtNoTz = SimpleDateFormat("yyyyMMddHHmmss", Locale.US)

            fun time(s: String?): Long {
                if (s == null) return -1L
                val t = s.trim()
                return try {
                    val d = (if (t.length > 14) fmtTz else fmtNoTz).parse(t)
                    d?.time ?: -1L
                } catch (e: Exception) {
                    -1L
                }
            }

            val from = now - 2 * 3600_000L
            val to = now + 24 * 3600_000L

            var channelId: String? = null
            var progChannel: String? = null
            var progStart = -1L
            var progStop = -1L
            var progTitle: String? = null
            var tag = ""

            var ev = parser.eventType
            while (ev != XmlPullParser.END_DOCUMENT) {
                when (ev) {
                    XmlPullParser.START_TAG -> {
                        tag = parser.name
                        if (tag == "channel") {
                            channelId = parser.getAttributeValue(null, "id")
                        } else if (tag == "programme") {
                            progChannel = parser.getAttributeValue(null, "channel")
                            progStart = time(parser.getAttributeValue(null, "start"))
                            progStop = time(parser.getAttributeValue(null, "stop"))
                            progTitle = null
                        }
                    }
                    XmlPullParser.TEXT -> {
                        val txt = parser.text ?: ""
                        val cid = channelId
                        if (tag == "display-name" && cid != null) {
                            val key = norm(txt)
                            if (key.isNotEmpty() && !nameToId.containsKey(key)) nameToId[key] = cid
                        } else if (tag == "title" && progChannel != null && progTitle == null) {
                            progTitle = txt.trim()
                        }
                    }
                    XmlPullParser.END_TAG -> {
                        val name = parser.name
                        if (name == "channel") {
                            channelId = null
                        } else if (name == "programme") {
                            val ch = progChannel
                            val title = progTitle
                            if (ch != null && title != null && progStop > from && progStart < to) {
                                byId.getOrPut(ch) { ArrayList() }.add(Prog(progStart, progStop, title))
                            }
                            progChannel = null
                        }
                        tag = ""
                    }
                }
                ev = parser.next()
            }

            val sorted = HashMap<String, List<Prog>>()
            for ((k, v) in byId) sorted[k] = v.sortedBy { it.start }
            return Epg(sorted, nameToId)
        }
    }
}
