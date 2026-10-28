package de.dj64.tv

enum class Kind { LIVE, MOVIE, SERIES }

data class Channel(
    val name: String,
    val url: String,
    val group: String,
    val kind: Kind,
    val tvgId: String = ""
)

data class Playlist(val channels: List<Channel>, val epgUrl: String)

object M3uParser {
    private val attrRegex = Regex("""([\w-]+)="([^"]*)"""")

    private val seriesWords = listOf("serie", "staffel", "season")
    private val movieWords = listOf("film", "movie", "vod", "kino", "cinema")

    fun classify(url: String, group: String): Kind {
        val u = url.lowercase()
        val g = group.lowercase()
        val path = u.substringBefore('?')
        return when {
            "/series/" in u -> Kind.SERIES
            "/movie/" in u -> Kind.MOVIE
            seriesWords.any { it in g } -> Kind.SERIES
            movieWords.any { it in g } -> Kind.MOVIE
            path.endsWith(".mp4") || path.endsWith(".mkv") || path.endsWith(".avi") -> Kind.MOVIE
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
            } else if (line.startsWith("#EXTGRP:", ignoreCase = true)) {
                pendingGroup = line.substringAfter(':').trim()
            } else if (!line.startsWith("#")) {
                val name = pendingName?.takeIf { it.isNotBlank() } ?: line
                result.add(Channel(name, line, pendingGroup, classify(line, pendingGroup), pendingId))
                pendingName = null
                pendingGroup = ""
                pendingId = ""
            }
        }
        return Playlist(result, epgUrl)
    }
}
