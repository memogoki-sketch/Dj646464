package de.dj64.tv

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
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
import android.widget.Toast
import androidx.media3.common.C
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@androidx.annotation.OptIn(UnstableApi::class)
class MainActivity : Activity() {

    private enum class Screen { HOME, BROWSE, PLAYER, SETTINGS }

    private class Item(val icon: String, val label: String, val action: () -> Unit)

    private val navy = 0xFF0B1F4B.toInt()
    private val navyLight = 0xFF173A7A.toInt()
    private val yellow = 0xFFFFD400.toInt()
    private val grey = 0xFFB8C4E0.toInt()

    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("dj64", MODE_PRIVATE) }
    private val cacheFile by lazy { File(filesDir, "playlist.m3u") }

    // ------------------------------------------------------------ Daten

    private var channels: List<Channel> = emptyList()
    private var hidden: MutableSet<String> = HashSet()
    private var favorites: MutableSet<String> = HashSet()

    // Kategorien-Ansicht
    private var browseKind = Kind.LIVE
    private var kindVisible: List<Channel> = emptyList()
    private val cats = ArrayList<Pair<String, () -> List<Channel>>>()
    private val catLabels = ArrayList<String>()
    private var catIndex = 0
    private var currentList: List<Channel> = emptyList()

    // Wiedergabe
    private var playList: List<Channel> = emptyList()
    private var playPos = 0
    private var retries = 0
    private var resumeUrl: String? = null
    private var resumePos = 0L
    private var player: ExoPlayer? = null

    // ------------------------------------------------------------ Ansichten

    private var screen = Screen.HOME
    private lateinit var homeView: View
    private lateinit var browseView: View
    private lateinit var settingsView: View
    private lateinit var playerLayer: View

    private lateinit var clockView: TextView
    private lateinit var tileLive: View
    private lateinit var subLive: TextView
    private lateinit var subMovie: TextView
    private lateinit var subSeries: TextView
    private lateinit var homeInfo: TextView

    private lateinit var browseTitle: TextView
    private lateinit var catList: ListView
    private lateinit var chanList: ListView
    private lateinit var catAdapter: ArrayAdapter<String>
    private lateinit var chanAdapter: ArrayAdapter<String>

    private lateinit var settingsFirst: View

    private lateinit var playerView: PlayerView
    private lateinit var nameView: TextView
    private lateinit var statusView: TextView

    private val retryRunnable = Runnable { startPlayback() }
    private val hideName = Runnable { nameView.visibility = View.GONE }
    private val clockTick = object : Runnable {
        override fun run() {
            if (::clockView.isInitialized) {
                clockView.text = SimpleDateFormat("EEE, dd. MMM yyyy   HH:mm", Locale.GERMANY).format(Date())
            }
            handler.postDelayed(this, 20_000)
        }
    }

    // ------------------------------------------------------------ Lebenszyklus

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        hidden = HashSet(prefs.getStringSet("hidden", emptySet()) ?: emptySet())
        favorites = HashSet(prefs.getStringSet("fav", emptySet()) ?: emptySet())

        buildUi()
        show(Screen.HOME)

        val url = playlistUrl()
        if (cacheFile.exists()) {
            Thread {
                val parsed = runCatching { M3uParser.parse(cacheFile.readText()) }.getOrNull()
                if (parsed != null) handler.post { applyChannels(parsed) }
            }.start()
        }
        if (url.isBlank()) {
            askForPlaylistUrl()
        } else {
            val age = System.currentTimeMillis() - prefs.getLong("updated", 0L)
            if (!cacheFile.exists() || age > 6 * 3600 * 1000L) refreshPlaylist(url)
        }
    }

    override fun onStart() {
        super.onStart()
        handler.post(clockTick)
        if (screen == Screen.PLAYER) {
            initPlayer()
            startPlayback()
        }
    }

    override fun onStop() {
        super.onStop()
        val p = player
        if (p != null && screen == Screen.PLAYER) {
            val ch = playList.getOrNull(playPos)
            if (ch != null && ch.kind != Kind.LIVE) {
                resumeUrl = ch.url
                resumePos = p.currentPosition
            }
        }
        handler.removeCallbacks(retryRunnable)
        handler.removeCallbacks(clockTick)
        p?.release()
        player = null
    }

    // ------------------------------------------------------------ Hilfsfunktionen

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun lp(w: Int, h: Int, weight: Float = 0f) = LinearLayout.LayoutParams(w, h, weight)

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    private fun groupName(c: Channel): String = c.group.ifBlank { "Ohne Kategorie" }

    private fun focusBg(radius: Int): StateListDrawable {
        val normal = GradientDrawable().apply {
            setColor(0x33FFFFFF)
            cornerRadius = radius.toFloat()
        }
        val focused = GradientDrawable().apply {
            setColor(navyLight)
            cornerRadius = radius.toFloat()
            setStroke(dp(4), yellow)
        }
        return StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), focused)
            addState(intArrayOf(), normal)
        }
    }

    private fun zoomOnFocus(v: View, scale: Float) {
        v.setOnFocusChangeListener { view, hasFocus ->
            val s = if (hasFocus) scale else 1f
            view.animate().scaleX(s).scaleY(s).setDuration(120).start()
        }
    }

    private fun smallButton(label: String, onClick: () -> Unit): TextView {
        val b = TextView(this)
        b.text = label
        b.textSize = 18f
        b.setTextColor(Color.WHITE)
        b.setPadding(dp(24), dp(12), dp(24), dp(12))
        b.isFocusable = true
        b.isClickable = true
        b.background = focusBg(dp(14))
        b.setOnClickListener { onClick() }
        zoomOnFocus(b, 1.05f)
        return b
    }

    private fun label(text: String, size: Float, color: Int = Color.WHITE, bold: Boolean = false): TextView {
        val t = TextView(this)
        t.text = text
        t.textSize = size
        t.setTextColor(color)
        if (bold) t.typeface = Typeface.DEFAULT_BOLD
        return t
    }

    private fun styledAdapter(textFor: (Int, String?) -> String, highlight: (Int) -> Boolean): ArrayAdapter<String> {
        return object : ArrayAdapter<String>(this@MainActivity, android.R.layout.simple_list_item_1) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = super.getView(position, convertView, parent) as TextView
                v.text = textFor(position, getItem(position))
                v.setTextColor(Color.WHITE)
                v.textSize = 20f
                v.maxLines = 1
                v.setPadding(dp(20), dp(14), dp(20), dp(14))
                v.setBackgroundColor(if (highlight(position)) 0x44FFD400 else Color.TRANSPARENT)
                return v
            }
        }
    }

    // ------------------------------------------------------------ Oberfläche bauen

    private fun buildUi() {
        val root = FrameLayout(this)
        root.background = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(navy, 0xFF071433.toInt())
        )

        homeView = buildHome()
        browseView = buildBrowse()
        settingsView = buildSettings()
        playerLayer = buildPlayer()

        val full = ViewGroup.LayoutParams.MATCH_PARENT
        root.addView(homeView, FrameLayout.LayoutParams(full, full))
        root.addView(browseView, FrameLayout.LayoutParams(full, full))
        root.addView(settingsView, FrameLayout.LayoutParams(full, full))
        root.addView(playerLayer, FrameLayout.LayoutParams(full, full))
        setContentView(root)
    }

    private fun bigTile(icon: String, title: String, onClick: () -> Unit): Pair<View, TextView> {
        val sub = label("", 17f, grey)
        sub.gravity = Gravity.CENTER

        val iconView = label(icon, 72f)
        iconView.gravity = Gravity.CENTER

        val titleView = label(title, 30f, Color.WHITE, true)
        titleView.gravity = Gravity.CENTER
        titleView.setPadding(0, dp(16), 0, dp(4))

        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        box.gravity = Gravity.CENTER
        box.isFocusable = true
        box.isClickable = true
        box.background = focusBg(dp(24))
        box.setOnClickListener { onClick() }
        box.addView(iconView)
        box.addView(titleView)
        box.addView(sub)
        zoomOnFocus(box, 1.06f)
        return Pair(box, sub)
    }

    private fun buildHome(): View {
        val col = LinearLayout(this)
        col.orientation = LinearLayout.VERTICAL
        col.setPadding(dp(48), dp(32), dp(48), dp(32))

        val top = LinearLayout(this)
        top.orientation = LinearLayout.HORIZONTAL
        top.gravity = Gravity.CENTER_VERTICAL

        top.addView(label("DJ64", 36f, yellow, true), lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        clockView = label("", 18f)
        clockView.setPadding(0, 0, dp(24), 0)
        top.addView(clockView)

        top.addView(smallButton("⟳  Aktualisieren") { refreshPlaylist(playlistUrl()) })
        val settingsBtn = smallButton("⚙  Einstellungen") { show(Screen.SETTINGS) }
        val settingsLp = lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        settingsLp.leftMargin = dp(12)
        top.addView(settingsBtn, settingsLp)
        col.addView(top)

        val tiles = LinearLayout(this)
        tiles.orientation = LinearLayout.HORIZONTAL

        val live = bigTile("📺", "Live-TV") { openBrowse(Kind.LIVE) }
        val movies = bigTile("🎬", "Filme") { openBrowse(Kind.MOVIE) }
        val series = bigTile("🍿", "Serien") { openBrowse(Kind.SERIES) }
        tileLive = live.first
        subLive = live.second
        subMovie = movies.second
        subSeries = series.second

        for (t in listOf(live.first, movies.first, series.first)) {
            val p = lp(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f)
            p.setMargins(dp(12), dp(12), dp(12), dp(12))
            tiles.addView(t, p)
        }
        val tilesLp = lp(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        tilesLp.topMargin = dp(24)
        col.addView(tiles, tilesLp)

        homeInfo = label("Playlist wird geladen …", 16f, grey)
        homeInfo.gravity = Gravity.CENTER
        col.addView(homeInfo, lp(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        return col
    }

    private fun buildBrowse(): View {
        val col = LinearLayout(this)
        col.orientation = LinearLayout.VERTICAL
        col.setPadding(dp(32), dp(24), dp(32), dp(16))

        browseTitle = label("Live-TV", 30f, yellow, true)
        browseTitle.setPadding(dp(8), 0, 0, dp(12))
        col.addView(browseTitle)

        val row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL

        catAdapter = styledAdapter(
            { pos, _ -> catLabels.getOrNull(pos) ?: "" },
            { pos -> pos == catIndex }
        )
        chanAdapter = styledAdapter({ _, item -> item ?: "" }, { false })

        catList = ListView(this)
        catList.adapter = catAdapter
        catList.divider = null
        catList.selector = ColorDrawable(0x66FFD400)
        catList.setBackgroundColor(0x33000000)
        catList.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                selectCategory(position)
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        catList.setOnItemClickListener { _, _, _, _ -> chanList.requestFocus() }

        chanList = ListView(this)
        chanList.adapter = chanAdapter
        chanList.divider = null
        chanList.selector = ColorDrawable(0x66FFD400)
        chanList.setBackgroundColor(0x33000000)
        chanList.setOnItemClickListener { _, _, position, _ -> playIndex(position) }
        chanList.setOnItemLongClickListener { _, _, position, _ ->
            toggleFavorite(position)
            true
        }

        row.addView(catList, lp(dp(340), ViewGroup.LayoutParams.MATCH_PARENT))
        val chanLp = lp(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f)
        chanLp.leftMargin = dp(16)
        row.addView(chanList, chanLp)
        col.addView(row, lp(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        val hint = label("OK = abspielen   ·   OK lange drücken oder Menü = Favorit ★   ·   Zurück = Startseite", 14f, grey)
        hint.setPadding(dp(8), dp(10), 0, 0)
        col.addView(hint)
        return col
    }

    private fun buildSettings(): View {
        val col = LinearLayout(this)
        col.orientation = LinearLayout.VERTICAL
        col.setPadding(dp(48), dp(32), dp(48), dp(32))

        val title = label("⚙  Einstellungen", 34f, Color.WHITE, true)
        title.gravity = Gravity.CENTER
        title.setPadding(0, 0, 0, dp(16))
        col.addView(title)

        val items = listOf(
            Item("🌐", "Netzwerk / WLAN") { openWifi() },
            Item("📋", "Playlist ändern") { askForPlaylistUrl() },
            Item("🔄", "Playlist aktualisieren") {
                refreshPlaylist(playlistUrl())
                show(Screen.HOME)
            },
            Item("🧹", "Cache leeren") { clearCache() },
            Item("🗂", "Kategorien verwalten") { manageCategories() },
            Item("⭐", "Favoriten löschen") { clearFavorites() },
            Item("🛠", "Systemeinstellungen") { openSystemSettings() },
            Item("ℹ", "Info") { showInfo() }
        )

        var first = true
        for (rowItems in items.chunked(3)) {
            val row = LinearLayout(this)
            row.orientation = LinearLayout.HORIZONTAL
            for (i in 0 until 3) {
                if (i < rowItems.size) {
                    val tile = settingTile(rowItems[i])
                    if (first) {
                        settingsFirst = tile
                        first = false
                    }
                    val p = lp(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f)
                    p.setMargins(dp(10), dp(10), dp(10), dp(10))
                    row.addView(tile, p)
                } else {
                    row.addView(View(this), lp(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
                }
            }
            col.addView(row, lp(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        return col
    }

    private fun settingTile(item: Item): View {
        val icon = label(item.icon, 44f)
        icon.gravity = Gravity.CENTER
        val text = label(item.label, 22f, Color.WHITE, true)
        text.gravity = Gravity.CENTER
        text.setPadding(dp(8), dp(10), dp(8), 0)

        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        box.gravity = Gravity.CENTER
        box.isFocusable = true
        box.isClickable = true
        box.background = focusBg(dp(20))
        box.setOnClickListener { item.action() }
        box.addView(icon)
        box.addView(text)
        zoomOnFocus(box, 1.05f)
        return box
    }

    private fun buildPlayer(): View {
        val layer = FrameLayout(this)
        layer.setBackgroundColor(Color.BLACK)

        playerView = PlayerView(this)
        playerView.useController = false
        playerView.isFocusable = false
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        layer.addView(playerView, FrameLayout.LayoutParams(-1, -1))

        nameView = label("", 22f)
        nameView.setBackgroundColor(0xAA000000.toInt())
        nameView.setPadding(dp(20), dp(12), dp(20), dp(12))
        val nameLp = FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START)
        nameLp.setMargins(dp(24), dp(24), dp(24), dp(24))
        layer.addView(nameView, nameLp)

        statusView = label("", 18f)
        statusView.setBackgroundColor(0xAA000000.toInt())
        statusView.setPadding(dp(20), dp(12), dp(20), dp(12))
        statusView.visibility = View.GONE
        val statusLp = FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL)
        statusLp.bottomMargin = dp(48)
        layer.addView(statusView, statusLp)
        return layer
    }

    // ------------------------------------------------------------ Navigation

    private fun show(s: Screen) {
        if (screen == Screen.PLAYER && s != Screen.PLAYER) {
            handler.removeCallbacks(retryRunnable)
            player?.stop()
            player?.clearMediaItems()
            showStatus(null)
        }
        screen = s
        homeView.visibility = if (s == Screen.HOME) View.VISIBLE else View.GONE
        browseView.visibility = if (s == Screen.BROWSE) View.VISIBLE else View.GONE
        settingsView.visibility = if (s == Screen.SETTINGS) View.VISIBLE else View.GONE
        playerLayer.visibility = if (s == Screen.PLAYER) View.VISIBLE else View.GONE
        when (s) {
            Screen.HOME -> tileLive.requestFocus()
            Screen.SETTINGS -> settingsFirst.requestFocus()
            else -> {}
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        when (screen) {
            Screen.PLAYER -> {
                show(Screen.BROWSE)
                chanList.requestFocus()
                chanList.setSelection(playPos)
            }
            Screen.BROWSE, Screen.SETTINGS -> show(Screen.HOME)
            Screen.HOME -> super.onBackPressed()
        }
    }

    // ------------------------------------------------------------ Playlist

    private fun playlistUrl(): String =
        prefs.getString("url", null)?.takeIf { it.isNotBlank() } ?: Config.DEFAULT_PLAYLIST_URL

    private fun askForPlaylistUrl() {
        val input = EditText(this)
        input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        input.setText(playlistUrl())
        input.hint = "http://…/playlist.m3u"
        input.setSingleLine(true)
        AlertDialog.Builder(this)
            .setTitle("M3U-Playlist-URL")
            .setView(input)
            .setPositiveButton("Speichern") { _, _ ->
                val url = input.text.toString().trim()
                if (url.isNotEmpty()) {
                    prefs.edit().putString("url", url).apply()
                    refreshPlaylist(url)
                    show(Screen.HOME)
                }
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun refreshPlaylist(url: String) {
        if (url.isBlank()) {
            askForPlaylistUrl()
            return
        }
        homeInfo.text = "Playlist wird geladen …"
        Thread {
            try {
                val text = download(url)
                val parsed = M3uParser.parse(text)
                if (parsed.isEmpty()) throw IOException("Keine Sender in der Playlist gefunden")
                runCatching { cacheFile.writeText(text) }
                prefs.edit().putLong("updated", System.currentTimeMillis()).apply()
                handler.post {
                    applyChannels(parsed)
                    toast("${parsed.size} Einträge geladen")
                }
            } catch (e: Exception) {
                handler.post {
                    homeInfo.text = "Playlist-Fehler: ${e.message}"
                    toast("Playlist-Fehler: ${e.message}")
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

    private fun applyChannels(list: List<Channel>) {
        channels = list
        updateHomeInfo()
        if (screen == Screen.BROWSE) openBrowse(browseKind)
    }

    private fun updateHomeInfo() {
        var live = 0
        var movies = 0
        var series = 0
        for (c in channels) {
            when (c.kind) {
                Kind.LIVE -> live++
                Kind.MOVIE -> movies++
                Kind.SERIES -> series++
            }
        }
        subLive.text = "$live Sender"
        subMovie.text = "$movies Filme"
        subSeries.text = "$series Folgen"
        val updated = prefs.getLong("updated", 0L)
        val stamp = if (updated > 0) SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMANY).format(Date(updated)) else "–"
        homeInfo.text = "${channels.size} Einträge   ·   zuletzt aktualisiert: $stamp"
    }

    // ------------------------------------------------------------ Kategorien und Listen

    private fun openBrowse(kind: Kind) {
        browseKind = kind
        browseTitle.text = when (kind) {
            Kind.LIVE -> "📺  Live-TV"
            Kind.MOVIE -> "🎬  Filme"
            Kind.SERIES -> "🍿  Serien"
        }
        buildCategories(kind)
        catIndex = 0
        catAdapter.clear()
        catAdapter.addAll(catLabels)
        catAdapter.notifyDataSetChanged()
        show(Screen.BROWSE)
        selectCategory(0)
        catList.setSelection(0)
        catList.requestFocus()
    }

    private fun buildCategories(kind: Kind) {
        val vis = channels.filter { it.kind == kind && !hidden.contains(groupName(it)) }
        kindVisible = vis
        val groups = LinkedHashMap<String, MutableList<Channel>>()
        for (c in vis) groups.getOrPut(groupName(c)) { ArrayList() }.add(c)

        cats.clear()
        catLabels.clear()
        cats.add(Pair<String, () -> List<Channel>>("Alle", { vis }))
        catLabels.add("Alle  (${vis.size})")
        cats.add(Pair<String, () -> List<Channel>>("★ Favoriten", { vis.filter { favorites.contains(it.url) } }))
        catLabels.add("★ Favoriten  (${vis.count { favorites.contains(it.url) }})")
        for ((name, list) in groups) {
            cats.add(Pair<String, () -> List<Channel>>(name, { list }))
            catLabels.add("$name  (${list.size})")
        }
    }

    private fun selectCategory(i: Int) {
        if (i !in cats.indices) return
        catIndex = i
        currentList = cats[i].second()
        refreshChannelAdapter()
        catAdapter.notifyDataSetChanged()
        chanList.setSelection(0)
    }

    private fun refreshChannelAdapter() {
        chanAdapter.clear()
        chanAdapter.addAll(currentList.map { (if (favorites.contains(it.url)) "★  " else "") + it.name })
        chanAdapter.notifyDataSetChanged()
    }

    private fun toggleFavorite(pos: Int) {
        val ch = currentList.getOrNull(pos) ?: return
        if (favorites.contains(ch.url)) {
            favorites.remove(ch.url)
            toast("Aus Favoriten entfernt")
        } else {
            favorites.add(ch.url)
            toast("★ Zu Favoriten hinzugefügt")
        }
        prefs.edit().putStringSet("fav", HashSet(favorites)).apply()

        catLabels[1] = "★ Favoriten  (${kindVisible.count { favorites.contains(it.url) }})"
        if (catIndex == 1) currentList = cats[1].second()
        refreshChannelAdapter()
        catAdapter.notifyDataSetChanged()
        chanList.setSelection(minOf(pos, maxOf(currentList.size - 1, 0)))
    }

    // ------------------------------------------------------------ Player

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
                    Player.STATE_BUFFERING -> showStatus("Lade …")
                    Player.STATE_READY -> {
                        retries = 0
                        showStatus(null)
                    }
                    else -> {}
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                if (retries < 5) {
                    retries++
                    showStatus("Verbindung unterbrochen – neuer Versuch $retries/5 …")
                    handler.postDelayed(retryRunnable, 3000)
                } else {
                    showStatus("Nicht erreichbar. Mit Zurück zur Liste.")
                }
            }
        })
        playerView.player = p
        player = p
    }

    private fun showStatus(text: String?) {
        if (text.isNullOrEmpty()) {
            statusView.visibility = View.GONE
        } else {
            statusView.text = text
            statusView.visibility = View.VISIBLE
        }
    }

    private fun showName(text: String) {
        nameView.text = text
        nameView.visibility = View.VISIBLE
        handler.removeCallbacks(hideName)
        handler.postDelayed(hideName, 3500)
    }

    private fun playIndex(i: Int) {
        if (i !in currentList.indices) return
        playList = currentList
        playPos = i
        retries = 0
        resumeUrl = null
        show(Screen.PLAYER)
        initPlayer()
        startPlayback()
    }

    private fun startPlayback() {
        val ch = playList.getOrNull(playPos) ?: return
        prefs.edit().putString("last", ch.url).apply()
        showName(ch.name)
        val p = player ?: return
        val start = if (resumeUrl == ch.url) resumePos else 0L
        p.setMediaItem(MediaItem.fromUri(ch.url), start)
        p.prepare()
        p.playWhenReady = true
    }

    private fun zap(delta: Int) {
        if (playList.isEmpty()) return
        handler.removeCallbacks(retryRunnable)
        playPos = (playPos + delta + playList.size) % playList.size
        retries = 0
        resumeUrl = null
        startPlayback()
    }

    private fun formatTime(ms: Long): String {
        val total = ms / 1000
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
    }

    private fun seekBy(deltaMs: Long) {
        val p = player ?: return
        val target = (p.currentPosition + deltaMs).coerceAtLeast(0L)
        p.seekTo(target)
        val dur = p.duration
        val total = if (dur != C.TIME_UNSET && dur > 0) " / " + formatTime(dur) else ""
        showName("${playList.getOrNull(playPos)?.name ?: ""}\n${formatTime(target)}$total")
    }

    // ------------------------------------------------------------ Fernbedienung

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (screen == Screen.BROWSE && keyCode == KeyEvent.KEYCODE_MENU && chanList.hasFocus()) {
            toggleFavorite(chanList.selectedItemPosition)
            return true
        }
        if (screen != Screen.PLAYER) return super.onKeyDown(keyCode, event)

        val isLive = playList.getOrNull(playPos)?.kind == Kind.LIVE
        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> {
                zap(1)
                true
            }
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> {
                zap(-1)
                true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> {
                if (!isLive) seekBy(10_000L)
                true
            }
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> {
                if (!isLive) seekBy(-10_000L)
                true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                val p = player
                if (p != null) {
                    p.playWhenReady = !p.playWhenReady
                    showName((playList.getOrNull(playPos)?.name ?: "") + if (p.playWhenReady) "" else "   ⏸")
                }
                true
            }
            else -> super.onKeyDown(keyCode, event)
        }
    }

    // ------------------------------------------------------------ Einstellungen

    private fun openWifi() {
        val actions = listOf(
            Settings.ACTION_WIFI_SETTINGS,
            Settings.ACTION_WIRELESS_SETTINGS,
            Settings.ACTION_SETTINGS
        )
        for (a in actions) {
            try {
                startActivity(Intent(a))
                return
            } catch (e: Exception) {
                // nächste Möglichkeit versuchen
            }
        }
        toast("Netzwerk-Einstellungen nicht verfügbar")
    }

    private fun openSystemSettings() {
        try {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        } catch (e: Exception) {
            toast("Systemeinstellungen nicht verfügbar")
        }
    }

    private fun clearCache() {
        cacheFile.delete()
        runCatching { cacheDir.listFiles()?.forEach { it.deleteRecursively() } }
        prefs.edit().remove("updated").apply()
        toast("Cache geleert – Playlist wird neu geladen")
        refreshPlaylist(playlistUrl())
        show(Screen.HOME)
    }

    private fun clearFavorites() {
        AlertDialog.Builder(this)
            .setTitle("Alle Favoriten löschen?")
            .setPositiveButton("Löschen") { _, _ ->
                favorites = HashSet()
                prefs.edit().remove("fav").apply()
                toast("Favoriten gelöscht")
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun manageCategories() {
        val names = channels.map { groupName(it) }.distinct().sorted()
        if (names.isEmpty()) {
            toast("Noch keine Playlist geladen")
            return
        }
        val checked = BooleanArray(names.size) { !hidden.contains(names[it]) }
        AlertDialog.Builder(this)
            .setTitle("Kategorien anzeigen / ausblenden")
            .setMultiChoiceItems(names.toTypedArray(), checked) { _, which, isChecked ->
                checked[which] = isChecked
            }
            .setPositiveButton("Speichern") { _, _ ->
                val h = HashSet<String>()
                names.forEachIndexed { i, n -> if (!checked[i]) h.add(n) }
                hidden = h
                prefs.edit().putStringSet("hidden", HashSet(h)).apply()
                toast("Gespeichert")
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun showInfo() {
        val live = channels.count { it.kind == Kind.LIVE }
        val movies = channels.count { it.kind == Kind.MOVIE }
        val series = channels.count { it.kind == Kind.SERIES }
        val host = runCatching { URL(playlistUrl()).host }.getOrDefault("–")
        AlertDialog.Builder(this)
            .setTitle("DJ64  ·  Version 1.1")
            .setMessage(
                "Live-Sender: $live\nFilme: $movies\nSerien-Folgen: $series\n" +
                    "Favoriten: ${favorites.size}\nAusgeblendete Kategorien: ${hidden.size}\n" +
                    "Playlist-Server: $host"
            )
            .setPositiveButton("OK", null)
            .show()
    }
}
