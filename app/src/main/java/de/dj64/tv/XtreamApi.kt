package de.dj64.tv

import android.util.JsonReader
import android.util.JsonToken
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.net.URLEncoder

/** Xtream-Codes-JSON-API (player_api.php): schneller und sauberer als die M3U-Datei. */
object XtreamApi {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun api(x: Xt, action: String, extra: String = "") =
        "${x.base}/player_api.php?username=${enc(x.user)}&password=${enc(x.pass)}&action=$action$extra"

    private fun readObjects(input: InputStream, onObj: (Map<String, String>) -> Unit) {
        JsonReader(InputStreamReader(input, Charsets.UTF_8).buffered()).use { r ->
            if (r.peek() != JsonToken.BEGIN_ARRAY) throw IOException("Unerwartete Antwort des Servers")
            r.beginArray()
            while (r.hasNext()) {
                if (r.peek() != JsonToken.BEGIN_OBJECT) { r.skipValue(); continue }
                val m = HashMap<String, String>()
                r.beginObject()
                while (r.hasNext()) {
                    val n = r.nextName()
                    when (r.peek()) {
                        JsonToken.STRING, JsonToken.NUMBER -> m[n] = r.nextString()
                        JsonToken.BOOLEAN -> m[n] = r.nextBoolean().toString()
                        JsonToken.NULL -> r.nextNull()
                        else -> r.skipValue()
                    }
                }
                r.endObject()
                onObj(m)
            }
            r.endArray()
        }
    }

    private fun cats(x: Xt, action: String, open: (String) -> InputStream): Map<String, String> {
        val m = HashMap<String, String>()
        open(api(x, action)).use { readObjects(it) { o -> m[o["category_id"] ?: ""] = o["category_name"] ?: "" } }
        return m
    }

    fun load(x: Xt, open: (String) -> InputStream): List<Channel> {
        val out = ArrayList<Channel>()
        var lastError: Exception? = null
        try {
            val lc = cats(x, "get_live_categories", open)
            open(api(x, "get_live_streams")).use {
                readObjects(it) { o ->
                    val id = o["stream_id"] ?: return@readObjects
                    val arch = if (o["tv_archive"] == "1") ((o["tv_archive_duration"]?.toIntOrNull() ?: 0).takeIf { d -> d > 0 } ?: 3) else 0
                    out.add(
                        Channel(
                            o["name"] ?: id, "${x.base}/live/${x.user}/${x.pass}/$id.ts", lc[o["category_id"] ?: ""] ?: "",
                            Kind.LIVE, o["epg_channel_id"] ?: "", o["stream_icon"] ?: "", id, arch
                        )
                    )
                }
            }
        } catch (e: Exception) { lastError = e }
        try {
            val vc = cats(x, "get_vod_categories", open)
            open(api(x, "get_vod_streams")).use {
                readObjects(it) { o ->
                    val id = o["stream_id"] ?: return@readObjects
                    val ext = o["container_extension"]?.takeIf { e -> e.isNotBlank() } ?: "mp4"
                    out.add(
                        Channel(
                            o["name"] ?: id, "${x.base}/movie/${x.user}/${x.pass}/$id.$ext", vc[o["category_id"] ?: ""] ?: "",
                            Kind.MOVIE, "", o["stream_icon"] ?: "", id
                        )
                    )
                }
            }
        } catch (e: Exception) { lastError = lastError ?: e }
        try {
            val sc = cats(x, "get_series_categories", open)
            open(api(x, "get_series")).use {
                readObjects(it) { o ->
                    val id = o["series_id"] ?: return@readObjects
                    out.add(
                        Channel(
                            o["name"] ?: id, "xseries://$id", sc[o["category_id"] ?: ""] ?: "",
                            Kind.SERIES, "", o["cover"] ?: "", id
                        )
                    )
                }
            }
        } catch (e: Exception) { lastError = lastError ?: e }
        if (out.isEmpty()) throw lastError ?: IOException("Keine Einträge")
        return out
    }

    /** Folgen einer Serie, als "Serienname S01E02 – Titel". */
    fun episodes(x: Xt, series: Channel, open: (String) -> InputStream): List<Channel> {
        val text = open(api(x, "get_series_info", "&series_id=${series.streamId}")).use { String(it.readBytes(), Charsets.UTF_8) }
        val j = JSONObject(text)
        val eps = j.opt("episodes")
        val out = ArrayList<Channel>()
        fun add(o: JSONObject, seasonHint: Int) {
            val id = o.optString("id")
            if (id.isEmpty()) return
            val season = o.optInt("season", seasonHint).takeIf { it > 0 } ?: seasonHint
            val ep = o.optInt("episode_num", out.size + 1)
            val ext = o.optString("container_extension").ifBlank { "mp4" }
            val title = o.optString("title").ifBlank { "Folge $ep" }
            val logo = o.optJSONObject("info")?.optString("movie_image").orEmpty().ifBlank { series.logo }
            out.add(
                Channel(
                    "${series.name} S%02dE%02d – %s".format(season, ep, title),
                    "${x.base}/series/${x.user}/${x.pass}/$id.$ext", series.group, Kind.SERIES, "", logo, id
                )
            )
        }
        if (eps is JSONObject) {
            for (k in eps.keys()) {
                val arr = eps.optJSONArray(k) ?: continue
                for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { add(it, k.toIntOrNull() ?: 1) }
            }
        } else if (eps is JSONArray) {
            for (s in 0 until eps.length()) {
                val arr = eps.optJSONArray(s) ?: continue
                for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { add(it, s + 1) }
            }
        }
        if (out.isEmpty()) throw IOException("Keine Folgen gefunden")
        return out
    }
}
