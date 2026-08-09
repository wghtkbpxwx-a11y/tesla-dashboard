/* Companion sync + chat helpers — classic script, no modules */
(function (global) {
  'use strict';

  var PACKAGE_VERSION = 1;
  var ROSTER_FILE = 'companion-memory-sync.json';

  function nowIso() {
    return new Date().toISOString();
  }

  function emptyPackage() {
    return {
      version: PACKAGE_VERSION,
      updated: nowIso(),
      pinHash: '',
      settings: {
        provider: 'openrouter',
        apiKey: '',
        apiBase: '',
        model: 'openrouter/auto',
        voice: false,
        gistId: '',
        gistToken: ''
      },
      companions: [],
      chats: {},
      feed: [],
      scenes: {}
    };
  }

  function seedCompanions() {
    return [
      { id: 'alex', name: 'Alex', vibe: 'Warm, curious, steady', avatar: '🌿', traits: ['listener', 'planner'] },
      { id: 'morgan', name: 'Morgan', vibe: 'Playful, witty, loyal', avatar: '✨', traits: ['humor', 'adventure'] },
      { id: 'jordan', name: 'Jordan', vibe: 'Calm, thoughtful, direct', avatar: '🌙', traits: ['honest', 'supportive'] }
    ];
  }

  function encodeRoster(list) {
    return JSON.stringify(Array.isArray(list) ? list : []);
  }

  function decodeRoster(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function mergePackages(base, incoming) {
    var out = emptyPackage();
    var a = base && typeof base === 'object' ? base : emptyPackage();
    var b = incoming && typeof incoming === 'object' ? incoming : emptyPackage();
    out.version = Math.max(a.version || 1, b.version || 1, PACKAGE_VERSION);
    out.updated = b.updated || a.updated || nowIso();
    out.pinHash = b.pinHash || a.pinHash || '';
    out.settings = Object.assign({}, a.settings || {}, b.settings || {});
    out.companions = b.companions && b.companions.length ? b.companions.slice() : (a.companions || seedCompanions()).slice();
    out.chats = Object.assign({}, a.chats || {}, b.chats || {});
    out.feed = (b.feed && b.feed.length ? b.feed : a.feed || []).slice(0, 200);
    out.scenes = Object.assign({}, a.scenes || {}, b.scenes || {});
    return out;
  }

  function gistHeaders(token) {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  function pullVault(gistId, token) {
    if (!gistId || !token) return Promise.reject(new Error('Gist ID and token required'));
    return fetch('https://api.github.com/gists/' + encodeURIComponent(gistId), {
      method: 'GET',
      headers: gistHeaders(token)
    }).then(function (res) {
      if (!res.ok) throw new Error('Gist pull failed (' + res.status + ')');
      return res.json();
    }).then(function (gist) {
      var files = gist.files || {};
      var file = files[ROSTER_FILE] || files[Object.keys(files)[0]];
      if (!file || !file.content) return emptyPackage();
      try {
        return mergePackages(emptyPackage(), JSON.parse(file.content));
      } catch (e) {
        throw new Error('Vault JSON invalid');
      }
    });
  }

  function pushVault(gistId, token, pkg) {
    if (!gistId || !token) return Promise.reject(new Error('Gist ID and token required'));
    var body = JSON.stringify(pkg || emptyPackage(), null, 2);
    return fetch('https://api.github.com/gists/' + encodeURIComponent(gistId), {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json' }, gistHeaders(token)),
      body: JSON.stringify({
        files: (function () {
          var o = {};
          o[ROSTER_FILE] = { content: body };
          return o;
        })()
      })
    }).then(function (res) {
      if (!res.ok) throw new Error('Gist push failed (' + res.status + ')');
      return pkg;
    });
  }

  function providerUrl(settings) {
    var p = (settings && settings.provider) || 'openrouter';
    if (p === 'openai') return 'https://api.openai.com/v1/chat/completions';
    if (p === 'xai') return 'https://api.x.ai/v1/chat/completions';
    if (p === 'custom' && settings.apiBase) {
      var base = String(settings.apiBase).replace(/\/+$/, '');
      return base.indexOf('/chat/completions') >= 0 ? base : base + '/chat/completions';
    }
    return 'https://openrouter.ai/api/v1/chat/completions';
  }

  function chatCompletion(settings, messages) {
    if (!settings || !settings.apiKey) return Promise.reject(new Error('API key required'));
    var headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey
    };
    if ((settings.provider || 'openrouter') === 'openrouter') {
      headers['HTTP-Referer'] = location.href;
      headers['X-Title'] = 'Tesla Companion';
    }
    var model = settings.model || 'openrouter/auto';
    if (settings.provider === 'openrouter' && !model) model = 'openrouter/auto';
    if (settings.provider === 'openai' && !model) model = 'gpt-4o-mini';
    if (settings.provider === 'xai' && !model) model = 'grok-2-latest';
    return fetch(providerUrl(settings), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ model: model, messages: messages || [] })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var msg = (data && data.error && (data.error.message || data.error)) || ('Chat failed (' + res.status + ')');
          throw new Error(String(msg));
        }
        var choice = data.choices && data.choices[0];
        return (choice && choice.message && choice.message.content) || '';
      });
    });
  }

  function transcribeAudio(settings, blob) {
    if (!settings || !settings.apiKey) return Promise.reject(new Error('API key required'));
    var base = settings.provider === 'custom' && settings.apiBase
      ? String(settings.apiBase).replace(/\/+$/, '').replace(/\/v1\/chat\/completions$/, '')
      : 'https://api.openai.com';
    if (base.indexOf('/v1') < 0) base += '/v1';
    var fd = new FormData();
    fd.append('file', blob, 'voice.webm');
    fd.append('model', 'whisper-1');
    return fetch(base + '/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + settings.apiKey },
      body: fd
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && data.error && data.error.message) || 'Transcription failed');
        return data.text || '';
      });
    });
  }

  global.CompanionSync = {
    PACKAGE_VERSION: PACKAGE_VERSION,
    ROSTER_FILE: ROSTER_FILE,
    emptyPackage: emptyPackage,
    seedCompanions: seedCompanions,
    encodeRoster: encodeRoster,
    decodeRoster: decodeRoster,
    mergePackages: mergePackages,
    pullVault: pullVault,
    pushVault: pushVault,
    chatCompletion: chatCompletion,
    transcribeAudio: transcribeAudio,
    providerUrl: providerUrl
  };
})(window);
