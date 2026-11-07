package de.dj64.tv

enum class Kind { LIVE, MOVIE, SERIES }

data class Channel(
    val name: String,
    val url: String,
    val group: String,
    val kind: Kind,
    val tvgId: String = "",
    val logo: String = ""
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

    fun parse(text: String): Playlist {
        val result = ArrayList<Channel>()
        var pendingName: String? = null
        var pendingGroup = ""
        var pendingId = ""
        var pendingLogo = ""
        var epgUrl = ""

        for (raw in text.lineSequence()) {
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
            } else if (line.startsWith("#EXTGRP:", ignoreCase = true)) {
                pendingGroup = line.substringAfter(':').trim()
            } else if (!line.startsWith("#")) {
                val name = pendingName?.takeIf { it.isNotBlank() } ?: line
                result.add(Channel(name, line, pendingGroup, classify(line, pendingGroup, name), pendingId, pendingLogo))
                pendingName = null
                pendingGroup = ""
                pendingId = ""
                pendingLogo = ""
            }
        }
        return Playlist(result, epgUrl)
    }
}
