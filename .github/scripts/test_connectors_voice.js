#!/usr/bin/env node
'use strict';
/**
 * Deterministic checks for connector brief helpers + Gmail MIME encoding +
 * voice connector command patterns. Extracts real production functions from
 * ai/index.html (same style as test_voice_mode.js / test_subagent_allowlist.js).
 */
const fs = require('fs');
const source = fs.readFileSync('ai/index.html', 'utf8');

function extractFunction(name) {
  const marker = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = marker.exec(source);
  if (!match) throw new Error('Function not found: ' + name);
  const start = match.index;
  const open = source.indexOf('{', start);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Unterminated function: ' + name);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const S = { settings: { homeLocation: 'Surrey, BC' } };
const LIVE = { scores: [] };
const WMO_CODES = { 0: 'Clear' };
function stockPrice(entry) {
  try {
    if (!entry || !entry.chart || !entry.chart.result || !entry.chart.result[0]) return null;
    const m = entry.chart.result[0].meta || {};
    return {
      symbol: m.symbol || '',
      price: m.regularMarketPrice != null ? m.regularMarketPrice : m.previousClose,
      prev: m.chartPreviousClose != null ? m.chartPreviousClose : m.previousClose
    };
  } catch (e) { return null; }
}

const flattenNews = eval('(' + extractFunction('flattenNews') + ')');
const flattenTrafficIncidents = eval('(' + extractFunction('flattenTrafficIncidents') + ')');
const formatWeatherBrief = eval('(' + extractFunction('formatWeatherBrief') + ')');
const formatScoresBrief = eval('(' + extractFunction('formatScoresBrief') + ')');
const formatStocksBrief = eval('(' + extractFunction('formatStocksBrief') + ')');
const formatDashboardBrief = eval('(' + extractFunction('formatDashboardBrief') + ')');
const gmailEncodeRaw = eval('(' + extractFunction('gmailEncodeRaw') + ')');
const gmailHeader = eval('(' + extractFunction('gmailHeader') + ')');

const cache = {
  updated: '2026-07-20T00:00:00Z',
  weather: { current: { temperature_2m: 24.1, apparent_temperature: 22.8, weather_code: 0, relative_humidity_2m: 44, wind_speed_10m: 11.7 } },
  news: {
    'https://globalnews.ca/bc/feed/': {
      status: 'ok',
      items: [{ title: 'Test headline one', link: 'https://example.com/1', source: 'Global BC' }]
    }
  },
  cameras: [{
    id: 275, name: 'Port Mann Bridge E',
    events: [{ type: 'Construction', severity: 'MAJOR', road: 'Highway 1', desc: 'Lane closure', km: 1.9 }]
  }],
  scores: [],
  sports: {},
  stocks: {},
  pharmacy: {}
};

assert(flattenNews(cache.news, 5).length === 1, 'flattenNews should read feed dict items');
assert(flattenNews(cache.news, 5)[0].title === 'Test headline one', 'flattenNews title');
assert(flattenTrafficIncidents(cache.cameras, 3).length === 1, 'flattenTrafficIncidents should surface cam events');
assert(/MAJOR/.test(flattenTrafficIncidents(cache.cameras, 3)[0].sev), 'severity preserved');

const wx = formatWeatherBrief(cache);
assert(/24\.1/.test(wx) && /Surrey/.test(wx), 'formatWeatherBrief uses open-meteo current + home location');

const brief = formatDashboardBrief(cache);
assert(/Headlines:/.test(brief), 'brief includes headlines');
assert(/Test headline one/.test(brief), 'brief includes news title');
assert(/Traffic:/.test(brief) && /Highway 1/.test(brief), 'brief includes traffic');
assert(/24\.1/.test(brief), 'brief includes weather temp');

const raw = gmailEncodeRaw({ to: 'a@example.com', subject: 'Hello', body: 'Line one\nLine two', from: 'me@example.com' });
assert(/^[A-Za-z0-9_-]+$/.test(raw), 'gmailEncodeRaw must be base64url');
const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
assert(/To: a@example\.com/.test(decoded), 'encoded MIME contains To');
assert(/Subject: Hello/.test(decoded), 'encoded MIME contains Subject');
assert(/Line one/.test(decoded), 'encoded MIME contains body');

assert(gmailHeader([{ name: 'From', value: 'Ada <ada@x.com>' }, { name: 'Subject', value: 'Hi' }], 'subject') === 'Hi',
  'gmailHeader is case-insensitive');

assert(source.indexOf("id: 'v-quick'") >= 0 || source.indexOf('id="v-quick"') >= 0, 'voice quick chip bar markup present');
assert(/data-v-act="brief"/.test(source), 'Brief chip present');
assert(/data-v-act="inbox"/.test(source), 'Inbox chip present');
assert(/gmail\.readonly/.test(source) && /gmail\.send/.test(source), 'Gmail OAuth scopes present');
assert(/nova_gmail_auth_v1/.test(source), 'Gmail auth localStorage key present');
assert(/function voiceRunConnector/.test(source), 'voiceRunConnector present');
assert(/action === 'send'/.test(source) && /confirm\(preview\)/.test(source), 'gmail send confirm guard present');
assert(/SUBAGENT_BLOCKED_TOOLS = \[[^\]]*use_connector/.test(source), 'use_connector remains sub-agent blocked');

console.log('OK connector/voice harness (' + [
  'flattenNews', 'flattenTrafficIncidents', 'formatWeatherBrief', 'formatDashboardBrief',
  'gmailEncodeRaw', 'gmailHeader', 'markup/scopes'
].join(', ') + ')');
