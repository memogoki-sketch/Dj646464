package de.dj64.tv

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Lädt Senderlogos im Hintergrund und merkt sie sich. */
object Logos {
    private val cache = LruCache<String, Bitmap>(250)
    private val pool = Executors.newFixedThreadPool(3)
    private val main = Handler(Looper.getMainLooper())
    private val failed = HashSet<String>()

    fun load(url: String, view: ImageView) {
        view.tag = url
        view.setImageDrawable(null)
        if (url.isEmpty()) return
        val hit = cache.get(url)
        if (hit != null) {
            view.setImageBitmap(hit)
            return
        }
        if (synchronized(failed) { failed.contains(url) }) return
        pool.execute {
            val bmp = fetch(url)
            main.post {
                if (bmp != null) {
                    cache.put(url, bmp)
                    if (view.tag == url) view.setImageBitmap(bmp)
                } else {
                    synchronized(failed) { failed.add(url) }
                }
            }
        }
    }

    private fun fetch(url: String): Bitmap? {
        return try {
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 8000
            c.readTimeout = 8000
            c.instanceFollowRedirects = true
            if (c.responseCode !in 200..299 || c.contentLength > 3_000_000) return null
            val bytes = c.inputStream.use { it.readBytes() }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= 160 && bounds.outHeight / (sample * 2) >= 100) sample *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        } catch (t: Throwable) {
            null
        }
    }
}
