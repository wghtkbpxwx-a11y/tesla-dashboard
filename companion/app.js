(function () {
  'use strict';

  var LS_KEY = 'companion_pkg_v1';
  var DEFAULT_PIN = '0000';
  var sync = window.CompanionSync;
  var pkg = loadPkg();
  var pinBuffer = '';
  var activeTab = 'universe';
  var universeMode = 'walk';
  var feedFilter = 'all';
  var activePerson = null;
  var venues = [];
  var sceneState = null;
  var mediaRecorder = null;
  var voiceChunks = [];
  var voiceSupported = false;

  var FALLBACK_VENUES = [
    { id: 'stanley-park', name: 'Stanley Park Seawall', area: 'Vancouver', tags: ['walk', 'date', 'roam'], blurb: 'Seawall loop with mountain views and cedar forest.' },
    { id: 'gastown', name: 'Gastown Steam Clock', area: 'Vancouver', tags: ['walk', 'date', 'roam'], blurb: 'Cobblestone streets, cafés, and evening lights.' },
    { id: 'granville-island', name: 'Granville Island Market', area: 'Vancouver', tags: ['walk', 'date', 'roam'], blurb: 'Public market, waterfront benches, and live buskers.' },
    { id: 'lynn-canyon', name: 'Lynn Canyon Suspension Bridge', area: 'North Vancouver', tags: ['walk', 'roam'], blurb: 'Forest trails and a free suspension bridge.' },
    { id: 'steveston', name: 'Steveston Village Wharf', area: 'Richmond', tags: ['walk', 'date', 'roam'], blurb: 'Fishing village boardwalk and sunset views.' },
    { id: 'queen-elizabeth', name: 'Queen Elizabeth Park', area: 'Vancouver', tags: ['walk', 'date'], blurb: 'City lookout, gardens, and quiet picnic lawns.' }
  ];

  function loadPkg() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        return sync.mergePackages(sync.emptyPackage(), parsed);
      }
    } catch (e) {}
    var fresh = sync.emptyPackage();
    fresh.companions = sync.seedCompanions();
    fresh.pinHash = hashPin(DEFAULT_PIN);
    return fresh;
  }

  function savePkg() {
    pkg.updated = new Date().toISOString();
    try { localStorage.setItem(LS_KEY, JSON.stringify(pkg)); } catch (e) { toast('Storage full'); }
  }

  function hashPin(pin) {
    var s = String(pin || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return 'p' + Math.abs(h);
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function slugId(name) {
    var base = String(name || 'companion').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'companion';
    var id = base;
    var n = 2;
    while (personById(id)) { id = base + '-' + n; n++; }
    return id;
  }

  function personById(id) {
    for (var i = 0; i < pkg.companions.length; i++) {
      if (pkg.companions[i].id === id) return pkg.companions[i];
    }
    return null;
  }

  function addFeed(text, kind, meta) {
    var item = { t: Date.now(), text: text, kind: kind || 'note' };
    if (meta) {
      if (meta.companionId) item.companionId = meta.companionId;
      if (meta.venueId) item.venueId = meta.venueId;
    }
    pkg.feed.unshift(item);
    if (pkg.feed.length > 100) pkg.feed.length = 100;
    savePkg();
    renderFeed();
  }

  function feedKindLabel(kind) {
    if (kind === 'chat') return '💬 Chat';
    if (kind === 'scene') return '📍 Scene';
    return '📝 Note';
  }

  function refreshAll() {
    fillSettingsUi();
    renderPeople();
    renderFeed();
    renderChatLog();
    renderVenues();
  }

  /* ── PIN gate ── */
  function renderPinDisplay() {
    var el = document.getElementById('pin-display');
    if (!el) return;
    var n = pinBuffer.length;
    var out = '';
    for (var i = 0; i < 4; i++) out += i < n ? '●' : '○';
    el.textContent = out;
  }

  function unlock() {
    document.getElementById('pin-gate').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    initApp();
    maybeAutoSync();
  }

  function maybeAutoSync() {
    var s = pkg.settings || {};
    if (!s.autoSync || !s.gistId || !s.gistToken) return;
    sync.pullVault(s.gistId, s.gistToken).then(function (remote) {
      pkg = sync.mergePackages(pkg, remote);
      savePkg();
      refreshAll();
      toast('Vault synced');
    }).catch(function () {});
  }

  function bindPinPad() {
    document.getElementById('pin-grid').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var digit = btn.getAttribute('data-digit');
      var action = btn.getAttribute('data-action');
      if (digit != null) {
        if (pinBuffer.length < 4) pinBuffer += digit;
      } else if (action === 'back') {
        pinBuffer = pinBuffer.slice(0, -1);
      } else if (action === 'clear') {
        pinBuffer = '';
      }
      renderPinDisplay();
      document.getElementById('pin-error').textContent = '';
    });
    document.getElementById('pin-submit').addEventListener('click', tryUnlock);
  }

  function tryUnlock() {
    if (pinBuffer.length !== 4) {
      document.getElementById('pin-error').textContent = 'Enter 4 digits';
      return;
    }
    if (hashPin(pinBuffer) === (pkg.pinHash || hashPin(DEFAULT_PIN))) {
      pinBuffer = '';
      unlock();
    } else {
      document.getElementById('pin-error').textContent = 'Wrong PIN';
      pinBuffer = '';
      renderPinDisplay();
    }
  }

  /* ── Tabs ── */
  function goTab(name) {
    activeTab = name;
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.toggle('on', p.id === 'tab-' + name);
    });
    document.querySelectorAll('#tabbar button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === name);
    });
    var titles = { universe: 'Universe', feed: 'Feed', chats: 'Chats', people: 'People', settings: 'Settings' };
    document.getElementById('view-title').textContent = titles[name] || 'Companion';
  }

  function bindTabs() {
    document.getElementById('tabbar').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (btn) goTab(btn.getAttribute('data-tab'));
    });
  }

  /* ── Universe ── */
  function loadVenues() {
    return fetch('data/venues.json').then(function (r) { return r.json(); }).then(function (data) {
      venues = Array.isArray(data) ? data : FALLBACK_VENUES.slice();
      renderVenues();
    }).catch(function () {
      venues = FALLBACK_VENUES.slice();
      renderVenues();
    });
  }

  function filteredVenues() {
    return venues.filter(function (v) {
      return !v.tags || v.tags.indexOf(universeMode === 'walk' ? 'walk' : universeMode) >= 0;
    });
  }

  function visitCount(venueId) {
    return (pkg.scenes[venueId] && pkg.scenes[venueId].visits) || 0;
  }

  function renderVenues() {
    var list = document.getElementById('venue-list');
    var items = filteredVenues();
    if (!items.length) {
      list.innerHTML = '<p class="card" style="color:var(--muted)">No pins for this mode.</p>';
      return;
    }
    list.innerHTML = items.map(function (v) {
      var visits = visitCount(v.id);
      var badge = visits ? '<span class="visit-badge">' + visits + '×</span>' : '';
      return '<div class="venue-card" data-venue="' + v.id + '">' +
        '<div class="venue-pin">📍</div>' +
        '<div class="venue-meta"><strong>' + esc(v.name) + badge + '</strong><small>' + esc(v.area) + ' · ' + esc(v.blurb || '') + '</small></div>' +
        '<button type="button" class="btn btn-primary btn-sm venue-go">Go</button></div>';
    }).join('');
  }

  function offlineSceneLine(venue, person, lineIdx) {
    var mode = universeMode;
    var pool = {
      walk: [
        person.name + ' matches your pace along ' + venue.name + '. "' + (venue.blurb || 'Nice spot.') + '"',
        'You both pause at ' + venue.name + '. ' + person.name + ' asks what you notice first.',
        person.name + ' points out a detail you would have missed at ' + venue.name + '.'
      ],
      date: [
        person.name + ' lingers with you at ' + venue.name + '. The ' + venue.area + ' air feels unhurried.',
        'At ' + venue.name + ', ' + person.name + ' suggests one small thing to try before you leave.',
        person.name + ' keeps the mood light at ' + venue.name + ' — easy conversation, no rush.'
      ],
      roam: [
        person.name + ' is up for wherever ' + venue.area + ' leads next. ' + venue.name + ' is a good anchor.',
        'You drift through ' + venue.name + ' with no agenda. ' + person.name + ' follows your curiosity.',
        person.name + ' treats ' + venue.name + ' like a discovery, not a checklist.'
      ]
    };
    var lines = pool[mode] || pool.walk;
    return lines[lineIdx % lines.length];
  }

  function startScene(venueId) {
    var venue = null;
    for (var i = 0; i < venues.length; i++) if (venues[i].id === venueId) venue = venues[i];
    if (!venue) return;
    var person = activePerson || pkg.companions[0];
    sceneState = { venue: venue, person: person, idx: 0 };
    document.getElementById('scene-card').style.display = 'block';
    document.getElementById('scene-venue').textContent = venue.name;
    document.getElementById('scene-text').textContent = offlineSceneLine(venue, person, 0);
    addFeed('Visited ' + venue.name + ' with ' + person.name, 'scene', { companionId: person.id, venueId: venue.id });
    if (!pkg.scenes[venue.id]) pkg.scenes[venue.id] = { visits: 0, companionId: person.id, lastAt: Date.now() };
    pkg.scenes[venue.id].visits = (pkg.scenes[venue.id].visits || 0) + 1;
    pkg.scenes[venue.id].companionId = person.id;
    pkg.scenes[venue.id].lastAt = Date.now();
    savePkg();
    renderVenues();
  }

  function bindUniverse() {
    document.getElementById('mode-chips').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip[data-mode]');
      if (!chip) return;
      universeMode = chip.getAttribute('data-mode');
      document.querySelectorAll('#mode-chips .chip').forEach(function (c) {
        c.classList.toggle('on', c === chip);
      });
      renderVenues();
    });
    document.getElementById('venue-list').addEventListener('click', function (e) {
      var card = e.target.closest('[data-venue]');
      if (!card) return;
      startScene(card.getAttribute('data-venue'));
    });
    document.getElementById('scene-next').addEventListener('click', function () {
      if (!sceneState) return;
      sceneState.idx++;
      document.getElementById('scene-text').textContent = offlineSceneLine(sceneState.venue, sceneState.person, sceneState.idx);
    });
    document.getElementById('scene-speak').addEventListener('click', function () {
      speak(document.getElementById('scene-text').textContent);
    });
  }

  /* ── Feed ── */
  function filteredFeed() {
    if (feedFilter === 'all') return pkg.feed;
    return pkg.feed.filter(function (item) { return item.kind === feedFilter; });
  }

  function renderFeed() {
    var el = document.getElementById('feed-list');
    var items = filteredFeed();
    if (!items.length) {
      el.innerHTML = '<p class="card" style="color:var(--muted)">No moments yet — chat or visit a venue.</p>';
      return;
    }
    el.innerHTML = items.map(function (item) {
      var d = new Date(item.t);
      var kind = feedKindLabel(item.kind);
      return '<div class="feed-item" data-feed-kind="' + esc(item.kind || 'note') + '">' +
        '<div class="feed-meta"><span class="feed-kind">' + kind + '</span><time>' + d.toLocaleString() + '</time></div>' +
        '<div>' + esc(item.text) + '</div></div>';
    }).join('');
  }

  function bindFeed() {
    document.getElementById('feed-filter-chips').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip[data-feed]');
      if (!chip) return;
      feedFilter = chip.getAttribute('data-feed');
      document.querySelectorAll('#feed-filter-chips .chip').forEach(function (c) {
        c.classList.toggle('on', c === chip);
      });
      renderFeed();
    });
  }

  /* ── People ── */
  function renderPeople() {
    var el = document.getElementById('people-list');
    el.innerHTML = pkg.companions.map(function (p) {
      var on = activePerson && activePerson.id === p.id ? ' on' : '';
      var stats = sync.companionStats(pkg, p.id);
      return '<div class="person-card' + on + '" data-person="' + p.id + '">' +
        '<div class="person-avatar">' + esc(p.avatar || '👤') + '</div>' +
        '<div class="person-body"><strong>' + esc(p.name) + '</strong>' +
        '<div class="person-vibe">' + esc(p.vibe || '') + '</div>' +
        '<div class="person-stats">' + stats.messages + ' msgs · ' + stats.visits + ' visits</div></div>' +
        '<button type="button" class="btn btn-ghost btn-sm chat-open" data-chat-open="' + p.id + '">Chat</button></div>';
    }).join('');
    renderChatPersonChips();
  }

  function renderChatPersonChips() {
    var el = document.getElementById('chat-person-chips');
    if (!el) return;
    el.innerHTML = pkg.companions.map(function (p) {
      var on = activePerson && activePerson.id === p.id ? ' on' : '';
      return '<button type="button" class="chip' + on + '" data-person="' + p.id + '">' + esc(p.name) + '</button>';
    }).join('');
  }

  function selectPerson(id) {
    activePerson = personById(id);
    renderPeople();
    renderChatLog();
  }

  function bindPeople() {
    document.getElementById('people-list').addEventListener('click', function (e) {
      var chatBtn = e.target.closest('[data-chat-open]');
      if (chatBtn) {
        selectPerson(chatBtn.getAttribute('data-chat-open'));
        goTab('chats');
        return;
      }
      var card = e.target.closest('[data-person]');
      if (!card) return;
      selectPerson(card.getAttribute('data-person'));
    });
    document.getElementById('chat-person-chips').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-person]');
      if (!chip) return;
      selectPerson(chip.getAttribute('data-person'));
    });
    document.getElementById('add-companion-btn').addEventListener('click', addCompanionFromForm);
  }

  function addCompanionFromForm() {
    var name = document.getElementById('add-name').value.trim();
    if (!name) { toast('Name required'); return; }
    var vibe = document.getElementById('add-vibe').value.trim() || 'Warm companion';
    var avatar = document.getElementById('add-avatar').value.trim() || '👤';
    var traitsRaw = document.getElementById('add-traits').value.trim();
    var traits = traitsRaw ? traitsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : ['supportive'];
    var person = { id: slugId(name), name: name, vibe: vibe, avatar: avatar.slice(0, 4), traits: traits };
    pkg.companions.push(person);
    activePerson = person;
    savePkg();
    document.getElementById('add-name').value = '';
    document.getElementById('add-vibe').value = '';
    document.getElementById('add-avatar').value = '';
    document.getElementById('add-traits').value = '';
    renderPeople();
    renderChatLog();
    toast('Added ' + name);
  }

  /* ── Chat ── */
  function chatKey() {
    return activePerson ? activePerson.id : (pkg.companions[0] && pkg.companions[0].id) || 'default';
  }

  function getChatLog() {
    var k = chatKey();
    if (!pkg.chats[k]) pkg.chats[k] = [];
    return pkg.chats[k];
  }

  function renderChatLog() {
    var log = getChatLog();
    var el = document.getElementById('chat-log');
    var person = activePerson || pkg.companions[0];
    document.getElementById('chat-active-name').textContent = person ? ('With ' + person.name) : 'Pick a companion';
    if (!log.length) {
      el.innerHTML = '<div class="bubble bot">Pick a companion and say hello.</div>';
      return;
    }
    el.innerHTML = log.map(function (m) {
      return '<div class="bubble ' + (m.role === 'user' ? 'user' : 'bot') + '">' + esc(m.content) + '</div>';
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  function pushChat(role, content) {
    getChatLog().push({ role: role, content: content, t: Date.now() });
    if (getChatLog().length > 80) getChatLog().splice(0, getChatLog().length - 80);
    savePkg();
    renderChatLog();
    renderPeople();
  }

  function sendChat() {
    var input = document.getElementById('chat-input');
    var text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    var person = activePerson || pkg.companions[0];
    if (!person) { toast('Add a companion first'); return; }
    pushChat('user', text);
    var s = pkg.settings || {};
    if (!s.apiKey) {
      var offline = person.name + ': "' + offlineSceneLine({ name: 'the road', area: 'BC', blurb: 'keeping you company' }, person, getChatLog().length) + '"';
      pushChat('assistant', offline);
      addFeed('Offline chat with ' + person.name, 'chat', { companionId: person.id });
      return;
    }
    var messages = [{ role: 'system', content: sync.buildSystemPrompt(person, pkg, venues) }];
    getChatLog().forEach(function (m) {
      messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
    });
    pushChat('assistant', '…');
    var log = getChatLog();
    sync.chatCompletion(s, messages).then(function (reply) {
      log[log.length - 1].content = reply || '(empty reply)';
      savePkg();
      renderChatLog();
      addFeed('Chat with ' + person.name, 'chat', { companionId: person.id });
      if (s.voice) speak(reply);
    }).catch(function (err) {
      log[log.length - 1].content = 'API error: ' + (err.message || 'failed');
      savePkg();
      renderChatLog();
    });
  }

  function clearChat() {
    var person = activePerson || pkg.companions[0];
    if (!person) return;
    if (!confirm('Clear chat with ' + person.name + '?')) return;
    pkg.chats[chatKey()] = [];
    savePkg();
    renderChatLog();
    toast('Chat cleared');
  }

  function offlineChatScene() {
    var person = activePerson || pkg.companions[0];
    if (!person) return;
    var line = offlineSceneLine({ name: 'the drive', area: 'Metro Vancouver', blurb: 'windows down' }, person, Date.now() % 4);
    pushChat('assistant', line);
    addFeed('Offline scene with ' + person.name, 'scene', { companionId: person.id });
  }

  function bindChat() {
    document.getElementById('chat-send').addEventListener('click', sendChat);
    document.getElementById('chat-offline').addEventListener('click', offlineChatScene);
    document.getElementById('chat-clear').addEventListener('click', clearChat);
    document.getElementById('chat-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
  }

  /* ── Voice ── */
  function detectVoice() {
    var hint = document.getElementById('voice-lock-hint');
    var chatHint = document.getElementById('voice-hint');
    var btn = document.getElementById('voice-btn');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      voiceSupported = false;
      if (hint) {
        hint.classList.remove('hidden', 'ok');
        hint.textContent = 'Voice locked — cabin mic needs Tesla 2026.26+ AMD with browser microphone support. Text chat still works.';
      }
      if (chatHint && pkg.settings && pkg.settings.voice) {
        chatHint.classList.remove('hidden');
        chatHint.textContent = hint ? hint.textContent : '';
      }
      if (btn) btn.style.display = 'none';
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      voiceSupported = true;
      if (hint) {
        hint.classList.remove('hidden');
        hint.classList.add('ok');
        hint.textContent = 'Microphone available — hold the talk button in Chats when voice is enabled.';
      }
      updateVoiceUi();
    }).catch(function () {
      voiceSupported = false;
      if (hint) {
        hint.classList.remove('hidden', 'ok');
        hint.textContent = 'Microphone blocked — enable in browser settings or use Tesla 2026.26+ AMD cabin mic.';
      }
      updateVoiceUi();
    });
  }

  function updateVoiceUi() {
    var btn = document.getElementById('voice-btn');
    var on = pkg.settings && pkg.settings.voice && voiceSupported;
    if (btn) btn.style.display = on ? 'inline-flex' : 'none';
    var chatHint = document.getElementById('voice-hint');
    if (chatHint) {
      if (pkg.settings && pkg.settings.voice && !voiceSupported) {
        chatHint.classList.remove('hidden');
        chatHint.textContent = 'Voice enabled but mic unavailable.';
      } else {
        chatHint.classList.add('hidden');
      }
    }
  }

  function bindVoiceButton() {
    var btn = document.getElementById('voice-btn');
    if (!btn) return;
    function startRec() {
      if (!voiceSupported || !pkg.settings.voice) return;
      voiceChunks = [];
      navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function (stream) {
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = function (e) { if (e.data.size) voiceChunks.push(e.data); };
        mediaRecorder.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          var blob = new Blob(voiceChunks, { type: 'audio/webm' });
          sync.transcribeAudio(pkg.settings, blob).then(function (text) {
            document.getElementById('chat-input').value = text;
            sendChat();
          }).catch(function (err) { toast(err.message || 'Transcription failed'); });
        };
        mediaRecorder.start();
        btn.textContent = '⏺ Recording…';
      }).catch(function () { toast('Mic unavailable'); });
    }
    function stopRec() {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        btn.textContent = '🎙 Hold to talk';
      }
    }
    btn.addEventListener('mousedown', startRec);
    btn.addEventListener('mouseup', stopRec);
    btn.addEventListener('mouseleave', stopRec);
    btn.addEventListener('touchstart', function (e) { e.preventDefault(); startRec(); });
    btn.addEventListener('touchend', function (e) { e.preventDefault(); stopRec(); });
  }

  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    var u = new SpeechSynthesisUtterance(String(text).slice(0, 500));
    u.rate = 0.95;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  /* ── Settings ── */
  function readSettingsUi() {
    pkg.settings = pkg.settings || {};
    var prov = document.querySelector('#provider-chips .chip.on');
    pkg.settings.provider = prov ? prov.getAttribute('data-provider') : 'openrouter';
    pkg.settings.apiKey = document.getElementById('set-api-key').value.trim();
    pkg.settings.model = document.getElementById('set-model').value.trim();
    pkg.settings.apiBase = document.getElementById('set-api-base').value.trim();
    pkg.settings.voice = document.getElementById('set-voice').checked;
    pkg.settings.autoSync = document.getElementById('set-auto-sync').checked;
    pkg.settings.gistId = document.getElementById('set-gist-id').value.trim();
    pkg.settings.gistToken = document.getElementById('set-gist-token').value.trim();
    savePkg();
    updateVoiceUi();
  }

  function fillSettingsUi() {
    var s = pkg.settings || {};
    document.querySelectorAll('#provider-chips .chip').forEach(function (c) {
      c.classList.toggle('on', c.getAttribute('data-provider') === (s.provider || 'openrouter'));
    });
    document.getElementById('set-api-key').value = s.apiKey || '';
    document.getElementById('set-model').value = s.model || '';
    document.getElementById('set-api-base').value = s.apiBase || '';
    document.getElementById('set-voice').checked = !!s.voice;
    document.getElementById('set-auto-sync').checked = s.autoSync !== false;
    document.getElementById('set-gist-id').value = s.gistId || '';
    document.getElementById('set-gist-token').value = s.gistToken || '';
    document.getElementById('custom-base-wrap').style.display = (s.provider === 'custom') ? 'block' : 'none';
  }

  function bindSettings() {
    document.getElementById('provider-chips').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip[data-provider]');
      if (!chip) return;
      document.querySelectorAll('#provider-chips .chip').forEach(function (c) { c.classList.remove('on'); });
      chip.classList.add('on');
      document.getElementById('custom-base-wrap').style.display = chip.getAttribute('data-provider') === 'custom' ? 'block' : 'none';
      readSettingsUi();
    });
    ['set-api-key', 'set-model', 'set-api-base', 'set-gist-id', 'set-gist-token'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', readSettingsUi);
      document.getElementById(id).addEventListener('blur', readSettingsUi);
    });
    document.getElementById('set-voice').addEventListener('change', readSettingsUi);
    document.getElementById('set-auto-sync').addEventListener('change', readSettingsUi);

    document.getElementById('set-save-pin').addEventListener('click', function () {
      var pin = document.getElementById('set-new-pin').value.trim();
      if (!/^\d{4}$/.test(pin)) { toast('PIN must be 4 digits'); return; }
      pkg.pinHash = hashPin(pin);
      document.getElementById('set-new-pin').value = '';
      savePkg();
      toast('PIN updated');
    });

    document.getElementById('vault-pull').addEventListener('click', function () {
      readSettingsUi();
      var s = pkg.settings;
      sync.pullVault(s.gistId, s.gistToken).then(function (remote) {
        pkg = sync.mergePackages(pkg, remote);
        savePkg();
        refreshAll();
        toast('Vault pulled');
      }).catch(function (err) { toast(err.message || 'Pull failed'); });
    });

    document.getElementById('vault-push').addEventListener('click', function () {
      readSettingsUi();
      var s = pkg.settings;
      sync.pushVault(s.gistId, s.gistToken, pkg).then(function () {
        toast('Vault pushed');
      }).catch(function (err) { toast(err.message || 'Push failed'); });
    });

    document.getElementById('import-btn').addEventListener('click', function () {
      var raw = document.getElementById('import-area').value.trim();
      if (!raw) { toast('Paste JSON first'); return; }
      try {
        var incoming = JSON.parse(raw);
        pkg = sync.mergePackages(pkg, incoming);
        savePkg();
        refreshAll();
        document.getElementById('import-area').value = '';
        toast('Imported');
      } catch (e) {
        toast('Invalid JSON');
      }
    });

    document.getElementById('export-btn').addEventListener('click', function () {
      var text = JSON.stringify(pkg, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('Copied to clipboard'); }).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
      function fallbackCopy() {
        document.getElementById('import-area').value = text;
        toast('Export placed in textarea — copy manually');
      }
    });
  }

  function initApp() {
    if (!activePerson && pkg.companions.length) activePerson = pkg.companions[0];
    bindTabs();
    bindUniverse();
    bindFeed();
    bindPeople();
    bindChat();
    bindSettings();
    bindVoiceButton();
    fillSettingsUi();
    renderPeople();
    renderFeed();
    renderChatLog();
    loadVenues();
    detectVoice();
  }

  bindPinPad();
  renderPinDisplay();
})();
