package de.dj64.tv

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
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

    private enum class Screen { HOME, BROWSE, SETTINGS, PLAYER }

    private val navy = 0xFF0B1F4B.toInt()
    private val navyLight = 0xFF16306B.toInt()
    private val yellow = 0xFFFFD400.toInt()

    private val handler = Handler(Looper.getMainLooper())
    private val hideStatusRunnable = Runnable { status(null) }
    private val retryRunnable = Runnable { startStream() }

    private lateinit var store: Store
    private lateinit var content: FrameLayout
    private lateinit var playerView: PlayerView
    private lateinit var statusView: TextView
    private val cacheFile by lazy { File(filesDir, "playlist.m3u") }

    private var player: ExoPlayer? = null
    private var screen = Screen.HOME

    private var channels: List<Channel> = emptyList()

    // Browse-Zustand
    private var browseKind = Kind.LIVE
    private var browseCat = 0
    private var catGroups: List<String> = emptyList()
    private var currentItems: List<Channel> = emptyList()
    private var chanList: ListView? = null
    private var chanAdapter: ArrayAdapter<String>? = null

    // Wiedergabe-Zustand
    private var playList: List<Channel> = emptyList()
    private var playIndex = 0
    private var playKind = Kind.LIVE
    private var retries = 0

    // ---------------------------------------------------------------- Lebenszyklus

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        store = Store(this)
        buildRoot()

        if (cacheFile.exists()) {
            runCatching { channels = M3uParser.parse(cacheFile.readText()) }
        }
        showHome()

        val url = store.url
        if (url.isBlank()) askForPlaylistUrl() else refreshPlaylist(url)
    }

    override fun onStart() {
        super.onStart()
        initPlayer()
        if (screen == Screen.PLAYER && playList.isNotEmpty()) startStream()
    }

    override fun onStop() {
        super.onStop()
        handler.removeCallbacks(retryRunnable)
        player?.release()
        player = null
    }

    // ---------------------------------------------------------------- Grundgerüst

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun buildRoot() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        playerView = PlayerView(this).apply {
            useController = false
            isFocusable = false
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        }
        root.addView(playerView, FrameLayout.LayoutParams(-1, -1))

        content = FrameLayout(this).apply { setBackgroundColor(navy) }
        root.addView(content, FrameLayout.LayoutParams(-1, -1))

        statusView = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 16f
            setBackgroundColor(0xCC000000.toInt())
            setPadding(dp(14), dp(8), dp(14), dp(8))
            visibility = View.GONE
        }
        root.addView(
            statusView,
            FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply {
                setMargins(dp(16), dp(16), dp(16), dp(16))
            }
        )
        setContentView(root)
    }

    private fun setScreen(view: View) {
        content.removeAllViews()
        content.addView(view, FrameLayout.LayoutParams(-1, -1))
        content.visibility = View.VISIBLE
    }

    private fun status(text: String?, autoHideMs: Long = 0) {
        handler.removeCallbacks(hideStatusRunnable)
        if (text.isNullOrEmpty()) {
            statusView.visibility = View.GONE
        } else {
            statusView.text = text
            statusView.visibility = View.VISIBLE
            if (autoHideMs > 0) handler.postDelayed(hideStatusRunnable, autoHideMs)
        }
    }

    private fun label(text: String, size: Float, color: Int = Color.WHITE, bold: Boolean = false): TextView =
        TextView(this).apply {
            this.text = text
            textSize = size
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
        }

    private fun tileBackground(focused: Boolean): GradientDrawable =
        GradientDrawable().apply {
            cornerRadius = dp(18).toFloat()
            setColor(if (focused) 0xFF1F4190.toInt() else navyLight)
            setStroke(dp(if (focused) 4 else 1), if (focused) yellow else 0x55FFFFFF)
        }

    private fun tile(icon: String, text: String, big: Boolean, onClick: () -> Unit): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            isFocusable = true
            isClickable = true
            background = tileBackground(false)
            setPadding(dp(12), dp(12), dp(12), dp(12))
            setOnClickListener { onClick() }
            setOnFocusChangeListener { v, focused ->
                v.background = tileBackground(focused)
                val s = if (focused) 1.06f else 1f
                v.animate().scaleX(s).scaleY(s).setDuration(120).start()
            }
        }
        val iconView = label(icon, if (big) 54f else 30f, yellow)
        iconView.gravity = Gravity.CENTER
        val textView = label(text, if (big) 24f else 16f, Color.WHITE, true)
        textView.gravity = Gravity.CENTER
        box.addView(iconView, LinearLayout.LayoutParams(-2, -2))
        box.addView(textView, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(8) })
        return box
    }

    private fun addTile(row: LinearLayout, t: View, w: Int, h: Int) {
        row.addView(t, LinearLayout.LayoutParams(w, h).apply { setMargins(dp(10), dp(10), dp(10), dp(10)) })
    }

    private fun styledAdapter(): ArrayAdapter<String> =
        object : ArrayAdapter<String>(this, android.R.layout.simple_list_item_1) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = super.getView(position, convertView, parent) as TextView
                v.setTextColor(Color.WHITE)
                v.textSize = 18f
                v.maxLines = 1
                v.setPadding(dp(16), dp(12), dp(16), dp(12))
                return v
            }
        }

    // ---------------------------------------------------------------- Startseite

    @Suppress("DEPRECATION")
    private fun networkText(): String {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val ni = cm.activeNetworkInfo
            when {
                ni == null || !ni.isConnected -> "Offline"
                ni.type == ConnectivityManager.TYPE_ETHERNET -> "LAN verbunden"
                ni.type == ConnectivityManager.TYPE_WIFI -> "WLAN verbunden"
                else -> "Online"
            }
        } catch (e: Exception) {
            "unbekannt"
        }
    }

    private fun count(kind: Kind): Int = channels.count { it.kind == kind }

    private fun showHome() {
        screen = Screen.HOME
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(40), dp(24), dp(40), dp(24))
        }

        val top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        top.addView(
            label("DJ64", 40f, yellow, true),
            LinearLayout.LayoutParams(0, -2, 1f)
        )
        addTile(top, tile("⟳", "Aktualisieren", false) {
            val url = store.url
            if (url.isBlank()) askForPlaylistUrl() else refreshPlaylist(url)
        }, dp(150), dp(86))
        addTile(top, tile("⚙", "Einstellungen", false) { showSettings() }, dp(150), dp(86))
        page.addView(top, LinearLayout.LayoutParams(-1, -2))

        val row = LinearLayout(this).apply { gravity = Gravity.CENTER }
        val live = tile("📺", "Live-TV\n${count(Kind.LIVE)}", true) { showBrowse(Kind.LIVE, 0) }
        val movies = tile("🎬", "Filme\n${count(Kind.MOVIE)}", true) { showBrowse(Kind.MOVIE, 0) }
        val series = tile("🎞", "Serien\n${count(Kind.SERIES)}", true) { showBrowse(Kind.SERIES, 0) }
        addTile(row, live, dp(280), dp(300))
        addTile(row, movies, dp(280), dp(300))
        addTile(row, series, dp(280), dp(300))
        page.addView(row, LinearLayout.LayoutParams(-1, 0, 1f))

        page.addView(
            label("${channels.size} Einträge  ·  ${networkText()}", 15f, 0xAAFFFFFF.toInt()),
            LinearLayout.LayoutParams(-2, -2).apply { gravity = Gravity.CENTER_HORIZONTAL }
        )

        setScreen(page)
        live.post { live.requestFocus() }
    }

    // ---------------------------------------------------------------- Liste mit Kategorien

    private fun groupOf(c: Channel): String = c.group.ifBlank { "Ohne Kategorie" }

    private fun visibleOfKind(kind: Kind): List<Channel> {
        val hidden = store.hiddenGroups
        return channels.filter { it.kind == kind && groupOf(it) !in hidden }
    }

    private fun showBrowse(kind: Kind, startCat: Int, selectPos: Int = -1) {
        screen = Screen.BROWSE
        browseKind = kind
        browseCat = startCat

        val title = when (kind) {
            Kind.LIVE -> "Live-TV"
            Kind.MOVIE -> "Filme"
            Kind.SERIES -> "Serien"
        }
        val items = visibleOfKind(kind)
        val favs = store.favoriteSet()
        val groups = items.map { groupOf(it) }.distinct()
        val groupCounts = items.groupingBy { groupOf(it) }.eachCount()

        catGroups = listOf("", "") + groups
        val catLabels = ArrayList<String>()
        catLabels.add("Alle (${items.size})")
        catLabels.add("★ Favoriten (${items.count { it.url in favs }})")
        groups.forEach { catLabels.add("$it (${groupCounts[it] ?: 0})") }

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(32), dp(20), dp(32), dp(16))
        }
        page.addView(label(title, 30f, yellow, true), LinearLayout.LayoutParams(-2, -2))

        if (channels.isEmpty() || items.isEmpty()) {
            page.addView(
                label(
                    "Hier ist noch nichts. Lade die Playlist unter Einstellungen → Playlist ändern.",
                    18f
                ),
                LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(24) }
            )
            setScreen(page)
            return
        }

        val body = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }

        val catAdapter = styledAdapter()
        catAdapter.addAll(catLabels)
        val catList = ListView(this).apply {
            adapter = catAdapter
            setBackgroundColor(navyLight)
            selector = ColorDrawable(0x66FFD400)
            divider = null
            isFocusable = true
        }

        val cAdapter = styledAdapter()
        chanAdapter = cAdapter
        val cList = ListView(this).apply {
            adapter = cAdapter
            setBackgroundColor(0xFF0F2860.toInt())
            selector = ColorDrawable(0x66FFD400)
            divider = null
            isFocusable = true
        }
        chanList = cList

        catList.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, pos: Int, id: Long) {
                if (pos != browseCat || currentItems.isEmpty()) fillChannels(pos)
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        catList.setOnItemClickListener { _, _, pos, _ ->
            fillChannels(pos)
            cList.requestFocus()
        }
        cList.setOnItemClickListener { _, _, pos, _ -> play(currentItems, pos) }
        cList.setOnItemLongClickListener { _, _, pos, _ ->
            toggleFavorite(pos)
            true
        }

        body.addView(catList, LinearLayout.LayoutParams(dp(320), -1).apply { rightMargin = dp(12) })
        body.addView(cList, LinearLayout.LayoutParams(0, -1, 1f))
        page.addView(body, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = dp(12) })

        page.addView(
            label("OK lange drücken = Favorit setzen/entfernen  ·  Zurück = Startseite", 14f, 0xAAFFFFFF.toInt()),
            LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(8) }
        )

        setScreen(page)

        val cat = startCat.coerceIn(0, catLabels.size - 1)
        fillChannels(cat)
        catList.setSelection(cat)
        if (selectPos >= 0) {
            cList.setSelection(selectPos)
            cList.post { cList.requestFocus() }
        } else {
            catList.post { catList.requestFocus() }
        }
    }

    private fun fillChannels(cat: Int) {
        browseCat = cat
        val items = visibleOfKind(browseKind)
        val favs = store.favoriteSet()
        currentItems = when (cat) {
            0 -> items
            1 -> items.filter { it.url in favs }
            else -> {
                val g = catGroups.getOrNull(cat)
                items.filter { groupOf(it) == g }
            }
        }
        val adapter = chanAdapter ?: return
        adapter.clear()
        adapter.addAll(currentItems.map { (if (it.url in favs) "★ " else "") + it.name })
        adapter.notifyDataSetChanged()
    }

    private fun toggleFavorite(pos: Int) {
        val ch = currentItems.getOrNull(pos) ?: return
        val now = store.toggleFavorite(ch.url)
        status(if (now) "★ Favorit gespeichert" else "Favorit entfernt", 1500)
        val list = chanList
        fillChannels(browseCat)
        val newPos = pos.coerceAtMost((currentItems.size - 1).coerceAtLeast(0))
        list?.setSelection(newPos)
    }

    // ---------------------------------------------------------------- Einstellungen

    private fun showSettings() {
        screen = Screen.SETTINGS
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(40), dp(24), dp(40), dp(24))
        }
        page.addView(label("Einstellungen", 34f, yellow, true), LinearLayout.LayoutParams(-2, -2))

        val grid = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
        }
        val w = dp(250)
        val h = dp(150)

        val row1 = LinearLayout(this).apply { gravity = Gravity.CENTER }
        val netTile = tile("🌐", "Netzwerk / WLAN\n${networkText()}", false) { openNetworkSettings() }
        addTile(row1, netTile, w, h)
        addTile(row1, tile("📝", "Playlist ändern", false) { askForPlaylistUrl() }, w, h)
        addTile(row1, tile("🔄", "Playlist aktualisieren", false) {
            val url = store.url
            if (url.isBlank()) askForPlaylistUrl() else refreshPlaylist(url)
        }, w, h)
        addTile(row1, tile("🗂", "Kategorien verwalten", false) { manageCategories() }, w, h)

        val row2 = LinearLayout(this).apply { gravity = Gravity.CENTER }
        addTile(row2, tile("🧹", "Cache leeren", false) { clearCache() }, w, h)
        addTile(row2, tile("⚙", "Weitere Einstellungen", false) { openSystemSettings() }, w, h)
        addTile(row2, tile("ℹ", "Info", false) { showInfo() }, w, h)

        grid.addView(row1, LinearLayout.LayoutParams(-2, -2))
        grid.addView(row2, LinearLayout.LayoutParams(-2, -2))
        page.addView(grid, LinearLayout.LayoutParams(-1, 0, 1f))

        setScreen(page)
        netTile.post { netTile.requestFocus() }
    }

    private fun openNetworkSettings() {
        try {
            startActivity(Intent(Settings.ACTION_WIFI_SETTINGS))
        } catch (e: ActivityNotFoundException) {
            openSystemSettings()
        } catch (e: SecurityException) {
            openSystemSettings()
        }
    }

    private fun openSystemSettings() {
        try {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        } catch (e: Exception) {
            status("Systemeinstellungen konnten nicht geöffnet werden", 3000)
        }
    }

    private fun manageCategories() {
        if (channels.isEmpty()) {
            status("Zuerst die Playlist laden", 2500)
            return
        }
        val all = channels.map { groupOf(it) }.distinct().sorted()
        val hidden = store.hiddenGroups
        val checked = BooleanArray(all.size) { all[it] !in hidden }
        AlertDialog.Builder(this)
            .setTitle("Sichtbare Kategorien")
            .setMultiChoiceItems(all.toTypedArray(), checked) { _, which, isChecked ->
                checked[which] = isChecked
            }
            .setPositiveButton("Speichern") { _, _ ->
                val newHidden = HashSet<String>()
                all.forEachIndexed { i, g -> if (!checked[i]) newHidden.add(g) }
                store.hiddenGroups = newHidden
                status("Kategorien gespeichert", 2000)
            }
            .setNeutralButton("Alle zeigen") { _, _ ->
                store.hiddenGroups = emptySet()
                status("Alle Kategorien sichtbar", 2000)
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun clearCache() {
        runCatching { cacheFile.delete() }
        runCatching { cacheDir.deleteRecursively() }
        status("Cache geleert", 2000)
        val url = store.url
        if (url.isNotBlank()) refreshPlaylist(url)
    }

    private fun showInfo() {
        AlertDialog.Builder(this)
            .setTitle("DJ64 1.1")
            .setMessage(
                "Live-TV: ${count(Kind.LIVE)}\nFilme: ${count(Kind.MOVIE)}\nSerien: ${count(Kind.SERIES)}\n" +
                    "Favoriten: ${store.favoriteSet().size}\nNetzwerk: ${networkText()}\n\nPlaylist:\n${store.url.ifBlank { "(keine)" }}"
            )
            .setPositiveButton("OK", null)
            .show()
    }

    // ---------------------------------------------------------------- Playlist

    private fun askForPlaylistUrl() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(store.url)
            hint = "http://…/playlist.m3u"
            setSingleLine(true)
        }
        AlertDialog.Builder(this)
            .setTitle("M3U-Playlist-URL")
            .setView(input)
            .setPositiveButton("Speichern") { _, _ ->
                val url = input.text.toString().trim()
                if (url.isNotEmpty()) {
                    store.url = url
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
                if (parsed.isEmpty()) throw IOException("Keine Einträge in der Playlist gefunden")
                runCatching { cacheFile.writeText(text) }
                handler.post {
                    channels = parsed
                    status("${parsed.size} Einträge geladen", 2500)
                    rerender()
                }
            } catch (e: Exception) {
                handler.post {
                    val hint = if (channels.isEmpty()) "" else " (gespeicherte Liste bleibt aktiv)"
                    status("Playlist-Fehler: ${e.message}$hint", 6000)
                }
            }
        }.start()
    }

    private fun rerender() {
        when (screen) {
            Screen.HOME -> showHome()
            Screen.BROWSE -> showBrowse(browseKind, 0)
            Screen.SETTINGS -> showSettings()
            Screen.PLAYER -> {}
        }
    }

    private fun download(urlStr: String): String {
        var current = urlStr
        var redirects = 0
        while (true) {
            val c = URL(current).openConnection() as HttpURLConnection
            c.connectTimeout = 15000
            c.readTimeout = 60000
            c.instanceFollowRedirects = false
            c.setRequestProperty("User-Agent", "DJ64/1.1")
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

    // ---------------------------------------------------------------- Player

    private fun initPlayer() {
        if (player != null) return
        val dataSource = DefaultHttpDataSource.Factory()
            .setUserAgent("DJ64/1.1")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(15000)
        val p = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(dataSource))
            .build()
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_BUFFERING -> if (screen == Screen.PLAYER) status("Lade …")
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
                    handler.postDelayed(retryRunnable, 3000)
                } else {
                    status("Nicht erreichbar. Mit Zurück zur Liste.")
                }
            }
        })
        playerView.player = p
        player = p
    }

    private fun startStream() {
        val ch = playList.getOrNull(playIndex) ?: return
        player?.apply {
            setMediaItem(MediaItem.fromUri(ch.url))
            prepare()
            playWhenReady = true
        }
    }

    private fun play(list: List<Channel>, index: Int) {
        if (index !in list.indices) return
        playList = list
        playIndex = index
        playKind = list[index].kind
        retries = 0
        store.lastUrl = list[index].url
        handler.removeCallbacks(retryRunnable)
        screen = Screen.PLAYER
        content.visibility = View.GONE
        status(list[index].name)
        startStream()
    }

    private fun exitPlayer() {
        handler.removeCallbacks(retryRunnable)
        player?.stop()
        status(null)
        val pos = playIndex
        showBrowse(playKind, browseCat, pos)
    }

    private fun zap(delta: Int) {
        if (playList.isEmpty()) return
        val next = ((playIndex + delta) % playList.size + playList.size) % playList.size
        play(playList, next)
    }

    private fun seekBy(ms: Long) {
        val p = player ?: return
        val target = (p.currentPosition + ms).coerceAtLeast(0)
        p.seekTo(target)
        status(if (ms > 0) "⏩ +${ms / 1000} s" else "⏪ ${ms / 1000} s", 1200)
    }

    private fun togglePause() {
        val p = player ?: return
        p.playWhenReady = !p.playWhenReady
        status(if (p.playWhenReady) "▶ Weiter" else "⏸ Pause", 1500)
    }

    // ---------------------------------------------------------------- Fernbedienung

    override fun onBackPressed() {
        when (screen) {
            Screen.PLAYER -> exitPlayer()
            Screen.BROWSE, Screen.SETTINGS -> showHome()
            Screen.HOME -> super.onBackPressed()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (screen != Screen.PLAYER) return super.onKeyDown(keyCode, event)

        val live = playKind == Kind.LIVE
        return when (keyCode) {
            KeyEvent.KEYCODE_CHANNEL_UP -> { zap(1); true }
            KeyEvent.KEYCODE_CHANNEL_DOWN -> { zap(-1); true }
            KeyEvent.KEYCODE_DPAD_UP -> if (live) { zap(1); true } else true
            KeyEvent.KEYCODE_DPAD_DOWN -> if (live) { zap(-1); true } else true
            KeyEvent.KEYCODE_DPAD_LEFT ->
                if (live) { exitPlayer(); true } else { seekBy(-10_000); true }
            KeyEvent.KEYCODE_DPAD_RIGHT ->
                if (live) true else { seekBy(10_000); true }
            KeyEvent.KEYCODE_MEDIA_REWIND -> { seekBy(-30_000); true }
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { seekBy(30_000); true }
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                togglePause(); true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER ->
                if (live) { exitPlayer(); true } else { togglePause(); true }
            KeyEvent.KEYCODE_MENU -> { exitPlayer(); true }
            else -> super.onKeyDown(keyCode, event)
        }
    }
}
