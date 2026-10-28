package de.dj64.tv

enum class Kind { LIVE, MOVIE, SERIES }

data class Channel(val name: String, val url: String, val group: String, val kind: Kind)

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
                pendingGroup = attrRegex.findAll(line)
                    .firstOrNull { it.groupValues[1].equals("group-title", ignoreCase = true) }
                    ?.groupValues?.get(2) ?: ""
            } else if (line.startsWith("#EXTGRP:", ignoreCase = true)) {
                pendingGroup = line.substringAfter(':').trim()
            } else if (!line.startsWith("#")) {
                val name = pendingName?.takeIf { it.isNotBlank() } ?: line
                result.add(Channel(name, line, pendingGroup, classify(line, pendingGroup)))
                pendingName = null
                pendingGroup = ""
            }
        }
        return result
    }
}
