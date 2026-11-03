package de.dj64.tv

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.graphics.SweepGradient
import android.graphics.Typeface
import android.os.SystemClock
import android.view.Choreographer
import android.view.View
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * DJ64-Startanimation im Film-Konzept (gleicher Ablauf wie in der Windows-App).
 * Countdown 3-2-1, Lichtblitz, Schockwelle, Logo, Untertitel, Kamerafahrt.
 */
class IntroView(context: Context, private val accent: Int, private val bgColor: Int, private val short: Boolean, private val onDone: () -> Unit) : View(context) {

    companion object {
        const val HIT = 2.2f
        const val DUR = 5.6f
        const val SHORT_OFFSET = 2.1f
    }

    private val offset = if (short) SHORT_OFFSET else 0f
    private val dur = if (short) DUR - SHORT_OFFSET else DUR
    private var t0 = 0L
    private var finished = false
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val black = Typeface.create("sans-serif-black", Typeface.NORMAL)
    private val bold = Typeface.create("sans-serif-medium", Typeface.NORMAL)

    private val cb = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (finished) return
            invalidate()
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    init {
        isFocusable = true
        isFocusableInTouchMode = true
        setBackgroundColor(Color.BLACK)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        t0 = SystemClock.uptimeMillis()
        Choreographer.getInstance().postFrameCallback(cb)
        requestFocus()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        Choreographer.getInstance().removeFrameCallback(cb)
    }

    fun skip() {
        if (finished) return
        finished = true
        Choreographer.getInstance().removeFrameCallback(cb)
        onDone()
    }

    // ------------------------------------------------------------ Hilfsfunktionen

    private fun rnd(n: Float): Float {
        val x = (sin((n * 127.1f + 311.7f).toDouble()) * 43758.5453).toFloat()
        return x - floor(x)
    }
    private fun clamp(v: Float, a: Float = 0f, b: Float = 1f) = min(b, max(a, v))
    private fun ease(x: Float) = 1f - (1f - clamp(x)).pow(3)
    private fun easeIO(x0: Float): Float {
        val x = clamp(x0)
        return if (x < 0.5f) 4 * x * x * x else 1f - (-2 * x + 2).pow(3) / 2f
    }
    private fun col(c: Int, a: Float): Int = Color.argb((clamp(a) * 255).toInt(), Color.red(c), Color.green(c), Color.blue(c))
    private fun scaleC(c: Int, k: Float, add: Int = 0): Int = Color.rgb(
        min(255, (Color.red(c) * k).toInt() + add), min(255, (Color.green(c) * k).toInt() + add), min(255, (Color.blue(c) * k).toInt() + add)
    )

    // ------------------------------------------------------------ Zeichnen

    override fun onTouchEvent(event: android.view.MotionEvent): Boolean {
        if (event.action == android.view.MotionEvent.ACTION_UP) skip()
        return true
    }

    override fun onDraw(c: Canvas) {
        if (finished) return
        val el = (SystemClock.uptimeMillis() - t0) / 1000f
        if (el >= dur) { skip(); return }
        val left = dur - el
        alpha = if (left < 0.5f) left / 0.5f else 1f
        draw(c, width.toFloat(), height.toFloat(), el + offset)
    }

