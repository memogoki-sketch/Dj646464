package de.dj64.tv

data class Channel(val name: String, val url: String, val group: String)

object M3uParser {
    private val attrRegex = Regex("""([\w-]+)="([^"]*)"""")

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
                result.add(Channel(name, line, pendingGroup))
                pendingName = null
                pendingGroup = ""
            }
        }
        return result
    }
}
