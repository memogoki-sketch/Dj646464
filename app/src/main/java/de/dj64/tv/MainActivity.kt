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
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.BaseAdapter
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
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
import java.io.ByteArrayOutputStream
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

    private class AppTheme(val name: String, val accent: Int, val bg: IntArray)

    private val themes = listOf(
        AppTheme("DJ64 Blau-Gelb", 0xFFFFD400.toInt(), intArrayOf(0xFF0B1F4B.toInt(), 0xFF14307A.toInt(), 0xFF0B1F4B.toInt())),
        AppTheme("Mitternacht Violett", 0xFFB388FF.toInt(), intArrayOf(0xFF120B2E.toInt(), 0xFF2A1560.toInt(), 0xFF120B2E.toInt())),
        AppTheme("Dunkel Grün", 0xFF00E5A0.toInt(), intArrayOf(0xFF08201C.toInt(), 0xFF0F3D35.toInt(), 0xFF08201C.toInt()))
    )
    private val fontNames = listOf("Modern", "Kompakt", "Klassisch")
    private val marginNames = listOf("Aus", "Klein", "Mittel", "Groß", "Sehr groß")
    private val marginDp = listOf(0, 12, 24, 36, 48)
    private val resizeNames = listOf("Anpassen (Original-Format)", "Gestreckt (Vollbild)", "Zoom (Ränder abschneiden)")
    private val seekChoices = listOf(5, 10, 20, 30, 60)
    private val volumeChoices = listOf(100, 90, 80, 70, 60, 50, 40, 30, 20, 10)
    private val scaleNames = listOf("Klein", "Normal", "Groß", "Sehr groß")
    private val scaleValues = listOf(0.85f, 1.0f, 1.2f, 1.4f)
    private val pickImageCode = 42

    private val handler = Handler(Looper.getMainLooper())
    private val hideStatusRunnable = Runnable { status(null) }
    private val retryRunnable = Runnable { startStream() }
    private val previewRunnable = Runnable {
        val ch = pendingPreview
        if (ch != null && screen == Screen.BROWSE && browseKind == Kind.LIVE) loadStream(ch, false)
    }
    private val clockRunnable = object : Runnable {
        override fun run() {
            updateClock()
            if (screen == Screen.HOME) handler.postDelayed(this, 15000)
        }
    }

    private lateinit var store: Store
    private lateinit var root: FrameLayout
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

    // Startseite
    private var clockView: TextView? = null
    private var dateView: TextView? = null

    // Browse-Zustand
    private var browseKind = Kind.LIVE
    private var browseCat = 0
    private var browseQuery = ""
    private var catGroups: List<String> = emptyList()
    private var currentItems: List<Channel> = emptyList()
    private var chanList: ListView? = null
    private var chanAdapter: ChannelAdapter? = null
    private var pendingPreview: Channel? = null

    // Infofeld rechts neben der Senderliste
    private var infoName: TextView? = null
    private var infoTime: TextView? = null
    private var infoProgress: ProgressBar? = null
    private var infoDesc: TextView? = null
    private var infoNext: TextView? = null

    // Wiedergabe-Zustand
    private var streamChannel: Channel? = null
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
        applyMargin()

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
        val ch = streamChannel
        if (ch != null && (screen == Screen.PLAYER || (screen == Screen.BROWSE && browseKind == Kind.LIVE))) {
            loadStream(ch, true)
        }
    }

    override fun onStop() {
        super.onStop()
        handler.removeCallbacks(retryRunnable)
        handler.removeCallbacks(previewRunnable)
        player?.release()
        player = null
    }

    // ---------------------------------------------------------------- Grundgerüst

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density * uiScale).toInt()

    private fun ts(v: Float): Float = v * uiScale

    private fun accent(): Int = themes[store.theme.coerceIn(0, themes.size - 1)].accent

    private fun font(bold: Boolean): Typeface = when (store.fontStyle) {
        1 -> Typeface.create("sans-serif-condensed", if (bold) Typeface.BOLD else Typeface.NORMAL)
        2 -> if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        else -> Typeface.create(if (bold) "sans-serif-medium" else "sans-serif", Typeface.NORMAL)
    }

    private fun lightFont(): Typeface =
        if (store.fontStyle == 0) Typeface.create("sans-serif-light", Typeface.NORMAL) else font(false)

    private fun buildRoot() {
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        content = FrameLayout(this)
        root.addView(content, FrameLayout.LayoutParams(-1, -1))

        playerView = PlayerView(this).apply {
            useController = false
            isFocusable = false
            visibility = View.GONE
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        }
        applyResize()
        root.addView(playerView, FrameLayout.LayoutParams(-1, -1))

        statusView = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 16f
            typeface = font(false)
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

    private fun applyMargin() {
        val m = dp(marginDp[store.margin.coerceIn(0, marginDp.size - 1)])
        content.setPadding(m, m, m, m)
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
                ColorDrawable(0xB3000000.toInt() or (themes[store.theme].bg[0] and 0x00FFFFFF))
            )
            content.background = LayerDrawable(layers)
        } else {
            content.background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                themes[store.theme.coerceIn(0, themes.size - 1)].bg
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
            typeface = font(bold)
        }

    private fun lp(w: Int, h: Int, weight: Float = 0f): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(w, h, weight)

    private fun lpMargin(w: Int, h: Int, weight: Float, m: Int): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(w, h, weight).apply { setMargins(m, m, m, m) }

    private fun icon(res: Int, sizeDp: Int, color: Int = Color.WHITE): ImageView {
        val iv = ImageView(this)
        try {
            iv.setImageDrawable(resources.getDrawable(res, theme))
            iv.setColorFilter(color)
        } catch (t: Throwable) {
            // Icon fehlt: dann bleibt die Fläche leer
        }
        iv.layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
        return iv
    }

    private fun tileBg(colors: IntArray?, orient: GradientDrawable.Orientation, focused: Boolean): GradientDrawable {
        val d = if (colors != null) {
            GradientDrawable(orient, colors)
        } else {
            GradientDrawable().apply { setColor(if (focused) 0x66FFFFFF else 0x33FFFFFF) }
        }
        d.cornerRadius = dp(16).toFloat()
        d.setStroke(dp(if (focused) 4 else 0), accent())
        return d
    }

    private fun focusEffect(v: View, bg: (Boolean) -> Drawable) {
        v.background = bg(false)
        v.setOnFocusChangeListener { view, focused ->
            view.background = bg(focused)
            val s = if (focused) 1.05f else 1f
            view.animate().scaleX(s).scaleY(s).setDuration(120).start()
        }
    }

    /** Große, hochformatige Kachel mit Icon, Titel und Untertitel. */
    private fun tile(
        iconRes: Int, title: String, subtitle: String?, big: Boolean,
        colors: IntArray?, orient: GradientDrawable.Orientation, onClick: () -> Unit
    ): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            isFocusable = true
            isClickable = true
            setPadding(dp(10), dp(10), dp(10), dp(10))
            setOnClickListener { onClick() }
        }
        focusEffect(box) { f -> tileBg(colors, orient, f) }
        box.addView(icon(iconRes, if (big) 72 else 30))
        val t = label(title, if (big) 26f else 15f, Color.WHITE, true)
        t.gravity = Gravity.CENTER
        box.addView(t, lp(-2, -2).apply { topMargin = dp(if (big) 12 else 6) })
        if (subtitle != null) {
            val s = label(subtitle, if (big) 17f else 13f, 0xCCFFFFFF.toInt())
            s.gravity = Gravity.CENTER
            box.addView(s, lp(-2, -2))
        }
        return box
    }

    /** Flache, breite Kachel: Icon links, Text rechts. */
    private fun smallTile(iconRes: Int, title: String, colors: IntArray?, onClick: () -> Unit): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isFocusable = true
            isClickable = true
            setPadding(dp(18), dp(10), dp(18), dp(10))
            setOnClickListener { onClick() }
        }
        focusEffect(box) { f -> tileBg(colors, GradientDrawable.Orientation.LEFT_RIGHT, f) }
        box.addView(icon(iconRes, 30))
        box.addView(label(title, 20f, Color.WHITE, true), lp(-2, -2).apply { leftMargin = dp(12) })
        return box
    }

    private fun iconButton(iconRes: Int, onClick: () -> Unit): FrameLayout {
        val size = dp(52)
        val fl = FrameLayout(this).apply {
            isFocusable = true
            isClickable = true
            setOnClickListener { onClick() }
        }
        focusEffect(fl) { f ->
            GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(if (f) 0x77FFFFFF else 0x33FFFFFF)
                setStroke(dp(if (f) 3 else 0), accent())
            }
        }
        fl.addView(icon(iconRes, 26), FrameLayout.LayoutParams(dp(26), dp(26), Gravity.CENTER))
        fl.layoutParams = lpMargin(size, size, 0f, dp(5))
        return fl
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

    private fun updateClock() {
        val now = Date()
        clockView?.text = SimpleDateFormat("HH:mm", Locale.GERMANY).format(now)
        dateView?.text = SimpleDateFormat("EEEE, d. MMMM yyyy", Locale.GERMANY).format(now)
    }

    private fun showHome() {
        screen = Screen.HOME
        handler.removeCallbacks(previewRunnable)
        hidePlayer()

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(40), dp(20), dp(40), dp(20))
        }

        val top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val timeBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val clock = label("", 54f, Color.WHITE)
        clock.typeface = lightFont()
        val date = label("", 17f, 0xCCFFFFFF.toInt())
        timeBox.addView(clock)
        timeBox.addView(date)
        clockView = clock
        dateView = date
        top.addView(timeBox, lp(0, -2, 1f))
        top.addView(iconButton(R.drawable.ic_search) { showSearchDialog(Kind.LIVE) })
        top.addView(iconButton(R.drawable.ic_heart) { showBrowse(Kind.LIVE, 1) })
        top.addView(iconButton(R.drawable.ic_user) { showAccountDialog() })
        top.addView(iconButton(R.drawable.ic_refresh) { refreshAll() })
        page.addView(top, lp(-1, -2))

        val grid = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val live = tile(
            R.drawable.ic_live, "Live-TV", "${count(Kind.LIVE)} Sender", true,
            intArrayOf(0xFF00D49A.toInt(), 0xFF3A56E8.toInt()), GradientDrawable.Orientation.TOP_BOTTOM
        ) { showBrowse(Kind.LIVE, 0) }
        grid.addView(live, lpMargin(0, -1, 1f, dp(7)))

        val right = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val topRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val movies = tile(
            R.drawable.ic_movie, "Filme", "${count(Kind.MOVIE)} Titel", true,
            intArrayOf(0xFFA23BB8.toInt(), 0xFF1E9BE8.toInt()), GradientDrawable.Orientation.LEFT_RIGHT
        ) { showBrowse(Kind.MOVIE, 0) }
        val series = tile(
            R.drawable.ic_series, "Serien", "${count(Kind.SERIES)} Folgen", true,
            intArrayOf(0xFFF50A55.toInt(), 0xFFFF9A1F.toInt()), GradientDrawable.Orientation.LEFT_RIGHT
        ) { showBrowse(Kind.SERIES, 0) }
        topRow.addView(movies, lpMargin(0, -1, 1f, dp(7)))
        topRow.addView(series, lpMargin(0, -1, 1f, dp(7)))
        right.addView(topRow, lp(-1, 0, 3f))

        val botRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val glass: IntArray? = null
        botRow.addView(smallTile(R.drawable.ic_heart, "Favoriten", glass) { showBrowse(Kind.LIVE, 1) }, lpMargin(0, -1, 1f, dp(7)))
        botRow.addView(smallTile(R.drawable.ic_settings, "Einstellungen", glass) { showSettings() }, lpMargin(0, -1, 1f, dp(7)))
        botRow.addView(smallTile(R.drawable.ic_user, "Zugangsdaten", glass) { showAccountDialog() }, lpMargin(0, -1, 1f, dp(7)))
        right.addView(botRow, lp(-1, 0, 1f))
        grid.addView(right, lp(0, -1, 2f))
        page.addView(grid, lp(-1, 0, 1f))

        val sourceText = when {
            store.usesXtream() -> "Xtream"
            store.playlistUrl().isNotBlank() -> "M3U"
            else -> "keine Playlist"
        }
        page.addView(
            label("${channels.size} Einträge  ·  ${networkText()}  ·  $sourceText", 14f, 0xAAFFFFFF.toInt()),
            lp(-2, -2).apply { topMargin = dp(6) }
        )

        setScreen(page)
        handler.removeCallbacks(clockRunnable)
        handler.post(clockRunnable)
        live.post { live.requestFocus() }
    }

    // ---------------------------------------------------------------- Liste mit Kategorien

    private fun groupOf(c: Channel): String = c.group.ifBlank { "Ohne Kategorie" }

    private fun visibleOfKind(kind: Kind): List<Channel> {
        val hidden = store.hiddenGroups
        return channels.filter { it.kind == kind && groupOf(it) !in hidden }
    }

    private class Row {
        lateinit var num: TextView
        lateinit var logo: ImageView
        lateinit var name: TextView
        lateinit var sub: TextView
    }

    private inner class ChannelAdapter : BaseAdapter() {
        var items: List<Channel> = emptyList()
        var favs: Set<String> = emptySet()
        var epgNow: Epg? = null
        var now: Long = 0L

        override fun getCount(): Int = items.size
        override fun getItem(position: Int): Any = items[position]
        override fun getItemId(position: Int): Long = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val row: Row
            val v: View
            if (convertView == null) {
                row = Row()
                v = buildRow(row)
                v.tag = row
            } else {
                v = convertView
                row = v.tag as Row
            }
            val c = items[position]
            row.num.text = (position + 1).toString()
            row.name.text = (if (c.url in favs) "★ " else "") + c.name
            var sub = c.group
            val e = epgNow
            if (e != null && c.kind == Kind.LIVE) {
                val cur = e.nowNext(c, now).first
                if (cur != null) sub = cur.title
            }
            row.sub.text = sub
            Logos.load(c.logo, row.logo)
            return v
        }
    }

    private fun buildRow(h: Row): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(8), dp(14), dp(8))
        }
        h.num = label("", 15f, 0x99FFFFFF.toInt())
        row.addView(h.num, lp(dp(48), -2))
        h.logo = ImageView(this).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
        row.addView(h.logo, lp(dp(60), dp(38)).apply { rightMargin = dp(14) })
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        h.name = label("", 19f, Color.WHITE, true).apply {
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        h.sub = label("", 14f, 0xAAFFFFFF.toInt()).apply {
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        col.addView(h.name)
        col.addView(h.sub)
        row.addView(col, lp(0, -2, 1f))
        return row
    }

    private fun styledAdapter(): ArrayAdapter<String> =
        object : ArrayAdapter<String>(this, android.R.layout.simple_list_item_1) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = super.getView(position, convertView, parent) as TextView
                v.setTextColor(Color.WHITE)
                v.textSize = ts(17f)
                v.typeface = font(false)
                v.maxLines = 1
                v.ellipsize = TextUtils.TruncateAt.END
                v.setPadding(dp(16), dp(12), dp(16), dp(12))
                return v
            }
        }

    private fun listBackground(alpha: Int): Int = (alpha shl 24) or 0x000000

    private fun showBrowse(kind: Kind, startCat: Int, selectPos: Int = -1, query: String = "") {
        screen = Screen.BROWSE
        browseKind = kind
        browseCat = startCat
        browseQuery = query
        handler.removeCallbacks(previewRunnable)
        val live = kind == Kind.LIVE
        if (!live) hidePlayer()
        infoName = null
        infoTime = null
        infoProgress = null
        infoDesc = null
        infoNext = null

        val title = when (kind) {
            Kind.LIVE -> "Live-TV"
            Kind.MOVIE -> "Filme"
            Kind.SERIES -> "Serien"
        }
        val base = visibleOfKind(kind)
        val items = if (query.isBlank()) base else base.filter { it.name.contains(query, ignoreCase = true) }
        val favs = store.favoriteSet()
        val groups = items.map { groupOf(it) }.distinct()
        val groupCounts = items.groupingBy { groupOf(it) }.eachCount()

        val catLabels = ArrayList<String>()
        if (query.isBlank()) {
            catGroups = listOf("", "") + groups
            catLabels.add("Alle (${items.size})")
            catLabels.add("★ Favoriten (${items.count { it.url in favs }})")
            groups.forEach { catLabels.add("$it (${groupCounts[it] ?: 0})") }
        } else {
            catGroups = listOf("")
            catLabels.add("Suchergebnisse (${items.size})")
        }

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(28), dp(16), dp(28), dp(12))
        }

        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val headerText = if (query.isBlank()) title else "$title  ·  Suche: $query"
        header.addView(label(headerText, 28f, accent(), true), lp(0, -2, 1f))
        header.addView(iconButton(R.drawable.ic_search) { showSearchDialog(kind) })
        header.addView(iconButton(R.drawable.ic_settings) { showSettings() })
        page.addView(header, lp(-1, -2))

        if (channels.isEmpty() || items.isEmpty()) {
            page.addView(
                label(
                    if (query.isBlank()) "Hier ist noch nichts. Trage unter Einstellungen → Zugangsdaten deine Playlist ein."
                    else "Nichts gefunden.",
                    18f
                ),
                lp(-2, -2).apply { topMargin = dp(24) }
            )
            setScreen(page)
            return
        }

        val body = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }

        val catAdapter = styledAdapter()
        catAdapter.addAll(catLabels)
        val catList = ListView(this).apply {
            adapter = catAdapter
            background = GradientDrawable().apply { setColor(0x55000000); cornerRadius = dp(14).toFloat() }
            selector = ColorDrawable(0x55FFFFFF)
            divider = null
            isFocusable = true
        }

        val cAdapter = ChannelAdapter()
        chanAdapter = cAdapter
        val cList = ListView(this).apply {
            adapter = cAdapter
            background = GradientDrawable().apply { setColor(0x44000000); cornerRadius = dp(14).toFloat() }
            selector = ColorDrawable(0x55FFFFFF)
            divider = ColorDrawable(0x22FFFFFF)
            dividerHeight = 1
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

        cList.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, pos: Int, id: Long) {
                val ch = currentItems.getOrNull(pos)
                updateInfoPane(ch)
                if (live && ch != null && cList.hasFocus()) schedulePreview(ch)
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        cList.setOnFocusChangeListener { _, has ->
            if (has) {
                val ch = currentItems.getOrNull(cList.selectedItemPosition)
                if (ch != null) {
                    updateInfoPane(ch)
                    if (live) schedulePreview(ch)
                }
            }
        }
        cList.setOnItemClickListener { _, _, pos, _ -> play(currentItems, pos) }
        cList.setOnItemLongClickListener { _, _, pos, _ ->
            toggleFavorite(pos)
            true
        }

        body.addView(catList, lpMargin(0, -1, 2f, dp(5)))
        body.addView(cList, lpMargin(0, -1, if (live) 4.4f else 7f, dp(5)))

        if (live) {
            val pane = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(4), dp(4), dp(4), dp(4))
            }
            val holder = AspectRatioFrameLayout(this).apply {
                setAspectRatio(16f / 9f)
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIXED_WIDTH
                setBackgroundColor(Color.BLACK)
            }
            holder.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ -> positionPlayer(v) }
            pane.addView(holder, lp(-1, -2))

            val name = label("", 19f, Color.WHITE, true).apply {
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            }
            val time = label("", 15f, accent(), true).apply {
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            }
            val bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
                max = 1000
                progress = 0
                progressDrawable.setColorFilter(accent(), android.graphics.PorterDuff.Mode.SRC_IN)
            }
            val desc = label("", 14f, 0xDDFFFFFF.toInt()).apply {
                maxLines = 4
                ellipsize = TextUtils.TruncateAt.END
            }
            val next = label("", 14f, 0xAAFFFFFF.toInt()).apply {
                maxLines = 4
                ellipsize = TextUtils.TruncateAt.END
            }
            pane.addView(name, lp(-1, -2).apply { topMargin = dp(10) })
            pane.addView(time, lp(-1, -2))
            pane.addView(bar, lp(-1, dp(8)).apply { topMargin = dp(6); bottomMargin = dp(6) })
            pane.addView(desc, lp(-1, -2))
            pane.addView(next, lp(-1, -2).apply { topMargin = dp(10) })
            infoName = name
            infoTime = time
            infoProgress = bar
            infoDesc = desc
            infoNext = next
            body.addView(pane, lpMargin(0, -1, 3.8f, dp(5)))
        }
        page.addView(body, lp(-1, 0, 1f).apply { topMargin = dp(6) })

        page.addView(
            label("OK = Vollbild  ·  OK lange drücken = Favorit  ·  Zurück = Startseite", 13f, 0xAAFFFFFF.toInt()),
            lp(-2, -2).apply { topMargin = dp(6) }
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
        val base = visibleOfKind(browseKind)
        val items = if (browseQuery.isBlank()) base else base.filter { it.name.contains(browseQuery, ignoreCase = true) }
        val favs = store.favoriteSet()
        currentItems = if (browseQuery.isNotBlank()) {
            items
        } else when (cat) {
            0 -> items
            1 -> items.filter { it.url in favs }
            else -> {
                val g = catGroups.getOrNull(cat)
                items.filter { groupOf(it) == g }
            }
        }
        val adapter = chanAdapter ?: return
        adapter.items = currentItems
        adapter.favs = favs
        adapter.epgNow = epg
        adapter.now = System.currentTimeMillis()
        adapter.notifyDataSetChanged()
        if (currentItems.isEmpty()) updateInfoPane(null)
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

    private fun showSearchDialog(kind: Kind) {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT
            hint = "Name eingeben"
            setSingleLine(true)
            setText(if (browseKind == kind) browseQuery else "")
        }
        AlertDialog.Builder(this)
            .setTitle(
                when (kind) {
                    Kind.LIVE -> "Live-TV durchsuchen"
                    Kind.MOVIE -> "Filme durchsuchen"
                    Kind.SERIES -> "Serien durchsuchen"
                }
            )
            .setView(input)
            .setPositiveButton("Suchen") { _, _ ->
                showBrowse(kind, 0, -1, input.text.toString().trim())
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    // ---------------------------------------------------------------- Infofeld

    private fun updateInfoPane(ch: Channel?) {
        val name = infoName ?: return
        val time = infoTime ?: return
        val bar = infoProgress ?: return
        val desc = infoDesc ?: return
        val next = infoNext ?: return
        if (ch == null) {
            name.text = ""
            time.text = ""
            bar.progress = 0
            desc.text = ""
            next.text = ""
            return
        }
        name.text = ch.name
        val e = epg
        if (e == null) {
            time.text = "Kein Programmführer geladen"
            bar.progress = 0
            desc.text = ""
            next.text = ""
            return
        }
        val now = System.currentTimeMillis()
        val (cur, upcoming) = e.upcoming(ch, now, 3)
        if (cur != null) {
            time.text = "${hm(cur.start)} – ${hm(cur.stop)}   ${cur.title}"
            val span = (cur.stop - cur.start).coerceAtLeast(1L)
            bar.progress = (((now - cur.start) * 1000L) / span).toInt().coerceIn(0, 1000)
            desc.text = cur.desc
        } else {
            time.text = "Keine Sendungsinfo"
            bar.progress = 0
            desc.text = ""
        }
        next.text = upcoming.joinToString("\n") { "${hm(it.start)}   ${it.title}" }
    }

    private fun positionPlayer(holder: View) {
        if (screen != Screen.BROWSE || browseKind != Kind.LIVE) return
        if (holder.width <= 0 || holder.height <= 0) return
        val a = IntArray(2)
        val b = IntArray(2)
        holder.getLocationOnScreen(a)
        root.getLocationOnScreen(b)
        val old = playerView.layoutParams as? FrameLayout.LayoutParams
        val x = a[0] - b[0]
        val y = a[1] - b[1]
        if (old != null && old.width == holder.width && old.height == holder.height &&
            old.leftMargin == x && old.topMargin == y && playerView.visibility == View.VISIBLE
        ) return
        val lp = FrameLayout.LayoutParams(holder.width, holder.height, Gravity.TOP or Gravity.START)
        lp.leftMargin = x
        lp.topMargin = y
        playerView.layoutParams = lp
        playerView.visibility = View.VISIBLE
    }

    private fun schedulePreview(ch: Channel) {
        pendingPreview = ch
        handler.removeCallbacks(previewRunnable)
        handler.postDelayed(previewRunnable, 700)
    }

    // ---------------------------------------------------------------- Einstellungen

    private fun showSettings() {
        screen = Screen.SETTINGS
        handler.removeCallbacks(previewRunnable)
        hidePlayer()
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(40), dp(20), dp(40), dp(16))
        }
        page.addView(label("Einstellungen", 34f, accent(), true), lp(-2, -2))

        val grid = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        val w = dp(230)
        val h = dp(112)
        val o = GradientDrawable.Orientation.TL_BR

        fun st(res: Int, title: String, sub: String?, action: () -> Unit): LinearLayout =
            tile(res, title, sub, false, null, o, action)

        fun row(vararg tiles: View): LinearLayout {
            val r = LinearLayout(this).apply { gravity = Gravity.CENTER }
            tiles.forEach { r.addView(it, lpMargin(w, h, 0f, dp(7))) }
            return r
        }

        val accountTile = st(R.drawable.ic_user, "Zugangsdaten", if (store.usesXtream()) "Xtream" else "M3U") { showAccountDialog() }
        grid.addView(
            row(
                accountTile,
                st(R.drawable.ic_wifi, "Netzwerk / WLAN", networkText()) { openNetworkSettings() },
                st(R.drawable.ic_refresh, "Playlist aktualisieren", null) { refreshAll() },
                st(R.drawable.ic_folder, "Kategorien verwalten", null) { manageCategories() }
            )
        )
        grid.addView(
            row(
                st(R.drawable.ic_tune, "Player", "Spulen · Ton · Format") { playerSettings() },
                st(R.drawable.ic_text, "Darstellung", "Größe · Rand · Schrift · Farbe") { appearanceMenu() },
                st(R.drawable.ic_image, "Hintergrundbild", null) { backgroundMenu() },
                st(R.drawable.ic_calendar, "Programmführer (EPG)", null) { epgDialog() }
            )
        )
        grid.addView(
            row(
                st(R.drawable.ic_trash, "Cache leeren", null) { clearCache() },
                st(R.drawable.ic_settings, "Weitere Einstellungen", "Android-System") { openSystemSettings() },
                st(R.drawable.ic_info, "Info und Tasten", "Version 1.3") { showInfo() }
            )
        )

        val scroll = ScrollView(this).apply { addView(grid, FrameLayout.LayoutParams(-1, -2)) }
        page.addView(scroll, lp(-1, 0, 1f))

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

    // ---- Darstellung

    private fun appearanceMenu() {
        val items = arrayOf(
            "Größe der App-Darstellung: ${scaleNames[scaleIndex()]}",
            "Bildrand (gegen abgeschnittene Ränder): ${marginNames[store.margin.coerceIn(0, 4)]}",
            "Schriftstil: ${fontNames[store.fontStyle.coerceIn(0, 2)]}",
            "Farbschema: ${themes[store.theme.coerceIn(0, themes.size - 1)].name}"
        )
        AlertDialog.Builder(this)
            .setTitle("Darstellung")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> pickScale()
                    1 -> pickMargin()
                    2 -> pickFont()
                    else -> pickTheme()
                }
            }
            .setNegativeButton("Schließen", null)
            .show()
    }

    private fun appearanceChanged() {
        applyMargin()
        applyBackground()
        showSettings()
        appearanceMenu()
    }

    private fun pickScale() {
        AlertDialog.Builder(this)
            .setTitle("Größe der App-Darstellung")
            .setSingleChoiceItems(scaleNames.toTypedArray(), scaleIndex()) { d, which ->
                store.uiScale = scaleValues[which]
                uiScale = scaleValues[which]
                d.dismiss()
                appearanceChanged()
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun pickMargin() {
        AlertDialog.Builder(this)
            .setTitle("Bildrand")
            .setSingleChoiceItems(marginNames.toTypedArray(), store.margin.coerceIn(0, 4)) { d, which ->
                store.margin = which
                d.dismiss()
                appearanceChanged()
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun pickFont() {
        AlertDialog.Builder(this)
            .setTitle("Schriftstil")
            .setSingleChoiceItems(fontNames.toTypedArray(), store.fontStyle.coerceIn(0, 2)) { d, which ->
                store.fontStyle = which
                d.dismiss()
                appearanceChanged()
            }
            .setNegativeButton("Abbrechen", null)
            .show()
    }

    private fun pickTheme() {
        AlertDialog.Builder(this)
            .setTitle("Farbschema")
            .setSingleChoiceItems(themes.map { it.name }.toTypedArray(), store.theme.coerceIn(0, themes.size - 1)) { d, which ->
                store.theme = which
                d.dismiss()
                appearanceChanged()
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
                        updateInfoPane(currentItems.getOrNull(pos.coerceAtLeast(0)))
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
        val out = ByteArrayOutputStream()
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
            .setTitle("DJ64 1.3")
            .setMessage(
                "Live-TV: ${count(Kind.LIVE)}   Filme: ${count(Kind.MOVIE)}   Serien: ${count(Kind.SERIES)}\n" +
                    "Favoriten: ${store.favoriteSet().size}\nNetzwerk: ${networkText()}\nQuelle: $source\n\n" +
                    "In der Liste:\n" +
                    "• Live-TV: Sender auswählen = Vorschau rechts, OK = Vollbild\n" +
                    "• OK lange drücken = Favorit\n\n" +
                    "Beim Abspielen:\n" +
                    "• Live: Hoch/Runter = Sender wechseln, OK/Links = zurück zur Liste\n" +
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
            Screen.BROWSE -> showBrowse(browseKind, 0, -1, browseQuery)
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
            c.setRequestProperty("User-Agent", "DJ64/1.3")
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
            .setUserAgent("DJ64/1.3")
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
                        if (infoPending && screen == Screen.PLAYER) {
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
                    status("Nicht erreichbar.", 4000)
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

    /** Lädt einen Sender; läuft er schon, passiert nichts (außer force). */
    private fun loadStream(ch: Channel, force: Boolean) {
        val p = player ?: return
        if (!force && streamChannel?.url == ch.url && p.playbackState != Player.STATE_IDLE) return
        streamChannel = ch
        retries = 0
        handler.removeCallbacks(retryRunnable)
        p.setMediaItem(MediaItem.fromUri(ch.url))
        p.prepare()
        p.playWhenReady = true
    }

    private fun startStream() {
        val ch = streamChannel ?: return
        loadStream(ch, true)
    }

    private fun hidePlayer() {
        handler.removeCallbacks(retryRunnable)
        player?.stop()
        streamChannel = null
        playerView.visibility = View.GONE
    }

    private fun play(list: List<Channel>, index: Int) {
        if (index !in list.indices) return
        val ch = list[index]
        handler.removeCallbacks(previewRunnable)
        playList = list
        playIndex = index
        playKind = ch.kind
        store.lastUrl = ch.url
        screen = Screen.PLAYER
        content.visibility = View.GONE
        playerView.layoutParams = FrameLayout.LayoutParams(-1, -1)
        playerView.visibility = View.VISIBLE

        val alreadyPlaying = streamChannel?.url == ch.url && player?.playbackState != Player.STATE_IDLE
        if (alreadyPlaying) {
            infoPending = false
            showNowInfo()
        } else {
            infoPending = true
            status(ch.name)
            loadStream(ch, true)
        }
    }

    private fun exitPlayer() {
        infoPending = false
        status(null)
        val pos = playIndex
        if (playKind != Kind.LIVE) hidePlayer()
        showBrowse(playKind, browseCat, pos, browseQuery)
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