    private fun draw(c: Canvas, W: Float, H: Float, t: Float) {
        val u = H / 1080f
        val f = floor(t * 24f)
        val s = t - HIT
        val lit = clamp((t - HIT + 0.15f) / 0.6f)
        c.drawColor(Color.BLACK)

        // Hintergrundlicht
        p.reset(); p.isAntiAlias = true
        p.shader = RadialGradient(
            W / 2, H * 0.52f, H,
            intArrayOf(col(scaleC(bgColor, 1.9f, 10), 0.6f * lit + 0.1f), col(bgColor, 0.38f * lit + 0.05f), 0),
            floatArrayOf(0f, 0.6f, 1f), Shader.TileMode.CLAMP
        )
        c.drawRect(0f, 0f, W, H, p)
        p.shader = null

        val push = 1f + 0.025f * clamp(t / DUR) + (if (t > 4.8f) 0.14f * easeIO((t - 4.8f) / 0.8f) else 0f)
        val shake = if (t < HIT + 0.6f) 2.4f * u * (if (t < HIT) 1f else 1f - (t - HIT) / 0.6f) else 0f
        c.save()
        c.translate(W / 2 + (rnd(f) - 0.5f) * shake, H / 2 + (rnd(f + 99) - 0.5f) * shake)
        c.scale(push, push)
        c.translate(-W / 2, -H / 2)

        if (t < 2.1f) drawLeader(c, W, H, u, t)

        if (s >= 0f) {
            val appear = ease(s / 0.8f)
            // Lichtstrahlen
            c.save()
            c.translate(W / 2, H * 0.5f)
            p.reset(); p.isAntiAlias = true
            p.shader = RadialGradient(0f, 0f, H * 0.95f, col(accent, 0.13f * appear), 0, Shader.TileMode.CLAMP)
            for (k in 0 until 14) {
                val an = (k / 14f) * 2 * PI.toFloat() + s * 0.18f
                val path = android.graphics.Path()
                path.moveTo(0f, 0f)
                path.lineTo(cos(an - 0.035f) * H, sin(an - 0.035f) * H)
                path.lineTo(cos(an + 0.035f) * H, sin(an + 0.035f) * H)
                path.close()
                c.drawPath(path, p)
            }
            p.shader = null
            c.restore()

            // Schockwelle
            val ringA = exp(-s * 2.4f)
            if (ringA > 0.01f) {
                p.reset(); p.isAntiAlias = true
                p.style = Paint.Style.STROKE
                p.color = col(accent, ringA)
                p.strokeWidth = max(2 * u, 22 * u * ringA)
                c.drawCircle(W / 2, H / 2, s * 1500f * u, p)
            }

            // Logo
            val size = 330f * u
            val gap = 16f * u
            val chars = listOf("D", "J", "6", "4")
            p.reset(); p.isAntiAlias = true
            p.typeface = black
            p.textSize = size
            val widths = chars.map { p.measureText(it) }
            val total = widths.sum() + gap * (chars.size - 1)
            val baseY = H * 0.5f + size * 0.34f
            var x = W / 2 - total / 2
            val grad = LinearGradient(
                0f, baseY - size * 0.75f, 0f, baseY,
                intArrayOf(Color.WHITE, scaleC(accent, 1.15f, 25), scaleC(accent, 0.62f)),
                floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP
            )
            val glow = 0.45f + 0.25f * sin(s * 2.2f)
            chars.forEachIndexed { i, ch ->
                val pr = ease((s - (0.1f + 0.11f * i)) / 0.55f)
                if (pr > 0f) {
                    c.save()
                    val cx = x + widths[i] / 2
                    val cy = baseY - size * 0.3f
                    c.translate(cx, cy + (1 - pr) * 70f * u)
                    val sc = 1f + 0.25f * (1 - pr)
                    c.scale(sc, sc)
                    c.translate(-cx, -cy)
                    // Leuchten: breite, schwache Kontur in Akzentfarbe
                    p.shader = null
                    p.style = Paint.Style.STROKE
                    for (k in 1..3) {
                        p.strokeWidth = k * 9f * u
                        p.color = col(accent, glow * pr * 0.16f)
                        c.drawText(ch, x, baseY, p)
                    }
                    p.style = Paint.Style.FILL
                    p.shader = grad
                    p.alpha = (pr * 255).toInt()
                    c.drawText(ch, x, baseY, p)
                    // Lichtreflex nur auf den Buchstaben
                    val sw = (s - 0.9f) / 0.9f
                    if (sw > 0f && sw < 1f) {
                        val sx = -0.25f * W + sw * 1.5f * W
                        p.shader = LinearGradient(
                            sx - 160 * u, baseY - size, sx + 160 * u, baseY,
                            intArrayOf(0, Color.argb(240, 255, 255, 255), 0), floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP
                        )
                        p.alpha = (pr * 255).toInt()
                        c.drawText(ch, x, baseY, p)
                    }
                    p.shader = null
                    c.restore()
                }
                x += widths[i] + gap
            }

            // Leuchtlinie
            val lp = ease((s - 0.9f) / 0.6f)
            if (lp > 0f) {
                val w = total * 1.04f * lp
                val y = baseY + 38f * u
                p.reset(); p.isAntiAlias = true
                p.shader = LinearGradient(
                    W / 2 - w / 2, 0f, W / 2 + w / 2, 0f,
                    intArrayOf(col(accent, 0f), col(accent, 1f), col(accent, 1f), col(accent, 0f)),
                    floatArrayOf(0f, 0.2f, 0.8f, 1f), Shader.TileMode.CLAMP
                )
                c.drawRect(W / 2 - w / 2, y, W / 2 + w / 2, y + 7f * u, p)
                p.shader = LinearGradient(
                    W / 2 - w / 2, 0f, W / 2 + w / 2, 0f,
                    intArrayOf(col(accent, 0f), col(accent, 0.25f), col(accent, 0.25f), col(accent, 0f)),
                    floatArrayOf(0f, 0.2f, 0.8f, 1f), Shader.TileMode.CLAMP
                )
                c.drawRect(W / 2 - w / 2, y - 10f * u, W / 2 + w / 2, y + 17f * u, p)
            }

            // Untertitel
            val tp = ease((s - 1.2f) / 0.7f)
            if (tp > 0f) {
                p.reset(); p.isAntiAlias = true
                p.typeface = bold
                p.textSize = 40f * u
                p.textAlign = Paint.Align.CENTER
                p.letterSpacing = (30f - 16f * tp) * u / (40f * u)
                p.color = Color.argb((tp * 0.9f * 255).toInt(), 255, 255, 255)
                c.drawText("IPTV  ·  LIVE  ·  FILME  ·  SERIEN", W / 2, baseY + 128f * u, p)
            }

            // Funken
            p.reset(); p.isAntiAlias = true
            for (j in 0 until 80) {
                val speed = (12f + 34f * rnd(j + 900f)) * u
                val x0 = rnd(j.toFloat()) * W
                val y0 = rnd(j + 500f) * H
                val y = (((y0 - speed * s) % H) + H) % H
                val drift = sin(s * (0.4f + rnd(j + 1100f)) + j) * 24f * u
                val tw = 0.5f + 0.5f * sin(t * (1f + 3f * rnd(j + 1700f)) + j)
                val a = 0.6f * tw * appear
                val r = (1f + 2.6f * rnd(j + 1300f)) * u
                p.color = if (j % 3 == 0) col(accent, a) else Color.argb((a * 0.8f * 255).toInt(), 255, 255, 255)
                c.drawCircle(x0 + drift, y, r, p)
            }

            // Streak
            val stA = exp(-s * 2f)
            if (stA > 0.01f) {
                p.reset(); p.isAntiAlias = true
                p.shader = LinearGradient(
                    0f, 0f, W, 0f,
                    intArrayOf(col(accent, 0f), Color.argb((0.95f * stA * 255).toInt(), 255, 255, 255), col(accent, 0f)),
                    floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP
                )
                val hh = 4f * u * (0.4f + stA)
                c.drawRect(0f, H / 2 - hh, W, H / 2 + hh, p)
                p.shader = LinearGradient(
                    0f, 0f, W, 0f,
                    intArrayOf(col(accent, 0f), col(accent, stA * 0.4f), col(accent, 0f)),
                    floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP
                )
                c.drawRect(0f, H / 2 - 22f * u, W, H / 2 + 22f * u, p)
            }
        }
        c.restore()

        // Blitz
        if (s >= 0f) {
            val fl = exp(-s * 9f) * 0.92f
            if (fl > 0.005f) c.drawColor(Color.argb((fl * 255).toInt(), 255, 255, 255))
        }
        // Flackern
        if (t < HIT) {
            val fk = 0.05f * (rnd(f + 7) - 0.5f)
            if (fk > 0) c.drawColor(Color.argb((fk * 255).toInt(), 255, 255, 255))
            else c.drawColor(Color.argb((-fk * 2 * 255).toInt(), 0, 0, 0))
        }
        // Filmkorn
        p.reset()
        val n = (260 * (if (t < HIT) 1f else 0.5f)).toInt()
        for (i in 0 until n) {
            val gx = rnd(f * 7919f + i * 3f) * W
            val gy = rnd(f * 104729f + i * 5f + 1f) * H
            p.color = Color.argb(((0.04f + 0.1f * rnd(f * 13f + i)) * 255).toInt(), 255, 255, 255)
            c.drawRect(gx, gy, gx + 2f * u + 1f, gy + 2f * u + 1f, p)
        }
        if (rnd(f + 8) > 0.55f) {
            p.color = Color.argb(((0.1f + 0.1f * rnd(f + 11)) * 255).toInt(), 255, 255, 255)
            val lx = rnd(f + 3) * W
            c.drawRect(lx, 0f, lx + 1.5f * u + 0.5f, H, p)
        }
        // Vignette
        p.reset(); p.isAntiAlias = true
        p.shader = RadialGradient(W / 2, H / 2, H * 1.05f, intArrayOf(0, 0, Color.argb(166, 0, 0, 0)), floatArrayOf(0f, 0.33f, 1f), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, W, H, p)
        p.shader = null

        // Letterbox
        val bar = max(0f, (H - W / 2.39f) / 2)
        val bp = ease(t / 0.9f)
        val barH = bar * bp
        if (barH > 0f) {
            p.reset()
            p.color = Color.BLACK
            c.drawRect(0f, 0f, W, barH, p)
            c.drawRect(0f, H - barH, W, H, p)
        }
        if (t < 0.15f) c.drawColor(Color.argb(((1 - t / 0.15f) * 255).toInt(), 0, 0, 0))
    }

