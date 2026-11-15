package de.dj64.tv

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

/** Kompakter Binär-Cache der Senderliste: viel schneller zu laden als der M3U-Text. */
object PlaylistCache {
    private const val MAGIC = 0x444A3634
    private const val VERSION = 2

    fun write(f: File, pl: Playlist) {
        val tmp = File(f.path + ".tmp")
        DataOutputStream(BufferedOutputStream(FileOutputStream(tmp), 65536)).use { o ->
            o.writeInt(MAGIC)
            o.writeInt(VERSION)
            o.writeUTF(pl.epgUrl)
            o.writeInt(pl.channels.size)
            for (c in pl.channels) {
                o.writeUTF(c.name); o.writeUTF(c.url); o.writeUTF(c.group)
                o.writeByte(c.kind.ordinal)
                o.writeUTF(c.tvgId); o.writeUTF(c.logo)
                o.writeUTF(c.streamId); o.writeInt(c.archiveDays)
                o.writeUTF(c.ua); o.writeUTF(c.referer)
                o.writeUTF(c.drmType); o.writeUTF(c.drmKey); o.writeUTF(c.catchupSource)
            }
        }
        if (!tmp.renameTo(f)) {
            f.delete()
            tmp.renameTo(f)
        }
    }

    fun read(f: File): Playlist? = try {
        DataInputStream(BufferedInputStream(FileInputStream(f), 65536)).use { i ->
            if (i.readInt() != MAGIC || i.readInt() != VERSION) return null
            val epg = i.readUTF()
            val n = i.readInt()
            val kinds = Kind.values()
            val groups = HashMap<String, String>()
            val list = ArrayList<Channel>(n)
            repeat(n) {
                val name = i.readUTF(); val url = i.readUTF()
                val g = i.readUTF().let { s -> groups.getOrPut(s) { s } }
                val kind = kinds[i.readByte().toInt()]
                val tvg = i.readUTF(); val logo = i.readUTF()
                val sid = i.readUTF(); val days = i.readInt()
                val ua = i.readUTF(); val ref = i.readUTF()
                val dt = i.readUTF(); val dk = i.readUTF(); val cs = i.readUTF()
                list.add(Channel(name, url, g, kind, tvg, logo, sid, days, ua, ref, dt, dk, cs))
            }
            Playlist(list, epg)
        }
    } catch (e: Throwable) {
        null
    }
}
