'use strict';

// Netzwerkzugriff für den Server (Node 18+). Gleiche Schnittstelle wie in der Android-App:
// getText(url, { timeout, maxBytes }) -> Promise<string>

const USER_AGENT = 'Mozilla/5.0 (compatible; FenerbahceNewsInternal/1.1)';

// Zeichensatz aus Header, XML-Prolog oder <meta> bestimmen (türkische Seiten nutzen teils iso-8859-9).
function decodeBuffer(buf, contentType) {
  let label = ((contentType || '').match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!label) {
    const head = buf.subarray(0, 400).toString('latin1');
    label = (head.match(/encoding=["']([\w-]+)["']/i) || head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  try { return new TextDecoder(label || 'utf-8').decode(buf); } catch (e) { return buf.toString('utf8'); }
}

async function getText(url, opts) {
  opts = opts || {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.6',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    let buf;
    if (opts.maxBytes && res.body) {
      // Nur den Anfang laden (reicht für <head> mit og:image).
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        size += value.length;
        if (size >= opts.maxBytes) { try { await reader.cancel(); } catch (e) { /* egal */ } break; }
      }
      buf = Buffer.concat(chunks);
    } else {
      buf = Buffer.from(await res.arrayBuffer());
    }
    return decodeBuffer(buf, res.headers.get('content-type'));
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('Zeitüberschreitung');
    const cause = err && err.cause && (err.cause.code || err.cause.message);
    throw new Error(cause ? err.message + ' (' + cause + ')' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getText, decodeBuffer };
