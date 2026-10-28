package de.dj64.tv

enum class Kind { LIVE, MOVIE, SERIES }

data class Channel(val name: String, val url: String, val group: String, val kind: Kind)

object M3uParser {
    private val groupRegex = Regex("""group-title="([^"]*)"""", RegexOption.IGNORE_CASE)
    private val episodeRegex = Regex("""\bS\d{1,2}\s?E\d{1,3}\b""", RegexOption.IGNORE_CASE)
    private val seriesWords = listOf("serie", "series", "dizi", "staffel", "season")
    private val movieWords = listOf("film", "movie", "vod", "kino", "cinema", "sinema")

    fun parse(text: String): List<Channel> {
        val result = ArrayList<Channel>()
        var pendingName: String? = null
        var pendingGroup = ""

        for (raw in text.lineSequence()) {
            val line = raw.trim().removePrefix("﻿")
            if (line.isEmpty()) continue

            if (line.startsWith("#EXTINF", ignoreCase = true)) {
                val lastQuote = line.lastIndexOf('"')
                val comma = line.indexOf(',', if (lastQuote >= 0) lastQuote else 0)
                pendingName = if (comma >= 0) line.substring(comma + 1).trim() else ""
                pendingGroup = groupRegex.find(line)?.groupValues?.get(1) ?: ""
            } else if (line.startsWith("#EXTGRP:", ignoreCase = true)) {
                pendingGroup = line.substringAfter(':').trim()
            } else if (!line.startsWith("#")) {
                val name = pendingName?.takeIf { it.isNotBlank() } ?: line
                result.add(Channel(name, line, pendingGroup, detectKind(line, pendingGroup, name)))
                pendingName = null
                pendingGroup = ""
            }
        }
        return result
    }

    private fun detectKind(url: String, group: String, name: String): Kind {
        val u = url.lowercase()
        if (u.contains("/series/")) return Kind.SERIES
        if (u.contains("/movie/")) return Kind.MOVIE

        val g = group.lowercase()
        if (seriesWords.any { g.contains(it) }) return Kind.SERIES
        if (movieWords.any { g.contains(it) }) return Kind.MOVIE
        if (episodeRegex.containsMatchIn(name)) return Kind.SERIES

        val path = u.substringBefore('?')
        if (path.endsWith(".mkv") || path.endsWith(".mp4") || path.endsWith(".avi")) return Kind.MOVIE
        return Kind.LIVE
    }
}