    private fun drawLeader(c: Canvas, W: Float, H: Float, u: Float, t: Float) {
        val a = clamp((t - 0.15f) / 0.2f) * (if (t > 1.85f) clamp((2.1f - t) / 0.25f) else 1f)
        if (a <= 0f) return
        val cx = W / 2
        val cy = H / 2
        val R = 300f * u
        fun w(alpha: Float) = Color.argb((clamp(alpha) * 255).toInt(), 255, 255, 255)
        p.reset(); p.isAntiAlias = true
        p.style = Paint.Style.STROKE
        p.color = w(a * 0.78f); p.strokeWidth = 5f * u
        c.drawCircle(cx, cy, R, p)
        p.strokeWidth = 2f * u
        c.drawCircle(cx, cy, R * 0.8f, p)
        p.color = w(a * 0.4f)
        c.drawLine(cx - R * 1.3f, cy, cx + R * 1.3f, cy, p)
        c.drawLine(cx, cy - R * 1.3f, cx, cy + R * 1.3f, p)
        p.color = w(a * 0.55f)
        for (i in 0 until 60) {
            val an = (i / 60f) * 2 * PI.toFloat()
            val l = if (i % 5 == 0) 26f * u else 12f * u
            c.drawLine(cx + cos(an) * R, cy + sin(an) * R, cx + cos(an) * (R + l), cy + sin(an) * (R + l), p)
        }
        // Radar-Zeiger
        val ang = (((t - 0.3f) % 1f + 1f) % 1f) * 2 * PI.toFloat() - PI.toFloat() / 2
        p.style = Paint.Style.FILL
        val deg = Math.toDegrees(ang.toDouble()).toFloat()
        c.save()
        c.rotate(deg - 108f, cx, cy)
        p.shader = SweepGradient(cx, cy, intArrayOf(0, Color.argb((0.2f * a * 255).toInt(), 255, 255, 255), 0, 0), floatArrayOf(0f, 0.1f, 0.1001f, 1f))
        c.drawCircle(cx, cy, R * 0.8f, p)
        p.shader = null
        c.restore()
        p.style = Paint.Style.STROKE
        p.color = w(a * 0.9f); p.strokeWidth = 3f * u
        c.drawLine(cx, cy, cx + cos(ang) * R * 0.8f, cy + sin(ang) * R * 0.8f, p)
        // Zahl
        if (t in 0.3f..1.8f) {
            val idx = floor((t - 0.3f) / 0.5f).toInt()
            val local = ((t - 0.3f) % 0.5f) / 0.5f
            val sc = 1f + 0.14f * (1 - ease(local * 2))
            p.reset(); p.isAntiAlias = true
            p.typeface = black
            p.textSize = 340f * u
            p.textAlign = Paint.Align.CENTER
            p.color = w(a * 0.92f)
            c.save()
            c.translate(cx, cy + 6f * u)
            c.scale(sc, sc)
            val fm = p.fontMetrics
            c.drawText((3 - idx).coerceIn(1, 3).toString(), 0f, -(fm.ascent + fm.descent) / 2, p)
            c.restore()
        }
    }
}
