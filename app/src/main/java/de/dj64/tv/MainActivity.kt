package de.dj64.tv

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
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
import android.widget.ScrollView
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@androidx.annotation.OptIn(UnstableApi::class)
class MainActivity : Activity() {

    private enum class Screen { HOME, BROWSE, SETTINGS, PLAYER }

    private val navy = 0xFF0B1F4B.toInt()
    private val navyLight = 0xFF16306B.toInt()
    private val yellow = 0xFFFFD400.toInt()
    private val pickImageCode = 42

    private val resizeNames = listOf("Anpassen (Original-Format)", "Gestreckt (Vollbild)", "Zoom (Ränder abschneiden)")
    private val seekChoices = listOf(5, 10, 20, 30, 60)
    private val volumeChoices = listOf(100, 90, 80, 70, 60, 50, 40, 30, 20, 10)
    private val scaleNames = listOf("Klein", "Normal", "Groß", "Sehr groß")
    private val scaleValues = listOf(0.85f, 1.0f, 1.2f, 1.4f)

    private val handler = Handler(Looper.getMainLooper())
    private val hideStatusRunnable = Runnable { status(null) }
    private val retryRunnable = Runnable { startStream() }

    private lateinit var store: Store
    private lateinit var content: FrameLayout
    private lateinit var playerView: PlayerView
    private lateinit var statusView: TextView
    private val cacheFile by lazy { File(filesDir, "playlist.m3u") }
    private val bgFile by lazy { File(filesDir, "bg.jpg") }

    private var player: ExoPlayer? = null
    private var screen = Screen.HOME
    private var uiScale = 1f

    private var channels: List<Channel> = emptyList()
    private var headerEpgUrl = ""
    private var epg: Epg? = null

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
    private var infoPending = false

    // ---------------------------------------------------------------- Lebenszyklus

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        store = Store(this)
        uiScale = store.uiScale
        buildRoot()
        applyBackground()

        if (cacheFile.exists()) {
            runCatching {
                val pl = M3uParser.parse(cacheFile.readText())
                channels = pl.channels
                headerEpgUrl = pl.epgUrl
            }
        }
        showHome()
        loadEpg()

