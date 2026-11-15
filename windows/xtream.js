'use strict';
// Xtream-Codes-API: baut aus den JSON-Antworten die Kanalliste (läuft im Hauptprozess, ohne Electron-Abhängigkeit).

const enc = encodeURIComponent;

function apiUrl(base, user, pass, action, extra) {
  return `${base}/player_api.php?username=${enc(user)}&password=${enc(pass)}&action=${action}${extra || ''}`;
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * getJson(url) -> Promise<any>. Liefert { channels, epg } oder wirft einen Fehler.
 * Live ist Pflicht; fehlen Filme oder Serien, wird trotzdem eine Liste geliefert.
 */
async function loadAll(base, user, pass, getJson) {
  const get = (action) => getJson(apiUrl(base, user, pass, action));
  const [liveCats, live, vodCats, vod, serCats, ser] = await Promise.allSettled([
    get('get_live_categories'), get('get_live_streams'),
    get('get_vod_categories'), get('get_vod_streams'),
    get('get_series_categories'), get('get_series')
  ]);
  if (live.status !== 'fulfilled' || !Array.isArray(live.value)) {
    // Ein Login-Fehler liefert meist ein Objekt statt einer Liste.
    throw new Error(live.status === 'rejected' ? live.reason.message : 'Die Xtream-Schnittstelle hat keine Senderliste geliefert');
  }
  const catMap = (r) => {
    const m = new Map();
    if (r.status === 'fulfilled') for (const c of asArray(r.value)) m.set(String(c.category_id), String(c.category_name || ''));
    return m;
  };
  const liveMap = catMap(liveCats);
  const vodMap = catMap(vodCats);
  const serMap = catMap(serCats);
  const u = enc(user);
  const p = enc(pass);
  const channels = [];

  for (const s of live.value) {
    if (!s || s.stream_id == null) continue;
    const ch = {
      name: String(s.name || '').trim() || 'Sender ' + s.stream_id,
      url: `${base}/live/${u}/${p}/${s.stream_id}.ts`,
      group: liveMap.get(String(s.category_id)) || '',
      kind: 'live',
      tvgId: s.epg_channel_id ? String(s.epg_channel_id) : '',
      logo: s.stream_icon ? String(s.stream_icon) : '',
      sid: String(s.stream_id)
    };
    ch.arch = Number(s.tv_archive) === 1 ? (Number(s.tv_archive_duration) || 3) : 0;
    channels.push(ch);
  }
  if (vod.status === 'fulfilled') {
    for (const s of asArray(vod.value)) {
      if (!s || s.stream_id == null) continue;
      channels.push({
        name: String(s.name || '').trim() || 'Film ' + s.stream_id,
        url: `${base}/movie/${u}/${p}/${s.stream_id}.${s.container_extension || 'mp4'}`,
        group: vodMap.get(String(s.category_id)) || '',
        kind: 'movie',
        tvgId: '',
        logo: s.stream_icon ? String(s.stream_icon) : ''
      });
    }
  }
  if (ser.status === 'fulfilled') {
    for (const s of asArray(ser.value)) {
      if (!s || s.series_id == null) continue;
      channels.push({
        name: String(s.name || '').trim() || 'Serie ' + s.series_id,
        url: 'series://' + s.series_id,
        group: serMap.get(String(s.category_id)) || '',
        kind: 'series',
        tvgId: '',
        logo: s.cover ? String(s.cover) : '',
        apiSeries: String(s.series_id)
      });
    }
  }
  if (!channels.length) throw new Error('Die Xtream-Schnittstelle hat keine Einträge geliefert');
  return { channels, epg: '' };
}

/** Folgen einer Serie: Liste von Einträgen mit Staffel und Folge. */
async function seriesInfo(base, user, pass, seriesId, seriesName, getJson) {
  const j = await getJson(apiUrl(base, user, pass, 'get_series_info', '&series_id=' + enc(seriesId)));
  const u = enc(user);
  const p = enc(pass);
  const out = [];
  const eps = j && j.episodes;
  const groups = Array.isArray(eps) ? eps.map((l, i) => [String(i + 1), l]) : Object.entries(eps || {});
  for (const [seasonKey, list] of groups) {
    for (const e of asArray(list)) {
      if (!e || e.id == null) continue;
      const season = Number(e.season) || Number(seasonKey) || 1;
      const ep = Number(e.episode_num) || out.length + 1;
      const title = String(e.title || '').trim();
      out.push({
        name: `S${pad2(season)}E${pad2(ep)} – ${title || 'Folge ' + ep}`,
        url: `${base}/series/${u}/${p}/${e.id}.${e.container_extension || 'mp4'}`,
        kind: 'series',
        tvgId: '',
        logo: (e.info && e.info.movie_image) || '',
        sTitle: seriesName,
        season,
        ep,
        epApi: true
      });
    }
  }
  return out;
}

module.exports = { loadAll, seriesInfo, apiUrl };
