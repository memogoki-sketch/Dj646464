package de.dj64.tv

enum class Kind { LIVE, MOVIE, SERIES }

data class Channel(
    val name: String,
    val url: String,
    val group: String,
    val kind: Kind,
    val tvgId: String = "",
    val logo: String = "",
    val streamId: String = "",
    val archiveDays: Int = 0,
    val ua: String = "",
    val referer: String = "",
    val drmType: String = "",
    val drmKey: String = "",
    val catchupSource: String = ""
)

data class Playlist(val channels: List<Channel>, val epgUrl: String)

object M3uParser {
    private val attrRegex = Regex("""([\w-]+)="([^"]*)"""")

    private val seriesWords = listOf("serie", "staffel", "season", "dizi", "tv show", "tvshow")
    private val movieWords = listOf("film", "movie", "vod", "kino", "cinema", "sinema")
    private val epRegex = Regex("""(?i)\bS(\d{1,2})\s*[ ._-]?\s*E(\d{1,3})\b|\b(\d{1,2})x(\d{2,3})\b""")

    data class Ep(val title: String, val season: Int, val episode: Int)

    /** Erkennt "Serienname S01E02" bzw. "Serienname 1x02". */
    fun episode(name: String): Ep? {
        val m = epRegex.find(name) ?: return null
        val s = (m.groupValues[1].ifEmpty { m.groupValues[3] }).toIntOrNull() ?: return null
        val e = (m.groupValues[2].ifEmpty { m.groupValues[4] }).toIntOrNull() ?: return null
        val title = name.substring(0, m.range.first).trim().trimEnd('-', '_', '.', ':', '[', '(', ' ').trim()
        return Ep(title.ifBlank { name.trim() }, s, e)
    }

    fun classify(url: String, group: String, name: String = ""): Kind {
        val u = url.lowercase()
        val g = group.lowercase()
        val path = u.substringBefore('?')
        return when {
            "/series/" in u -> Kind.SERIES
            "/movie/" in u -> Kind.MOVIE
            "/live/" in u -> Kind.LIVE
            episode(name) != null -> Kind.SERIES
            seriesWords.any { it in g } -> Kind.SERIES
            movieWords.any { it in g } -> Kind.MOVIE
            listOf(".mp4", ".mkv", ".avi", ".mov", ".m4v").any { path.endsWith(it) } -> Kind.MOVIE
            else -> Kind.LIVE
        }
    }

    private fun attr(line: String, name: String): String =
        attrRegex.findAll(line)
            .firstOrNull { it.groupValues[1].equals(name, ignoreCase = true) }
            ?.groupValues?.get(2) ?: ""

    fun parse(text: String): Playlist = parseLines(text.lineSequence())

    /** Liest die Liste zeilenweise aus dem Datenstrom (kein riesiger Gesamttext im Speicher). */
    fun parse(reader: java.io.Reader): Playlist =
        java.io.BufferedReader(reader, 65536).useLines { parseLines(it) }

    private fun urlDecode(s: String): String = try { java.net.URLDecoder.decode(s, "UTF-8") } catch (e: Exception) { s }

    private fun parseLines(lines: Sequence<String>): Playlist {
        val result = ArrayList<Channel>()
        var pendingUa = ""
        var pendingRef = ""
        var pendingDrmType = ""
        var pendingDrmKey = ""
        var pendingArchive = 0
        var pendingCatchupSrc = ""
        var pendingName: String? = null
        var pendingGroup = ""
        var pendingId = ""
        var pendingLogo = ""
        var epgUrl = ""

        for (raw in lines) {
            val line = raw.trim().removePrefix("﻿")
            if (line.isEmpty()) continue

            if (line.startsWith("#EXTM3U", ignoreCase = true)) {
                epgUrl = attr(line, "url-tvg").ifEmpty { attr(line, "x-tvg-url") }.substringBefore(',')
            } else if (line.startsWith("#EXTINF", ignoreCase = true)) {
                val lastQuote = line.lastIndexOf('"')
                val comma = line.indexOf(',', if (lastQuote >= 0) lastQuote else 0)
                pendingName = if (comma >= 0) line.substring(comma + 1).trim() else ""
                pendingGroup = attr(line, "group-title")
                pendingId = attr(line, "tvg-id")
                pendingLogo = attr(line, "tvg-logo")
                val days = (attr(line, "catchup-days").ifEmpty { attr(line, "tvg-rec") }).toIntOrNull() ?: 0
                pendingCatchupSrc = attr(line, "catchup-source")
                pendingArchive = if (days > 0) days
                    else if (attr(line, "catchup").isNotEmpty() || pendingCatchupSrc.isNotEmpty()) 3 else 0
            } else if (line.startsWith("#EXTVLCOPT:", ignoreCase = true)) {
                val kv = line.substringAfter(':')
                val k = kv.substringBefore('=').lowercase()
                val v = kv.substringAfter('=', "")
                if (k == "http-user-agent") pendingUa = v
                else if (k == "http-referrer" || k == "http-referer") pendingRef = v
            } else if (line.startsWith("#KODIPROP:", ignoreCase = true)) {
                val kv = line.substringAfter(':')
                val k = kv.substringBefore('=').lowercase()
                val v = kv.substringAfter('=', "")
                if (k.endsWith("license_type")) {
                    pendingDrmType = if (v.contains("widevine", true)) "widevine" else if (v.contains("clearkey", true)) "clearkey" else v.lowercase()
                } else if (k.endsWith("license_key")) {
                    pendingDrmKey = v.substringBefore('|')
                }
            } else if (line.startsWith("#EXTGRP:", ignoreCase = true)) {
                pendingGroup = line.substringAfter(':').trim()
            } else if (!line.startsWith("#")) {
                val name = pendingName?.takeIf { it.isNotBlank() } ?: line
                var link = line
                var ua = pendingUa
                var ref = pendingRef
                val bar = link.indexOf('|')
                if (bar > 0 && link.startsWith("http", ignoreCase = true)) {
                    for (pair in link.substring(bar + 1).split('&')) {
                        val k = pair.substringBefore('=').lowercase()
                        val v = urlDecode(pair.substringAfter('=', ""))
                        if (k == "user-agent") ua = v else if (k == "referer" || k == "referrer") ref = v
                    }
                    link = link.substring(0, bar)
                }
                val sid = Regex("""/live/[^/]+/[^/]+/(\d+)\.""").find(link)?.groupValues?.get(1) ?: ""
                result.add(
                    Channel(
                        name, link, pendingGroup, classify(link, pendingGroup, name), pendingId, pendingLogo,
                        sid, pendingArchive, ua, ref, pendingDrmType, pendingDrmKey, pendingCatchupSrc
                    )
                )
                pendingUa = ""; pendingRef = ""; pendingDrmType = ""; pendingDrmKey = ""
                pendingArchive = 0; pendingCatchupSrc = ""
                pendingName = null
                pendingGroup = ""
                pendingId = ""
                pendingLogo = ""
            }
        }
        return Playlist(result, epgUrl)
    }
}