        val url = store.playlistUrl()
        if (url.isBlank()) showAccountDialog() else refreshPlaylist(url)
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

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density * uiScale).toInt()

    private fun ts(v: Float): Float = v * uiScale

    private fun buildRoot() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        playerView = PlayerView(this).apply {
            useController = false
            isFocusable = false
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        }
        applyResize()
        root.addView(playerView, FrameLayout.LayoutParams(-1, -1))

        content = FrameLayout(this).apply { setBackgroundColor(navy) }
        root.addView(content, FrameLayout.LayoutParams(-1, -1))

        statusView = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 16f
            setBackgroundColor(0xCC000000.toInt())
            setPadding(24, 12, 24, 12)
            visibility = View.GONE
        }
        root.addView(
            statusView,
            FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply {
                setMargins(32, 32, 32, 32)
            }
        )
        setContentView(root)
    }

    private fun applyResize() {
        playerView.resizeMode = when (store.resize) {
            1 -> AspectRatioFrameLayout.RESIZE_MODE_FILL
            2 -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
    }

    private fun applyBackground() {
        val bmp: Bitmap? = if (bgFile.exists()) {
            try {
                BitmapFactory.decodeFile(bgFile.path)
            } catch (e: Throwable) {
                null
            }
        } else null
        if (bmp != null) {
            val layers = arrayOf<Drawable>(
                BitmapDrawable(resources, bmp),
                ColorDrawable(0xB30B1F4B.toInt())
            )
            content.background = LayerDrawable(layers)
        } else {
            content.background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(0xFF0B1F4B.toInt(), 0xFF14307A.toInt(), 0xFF0B1F4B.toInt())
            )
        }
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
            textSize = ts(size)
            setTextColor(color)
            if (bold) setTypeface(typeface, Typeface.BOLD)
        }

    private fun tileBackground(focused: Boolean): GradientDrawable =
        GradientDrawable().apply {
            cornerRadius = dp(18).toFloat()
            setColor(if (focused) 0xFF1F4190.toInt() else 0xCC16306B.toInt())
            setStroke(dp(if (focused) 4 else 1), if (focused) yellow else 0x55FFFFFF)
        }

    private fun tile(icon: String, text: String, big: Boolean, onClick: () -> Unit): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            isFocusable = true
            isClickable = true
            background = tileBackground(false)
            setPadding(dp(10), dp(10), dp(10), dp(10))
            setOnClickListener { onClick() }
            setOnFocusChangeListener { v, focused ->
                v.background = tileBackground(focused)
                val s = if (focused) 1.06f else 1f
                v.animate().scaleX(s).scaleY(s).setDuration(120).start()
            }
        }
        val iconView = label(icon, if (big) 54f else 28f, yellow)
        iconView.gravity = Gravity.CENTER
        val textView = label(text, if (big) 24f else 15f, Color.WHITE, true)
        textView.gravity = Gravity.CENTER
        box.addView(iconView, LinearLayout.LayoutParams(-2, -2))
        box.addView(textView, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(6) })
        return box
    }

    private fun addTile(row: LinearLayout, t: View, w: Int, h: Int) {
        row.addView(t, LinearLayout.LayoutParams(w, h).apply { setMargins(dp(8), dp(8), dp(8), dp(8)) })
    }

    private fun styledAdapter(): ArrayAdapter<String> =
        object : ArrayAdapter<String>(this, android.R.layout.simple_list_item_1) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = super.getView(position, convertView, parent) as TextView
                v.setTextColor(Color.WHITE)
                v.textSize = ts(18f)
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

    private fun refreshAll() {
        val url = store.playlistUrl()
        if (url.isBlank()) showAccountDialog() else refreshPlaylist(url)
    }

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
        addTile(top, tile("⟳", "Aktualisieren", false) { refreshAll() }, dp(150), dp(86))
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
                    "Hier ist noch nichts. Trage unter Einstellungen → Zugangsdaten deine Playlist ein.",
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
            setBackgroundColor(0xCC16306B.toInt())
            selector = ColorDrawable(0x66FFD400)
            divider = null
            isFocusable = true
        }

        val cAdapter = styledAdapter()
        chanAdapter = cAdapter
        val cList = ListView(this).apply {
            adapter = cAdapter
            setBackgroundColor(0xCC0F2860.toInt())
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
        val e = epg
        val now = System.currentTimeMillis()
        adapter.clear()
        adapter.addAll(currentItems.map { c ->
            val star = if (c.url in favs) "★ " else ""
            var suffix = ""
            if (e != null && c.kind == Kind.LIVE) {
                val cur = e.nowNext(c, now).first
                if (cur != null) suffix = "   —   ${cur.title}"
            }
            star + c.name + suffix
        })
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
            setPadding(dp(40), dp(20), dp(40), dp(16))
        }
        page.addView(label("Einstellungen", 34f, yellow, true), LinearLayout.LayoutParams(-2, -2))

        val grid = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        val w = dp(230)
        val h = dp(110)

        val row1 = LinearLayout(this).apply { gravity = Gravity.CENTER }
        val accountTile = tile("👤", "Zugangsdaten", false) { showAccountDialog() }
        addTile(row1, accountTile, w, h)
        addTile(row1, tile("🌐", "Netzwerk / WLAN\n${networkText()}", false) { openNetworkSettings() }, w, h)
        addTile(row1, tile("🔄", "Playlist aktualisieren", false) { refreshAll() }, w, h)
        addTile(row1, tile("🗂", "Kategorien verwalten", false) { manageCategories() }, w, h)

        val row2 = LinearLayout(this).apply { gravity = Gravity.CENTER }
        addTile(row2, tile("⏯", "Player\nSpulen · Ton · Format", false) { playerSettings() }, w, h)
        addTile(row2, tile("🔠", "Darstellungsgröße\n${scaleNames[scaleIndex()]}", false) { pickScale() }, w, h)
        addTile(row2, tile("🖼", "Hintergrundbild", false) { backgroundMenu() }, w, h)
        addTile(row2, tile("📅", "Programmführer (EPG)", false) { epgDialog() }, w, h)

        val row3 = LinearLayout(this).apply { gravity = Gravity.CENTER }
        addTile(row3, tile("🧹", "Cache leeren", false) { clearCache() }, w, h)
        addTile(row3, tile("⚙", "Weitere Einstellungen", false) { openSystemSettings() }, w, h)
        addTile(row3, tile("ℹ", "Info und Tasten", false) { showInfo() }, w, h)

        grid.addView(row1, LinearLayout.LayoutParams(-2, -2))
        grid.addView(row2, LinearLayout.LayoutParams(-2, -2))
        grid.addView(row3, LinearLayout.LayoutParams(-2, -2))

        val scroll = ScrollView(this).apply { addView(grid, FrameLayout.LayoutParams(-1, -2)) }
        page.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        setScreen(page)
        accountTile.post { accountTile.requestFocus() }
    }

    private fun scaleIndex(): Int {
        var best = 1
        var diff = Float.MAX_VALUE
        scaleValues.forEachIndexed { i, v ->
            val d = Math.abs(v - store.uiScale)
            if (d < diff) {
                diff = d
                best = i
            }
        }
        return best
    }

    private fun pickScale() {
        AlertDialog.Builder(this)
            .setTitle("Größe der App-Darstellung")
            .setSingleChoiceItems(scaleNames.toTypedArray(), scaleIndex()) { d, which ->
                store.uiScale = scaleValues[which]
                uiScale = scaleValues[which]
                d.dismiss()
                showSettings()
            }
            .setNegativeButton("Abbrechen", null)
            .show()
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
        val url = store.playlistUrl()
        if (url.isNotBlank()) refreshPlaylist(url)
    }

    // ---- Player-Einstellungen

    private fun playerSettings() {
        val items = arrayOf(
            "Vor-/Zurückspulen: ${store.seekSec} Sekunden",
            "Lautstärke in der App: ${store.volume} %",
            "Bildschirmformat: ${resizeNames[store.resize]}"
        )
        AlertDialog.Builder(this)
            .setTitle("Player")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> pickSeek()
                    1 -> pickVolume()
                    else -> pickResize()
                }
            }
            .setNegativeButton("Schließen", null)
            .show()
    }

    private fun pickSeek() {
        val names = seekChoices.map { "$it Sekunden" }.toTypedArray()
        val cur = seekChoices.indexOf(store.seekSec).coerceAtLeast(0)
        AlertDialog.Builder(this)
            .setTitle("Spulschritt (Links/Rechts)")
            .setSingleChoiceItems(names, cur) { d, which ->
                store.seekSec = seekChoices[which]
                d.dismiss()
                playerSettings()
            }
            .show()
    }

    private fun pickVolume() {
        val names = volumeChoices.map { "$it %" }.toTypedArray()
        val cur = volumeChoices.indexOf(store.volume).coerceAtLeast(0)
        AlertDialog.Builder(this)
            .setTitle("Lautstärke in der App")
            .setSingleChoiceItems(names, cur) { d, which ->
                store.volume = volumeChoices[which]
                player?.volume = store.volume / 100f
                d.dismiss()
                playerSettings()
            }
            .show()
    }

    private fun pickResize() {
        AlertDialog.Builder(this)
            .setTitle("Bildschirmformat")
            .setSingleChoiceItems(resizeNames.toTypedArray(), store.resize) { d, which ->
                store.resize = which
                applyResize()
                d.dismiss()
                playerSettings()
            }
            .show()
    }

    // ---- Zugangsdaten

    private fun showAccountDialog() {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 16, 48, 0)
        }
        fun addField(hint: String, value: String, type: Int): EditText {
            val e = EditText(this).apply {
                setSingleLine(true)
                this.hint = hint
                setText(value)
                inputType = type
            }
            box.addView(e, LinearLayout.LayoutParams(-1, -2))
            return e
        }
        val uri = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        val plain = InputType.TYPE_CLASS_TEXT
        val visiblePass = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD

        box.addView(TextView(this).apply {
            text = "Xtream-Zugang (Server, Benutzername, Passwort)"
            setTextColor(Color.WHITE)
        })
        val server = addField("Server-URL, z. B. http://server.de:8080", store.server, uri)
        val user = addField("Benutzername", store.user, plain)
        val pass = addField("Passwort", store.pass, visiblePass)
        box.addView(TextView(this).apply {
            text = "\noder M3U-Wiedergabeliste (wird genutzt, wenn Server oder Benutzer leer ist)"
            setTextColor(Color.WHITE)
        })
        val m3u = addField("http://…/playlist.m3u", store.url, uri)

        val scroll = ScrollView(this).apply { addView(box) }
        AlertDialog.Builder(this)
            .setTitle("Zugangsdaten")
            .setView(scroll)
            .setPositiveButton("Speichern") { _, _ ->
                store.server = server.text.toString().trim()
                store.user = user.text.toString().trim()
                store.pass = pass.text.toString()
                store.url = m3u.text.toString().trim()
                if (store.playlistUrl().isNotBlank()) refreshPlaylist(store.playlistUrl())
                else status("Keine Zugangsdaten eingetragen", 3000)
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    // ---- EPG

    private fun epgDialog() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(store.epgManual)
            hint = "leer = automatisch"
            setSingleLine(true)
        }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 16, 48, 0)
        }
        val auto = store.epgUrl(headerEpgUrl)
        box.addView(TextView(this).apply {
            text = "EPG-Adresse (XMLTV, auch .gz). Leer lassen, dann nutzt die App " +
                "automatisch die Adresse aus der Playlist oder dem Xtream-Zugang.\n" +
                "Aktuell: " + (if (auto.isBlank()) "keine" else "gefunden") +
                (epg?.let { "  ·  ${it.size()} Sender mit Programm" } ?: "")
            setTextColor(Color.WHITE)
        })
        box.addView(input, LinearLayout.LayoutParams(-1, -2))
        AlertDialog.Builder(this)
            .setTitle("Programmführer (EPG)")
            .setView(ScrollView(this).apply { addView(box) })
            .setPositiveButton("Speichern und laden") { _, _ ->
                store.epgManual = input.text.toString().trim()
                loadEpg(true)
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun loadEpg(verbose: Boolean = false) {
        val url = store.epgUrl(headerEpgUrl)
        if (url.isBlank()) {
            epg = null
            if (verbose) status("Keine EPG-Adresse vorhanden", 3000)
            return
        }
        if (verbose) status("EPG wird geladen …")
        Thread {
            try {
                val loaded = openStream(url).use { Epg.load(it, System.currentTimeMillis()) }
                handler.post {
                    epg = loaded
                    status("EPG geladen: ${loaded.size()} Sender", 2500)
                    if (screen == Screen.BROWSE && browseKind == Kind.LIVE) {
                        val pos = chanList?.selectedItemPosition ?: 0
                        fillChannels(browseCat)
                        chanList?.setSelection(pos.coerceAtLeast(0))
                    }
                }
            } catch (t: Throwable) {
                handler.post { status("EPG-Fehler: ${t.message}", 4000) }
            }
        }.start()
    }

    // ---- Hintergrundbild

    private fun backgroundMenu() {
        val items = arrayOf(
            "Bild aus Datei oder von USB-Stick wählen",
            "Bild von Internet-Adresse laden",
            "Standard-Hintergrund wiederherstellen"
        )
        AlertDialog.Builder(this)
            .setTitle("Hintergrundbild")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> pickBackgroundFile()
                    1 -> backgroundFromUrl()
                    else -> {
                        runCatching { bgFile.delete() }
                        applyBackground()
                        status("Standard-Hintergrund aktiv", 2000)
                    }
                }
            }
            .setNegativeButton("Schließen", null)
            .show()
    }

    private fun pickBackgroundFile() {
        try {
            val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
            }
            @Suppress("DEPRECATION")
            startActivityForResult(i, pickImageCode)
        } catch (e: Exception) {
            status("Keine Dateiauswahl auf diesem Fernseher. Nutze die Internet-Adresse.", 5000)
        }
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != pickImageCode || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        status("Bild wird übernommen …")
        Thread {
            try {
                val bytes = contentResolver.openInputStream(uri)?.use { readLimited(it) }
                    ?: throw IOException("Datei nicht lesbar")
                finishBackground(bytes)
            } catch (t: Throwable) {
                handler.post { status("Bild-Fehler: ${t.message}", 4000) }
            }
        }.start()
    }

    private fun backgroundFromUrl() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            hint = "https://…/bild.jpg"
            setSingleLine(true)
        }
        AlertDialog.Builder(this)
            .setTitle("Internet-Adresse des Bildes")
            .setView(input)
            .setPositiveButton("Laden") { _, _ ->
                val url = input.text.toString().trim()
                if (url.isEmpty()) return@setPositiveButton
                status("Bild wird geladen …")
                Thread {
                    try {
                        val bytes = openStream(url).use { readLimited(it) }
                        finishBackground(bytes)
                    } catch (t: Throwable) {
                        handler.post { status("Bild-Fehler: ${t.message}", 4000) }
                    }
                }.start()
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun readLimited(input: InputStream): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(32768)
        var total = 0
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            total += n
            if (total > 20_000_000) throw IOException("Bild ist zu groß")
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    private fun finishBackground(bytes: ByteArray) {
        val ok = saveBackground(bytes)
        handler.post {
            if (ok) {
                applyBackground()
                status("Hintergrundbild gesetzt", 2500)
            } else {
                status("Das Bild konnte nicht gelesen werden", 4000)
            }
        }
    }

    private fun saveBackground(bytes: ByteArray): Boolean {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return false
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= 1920 && bounds.outHeight / (sample * 2) >= 1080) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val src = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: return false

        val target = 16f / 9f
        val ratio = src.width.toFloat() / src.height
        val cw: Int
        val ch: Int
        if (ratio > target) {
            ch = src.height
            cw = (src.height * target).toInt()
        } else {
            cw = src.width
            ch = (src.width / target).toInt()
        }
        val cropped = Bitmap.createBitmap(src, (src.width - cw) / 2, (src.height - ch) / 2, cw, ch)
        val scaled = Bitmap.createScaledBitmap(cropped, 1920, 1080, true)
        bgFile.outputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        return true
    }

    // ---- Info

    private fun hostOf(url: String): String =
        try {
            URL(url).host
        } catch (e: Exception) {
            "?"
        }

    private fun showInfo() {
        val source = if (store.usesXtream()) {
            "Xtream: ${hostOf(store.playlistUrl())} (Benutzer ${store.user})"
        } else if (store.playlistUrl().isNotBlank()) {
            "M3U: ${hostOf(store.playlistUrl())}"
        } else "(keine)"
        AlertDialog.Builder(this)
            .setTitle("DJ64 1.2")
            .setMessage(
                "Live-TV: ${count(Kind.LIVE)}   Filme: ${count(Kind.MOVIE)}   Serien: ${count(Kind.SERIES)}\n" +
                    "Favoriten: ${store.favoriteSet().size}\nNetzwerk: ${networkText()}\nQuelle: $source\n\n" +
                    "Tasten beim Abspielen:\n" +
                    "• Live: Hoch/Runter = Sender wechseln, OK/Links = Liste\n" +
                    "• Film/Serie: Links/Rechts = Spulen, OK = Pause, Hoch/Runter = App-Lautstärke\n" +
                    "• Rote Taste = Bildschirmformat wechseln\n" +
                    "• Zurück = zur Liste"
            )
            .setPositiveButton("OK", null)
            .show()
    }

    // ---------------------------------------------------------------- Playlist

    private fun refreshPlaylist(url: String) {
        status("Playlist wird geladen …")
        Thread {
            try {
                val text = openStream(url).bufferedReader(Charsets.UTF_8).use { it.readText() }
                val parsed = M3uParser.parse(text)
                if (parsed.channels.isEmpty()) throw IOException("Keine Einträge in der Playlist gefunden")
                runCatching { cacheFile.writeText(text) }
                handler.post {
                    channels = parsed.channels
                    headerEpgUrl = parsed.epgUrl
                    status("${parsed.channels.size} Einträge geladen", 2500)
                    rerender()
                    loadEpg()
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

    private fun openStream(urlStr: String): InputStream {
        var current = urlStr
        var redirects = 0
        while (true) {
            val c = URL(current).openConnection() as HttpURLConnection
            c.connectTimeout = 15000
            c.readTimeout = 60000
            c.instanceFollowRedirects = false
            c.setRequestProperty("User-Agent", "DJ64/1.2")
            val code = c.responseCode
            if (code in 300..399 && redirects < 5) {
                val loc = c.getHeaderField("Location") ?: throw IOException("Weiterleitung ohne Ziel")
                current = URL(URL(current), loc).toString()
                c.disconnect()
                redirects++
                continue
            }
            if (code !in 200..299) throw IOException("HTTP $code")
            return c.inputStream
        }
    }

    // ---------------------------------------------------------------- Player

    private fun initPlayer() {
        if (player != null) return
        val dataSource = DefaultHttpDataSource.Factory()
            .setUserAgent("DJ64/1.2")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(15000)
        val p = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(dataSource))
            .build()
        p.volume = store.volume / 100f
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_BUFFERING -> if (screen == Screen.PLAYER) status("Lade …")
                    Player.STATE_READY -> {
                        retries = 0
                        if (infoPending) {
                            infoPending = false
                            showNowInfo()
                        } else {
                            status(null)
                        }
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

    private fun hm(ms: Long): String = SimpleDateFormat("HH:mm", Locale.GERMANY).format(Date(ms))

    private fun showNowInfo() {
        val ch = playList.getOrNull(playIndex) ?: return
        val sb = StringBuilder(ch.name)
        val e = epg
        if (e != null && ch.kind == Kind.LIVE) {
            val (cur, next) = e.nowNext(ch, System.currentTimeMillis())
            if (cur != null) sb.append("\nJetzt: ${hm(cur.start)}–${hm(cur.stop)}  ${cur.title}")
            if (next != null) sb.append("\nDanach: ${hm(next.start)}  ${next.title}")
        }
        status(sb.toString(), 5000)
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
        infoPending = true
        store.lastUrl = list[index].url
        handler.removeCallbacks(retryRunnable)
        screen = Screen.PLAYER
        content.visibility = View.GONE
        status(list[index].name)
        startStream()
    }

    private fun exitPlayer() {
        handler.removeCallbacks(retryRunnable)
        infoPending = false
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

    private fun changeVolume(delta: Int) {
        val v = (store.volume + delta).coerceIn(0, 100)
        store.volume = v
        player?.volume = v / 100f
        status("🔊 $v %", 1200)
    }

    private fun cycleResize() {
        store.resize = (store.resize + 1) % 3
        applyResize()
        status("Format: ${resizeNames[store.resize]}", 1800)
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
        val step = store.seekSec * 1000L
        return when (keyCode) {
            KeyEvent.KEYCODE_CHANNEL_UP -> { zap(1); true }
            KeyEvent.KEYCODE_CHANNEL_DOWN -> { zap(-1); true }
            KeyEvent.KEYCODE_DPAD_UP -> {
                if (live) zap(1) else changeVolume(10)
                true
            }
            KeyEvent.KEYCODE_DPAD_DOWN -> {
                if (live) zap(-1) else changeVolume(-10)
                true
            }
            KeyEvent.KEYCODE_DPAD_LEFT -> {
                if (live) exitPlayer() else seekBy(-step)
                true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT -> {
                if (!live) seekBy(step)
                true
            }
            KeyEvent.KEYCODE_MEDIA_REWIND -> { seekBy(-3 * step); true }
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { seekBy(3 * step); true }
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                togglePause(); true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                if (live) exitPlayer() else togglePause()
                true
            }
            KeyEvent.KEYCODE_PROG_RED -> { cycleResize(); true }
            KeyEvent.KEYCODE_MENU -> { exitPlayer(); true }
            else -> super.onKeyDown(keyCode, event)
        }
    }
}
