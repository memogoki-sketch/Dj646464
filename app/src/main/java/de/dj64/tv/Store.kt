package de.dj64.tv

import android.content.Context

class Store(context: Context) {
    private val p = context.getSharedPreferences("dj64", Context.MODE_PRIVATE)

    var url: String
        get() = p.getString("url", null)?.takeIf { it.isNotBlank() } ?: Config.DEFAULT_PLAYLIST_URL
        set(value) = p.edit().putString("url", value).apply()

    var lastUrl: String?
        get() = p.getString("last", null)
        set(value) = p.edit().putString("last", value).apply()

    var hiddenGroups: Set<String>
        get() = HashSet(p.getStringSet("hidden", emptySet()) ?: emptySet())
        set(value) = p.edit().putStringSet("hidden", HashSet(value)).apply()

    private fun favorites(): MutableSet<String> =
        HashSet(p.getStringSet("favorites", emptySet()) ?: emptySet())

    fun isFavorite(url: String): Boolean = favorites().contains(url)

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
