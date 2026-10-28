package de.dj64.tv

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ListView
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

@androidx.annotation.OptIn(UnstableApi::class)
class MainActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())

    private lateinit var playerView: PlayerView
    private lateinit var listView: ListView
    private lateinit var statusView: TextView
    private lateinit var adapter: ArrayAdapter<String>

    private var player: ExoPlayer? = null
    private var channels: List<Channel> = emptyList()
    private var currentIndex = -1
    private var retries = 0

    private val prefs by lazy { getSharedPreferences("dj64", MODE_PRIVATE) }
    private val cacheFile by lazy { File(filesDir, "playlist.m3u") }

    // ---------------------------------------------------------------- Lebenszyklus

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        buildUi()

        // 1) zuletzt gespeicherte Playlist sofort anzeigen
        if (cacheFile.exists()) {
            runCatching { applyChannels(M3uParser.parse(cacheFile.readText())) }
        }

        // 2) Playlist-URL bestimmen und im Hintergrund aktualisieren
        val url = playlistUrl()
        if (url.isBlank()) {
            askForPlaylistUrl()
        } else {
            refreshPlaylist(url)
        }
        showList()
    }

    override fun onStart() {
        super.onStart()
        initPlayer()
        if (currentIndex in channels.indices && listView.visibility != View.VISIBLE) {
            play(currentIndex)
        }
    }

    override fun onStop() {
        super.onStop()
        handler.removeCallbacksAndMessages(null)
        player?.release()
        player = null
    }

    // ---------------------------------------------------------------- Oberfläche

    private fun buildUi() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        playerView = PlayerView(this).apply {
            useController = false
            isFocusable = false
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        }
        root.addView(playerView, FrameLayout.LayoutParams(-1, -1))

        adapter = object : ArrayAdapter<String>(this, android.R.layout.simple_list_item_1) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = super.getView(position, convertView, parent) as TextView
                v.setTextColor(Color.WHITE)
                v.textSize = 18f
                v.setPadding(32, 20, 32, 20)
                v.maxLines = 1
                return v
            }
        }

        listView = ListView(this).apply {
            adapter = this@MainActivity.adapter
            setBackgroundColor(0xE60B1F4B.toInt())
            selector = ColorDrawable(0x66FFD400)
            divider = null
            isFocusable = true
            setOnItemClickListener { _, _, position, _ ->
                if (position == 0) askForPlaylistUrl() else play(position - 1)
            }
        }
        val listWidth = (resources.displayMetrics.density * 380).toInt()
        root.addView(listView, FrameLayout.LayoutParams(listWidth, -1, Gravity.START))

        statusView = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 16f
            setBackgroundColor(0xAA000000.toInt())
            setPadding(32, 16, 32, 16)
            visibility = View.GONE
        }
        root.addView(
            statusView,
            FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply { setMargins(24, 24, 24, 24) }
        )

        setContentView(root)
    }

    private fun showList() {
        listView.visibility = View.VISIBLE
        listView.requestFocus()
        listView.setSelection(if (currentIndex >= 0) currentIndex + 1 else 0)
    }

    private fun hideList() {
        listView.visibility = View.GONE
    }

    private fun status(text: String?) {
        if (text.isNullOrEmpty()) {
            statusView.visibility = View.GONE
        } else {
            statusView.text = text
            statusView.visibility = View.VISIBLE
        }
    }

    // ---------------------------------------------------------------- Playlist

    private fun playlistUrl(): String =
        prefs.getString("url", null)?.takeIf { it.isNotBlank() } ?: Config.DEFAULT_PLAYLIST_URL

    private fun askForPlaylistUrl() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(playlistUrl())
            hint = "http://…/playlist.m3u"
            setSingleLine(true)
        }
        AlertDialog.Builder(this)
            .setTitle("M3U-Playlist-URL")
            .setView(input)
            .setPositiveButton("Speichern") { _, _ ->
                val url = input.text.toString().trim()
                if (url.isNotEmpty()) {
                    prefs.edit().putString("url", url).apply()
                    refreshPlaylist(url)
                }
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun refreshPlaylist(url: String) {
        status("Playlist wird geladen …")
        Thread {
            try {
                val text = download(url)
                val parsed = M3uParser.parse(text)
                if (parsed.isEmpty()) throw IOException("Keine Sender in der Playlist gefunden")
                runCatching { cacheFile.writeText(text) }
                handler.post {
                    applyChannels(parsed)
                    status("${parsed.size} Sender geladen")
                    handler.postDelayed({ status(null) }, 2500)
                }
            } catch (e: Exception) {
                handler.post {
                    val hint = if (channels.isEmpty()) "" else " (zuletzt gespeicherte Liste bleibt aktiv)"
                    status("Playlist-Fehler: ${e.message}$hint")
                }
            }
        }.start()
    }

    private fun download(urlStr: String): String {
        var current = urlStr
        var redirects = 0
        while (true) {
            val c = URL(current).openConnection() as HttpURLConnection
            c.connectTimeout = 15000
            c.readTimeout = 30000
            c.instanceFollowRedirects = false
            c.setRequestProperty("User-Agent", "DJ64/1.0")
            val code = c.responseCode
            if (code in 300..399 && redirects < 5) {
                val loc = c.getHeaderField("Location") ?: throw IOException("Weiterleitung ohne Ziel")
                current = URL(URL(current), loc).toString()
                c.disconnect()
                redirects++
                continue
            }
            if (code !in 200..299) throw IOException("HTTP $code")
            return c.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        }
    }

    private fun applyChannels(list: List<Channel>) {
        val lastUrl = prefs.getString("last", null)
        channels = list
        currentIndex = list.indexOfFirst { it.url == lastUrl }
        adapter.clear()
        adapter.add("⚙  Playlist ändern")
        list.forEachIndexed { i, ch -> adapter.add("%3d   %s".format(i + 1, ch.name)) }
        adapter.notifyDataSetChanged()
    }

    // ---------------------------------------------------------------- Player

    private fun initPlayer() {
        if (player != null) return
        val dataSource = DefaultHttpDataSource.Factory()
            .setUserAgent("DJ64/1.0")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(15000)
        val p = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(dataSource))
            .build()
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_BUFFERING -> status("Lade …")
                    Player.STATE_READY -> {
                        retries = 0
                        status(null)
                    }
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                if (retries < 5) {
                    retries++
                    status("Verbindung unterbrochen – neuer Versuch $retries/5 …")
                    handler.postDelayed({ if (currentIndex in channels.indices) startStream() }, 3000)
                } else {
                    status("Sender nicht erreichbar. Mit OK zurück zur Liste.")
                }
            }
        })
        playerView.player = p
        player = p
    }

    private fun startStream() {
        val ch = channels.getOrNull(currentIndex) ?: return
        player?.apply {
            setMediaItem(MediaItem.fromUri(ch.url))
            prepare()
            playWhenReady = true
        }
    }

    private fun play(index: Int) {
        if (index !in channels.indices) return
        currentIndex = index
        retries = 0
        prefs.edit().putString("last", channels[index].url).apply()
        handler.removeCallbacksAndMessages(null)
        hideList()
        status(channels[index].name)
        startStream()
    }

    // ---------------------------------------------------------------- Fernbedienung

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (listView.visibility == View.VISIBLE) {
            if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT && currentIndex >= 0) {
                hideList()
                return true
            }
            return super.onKeyDown(keyCode, event) // Liste bedienen; Zurück beendet die App
        }

        // Vollbild: Bedienung des laufenden Senders
        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> {
                play((currentIndex + 1) % channels.size.coerceAtLeast(1)); true
            }
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> {
                val prev = if (currentIndex <= 0) channels.size - 1 else currentIndex - 1
                play(prev); true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_BACK -> {
                showList(); true
            }
            else -> super.onKeyDown(keyCode, event)
        }
    }
}
