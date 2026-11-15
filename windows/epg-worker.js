'use strict';
const { parentPort } = require('worker_threads');
const zlib = require('zlib');
const { parseEpgBuffer } = require('./epg.js');

parentPort.once('message', ({ raw, now, opts }) => {
  try {
    let buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    parentPort.postMessage({ ok: true, res: parseEpgBuffer(buf, now, opts) });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String((e && e.message) || e) });
  }
});
