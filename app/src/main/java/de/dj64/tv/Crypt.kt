package de.dj64.tv

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Verschlüsselt Zugangsdaten mit einem Schlüssel im Android-Keystore (ab Android 6). */
object Crypt {
    private const val ALIAS = "dj64_creds"
    private const val PREFIX = "enc:"

    private fun key(): SecretKey? {
        if (Build.VERSION.SDK_INT < 23) return null
        return try {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (ks.getKey(ALIAS, null) as? SecretKey) ?: run {
                val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                g.init(
                    KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build()
                )
                g.generateKey()
            }
        } catch (e: Throwable) {
            null
        }
    }

    fun enc(plain: String): String {
        if (plain.isEmpty() || plain.startsWith(PREFIX)) return plain
        val k = key() ?: return plain
        return try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, k)
            val out = c.iv + c.doFinal(plain.toByteArray(Charsets.UTF_8))
            PREFIX + Base64.encodeToString(out, Base64.NO_WRAP)
        } catch (e: Throwable) {
            plain
        }
    }

    fun dec(s: String): String {
        if (!s.startsWith(PREFIX)) return s
        val k = key() ?: return ""
        return try {
            val raw = Base64.decode(s.substring(PREFIX.length), Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, raw, 0, 12))
            String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
        } catch (e: Throwable) {
            ""
        }
    }
}
