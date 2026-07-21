#!/usr/bin/env node
'use strict';

const fs = require('fs');
const source = fs.readFileSync('ai/index.html', 'utf8');
const dashboard = fs.readFileSync('index.html', 'utf8');

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const DEFAULT_SETTINGS = {speech:{
  lang:'en-CA', voiceURI:'', rate:1, engine:'auto', engineVersion:2,
  xaiVoice:'eve', openaiVoice:'nova', elevenVoiceId:'',
  elevenTtsModel:'eleven_flash_v2_5', elevenSttModel:'scribe_v2'
}};
const keys = {xai:'xai-test', elevenlabs:'eleven-test', openai:'openai-test'};
const getKey = (provider) => keys[provider] || '';
const S = {settings:{speech:{engine:'auto', xaiVoice:'eve', elevenVoiceId:'voice-id'}}};

const chooseVoiceTranscript = eval('(' + extractFunction('chooseVoiceTranscript') + ')');
const normalizeSpeechSettings = eval('(' + extractFunction('normalizeSpeechSettings') + ')');
const voiceSTTPlan = eval('(' + extractFunction('voiceSTTPlan') + ')');
const selectVoiceSTTProvider = eval('(' + extractFunction('selectVoiceSTTProvider') + ')');
const voiceTTSPlan = eval('(' + extractFunction('voiceTTSPlan') + ')');
const selectVoiceTTSProvider = eval('(' + extractFunction('selectVoiceTTSProvider') + ')');

function main() {
  assert(chooseVoiceTranscript(' final answer ', 'unfinished') === 'final answer',
    'a finalized transcript must win');
  assert(chooseVoiceTranscript('', '  hi  ') === 'hi',
    'useful Safari interim speech must survive recognition end');
  assert(chooseVoiceTranscript('', 'a') === '',
    'single-character recognition noise must not submit a request');

  const migrated = normalizeSpeechSettings({engine:'browser'});
  assert(migrated.engine === 'auto' && migrated.engineVersion === 2,
    'the legacy browser default must migrate to free-first automatic voice');
  assert(normalizeSpeechSettings({engine:'device', engineVersion:2}).engine === 'device',
    'an explicit device-only choice must remain free-only');

  assert(selectVoiceSTTProvider('auto') === 'xai',
    'automatic cloud transcription must pick the lowest-cost ready provider');
  assert(voiceSTTPlan('auto').join(',') === 'xai,elevenlabs,openai',
    'automatic transcription must retain cost-ordered quota/network backups');
  assert(selectVoiceSTTProvider('openai') === 'openai',
    'an explicit speech provider must be honored');
  assert(selectVoiceSTTProvider('device') === '',
    'device-only listening must never spend cloud credits');
  assert(selectVoiceTTSProvider('auto') === 'xai',
    'automatic cloud speech output must pick the lowest-cost ready provider');
  assert(voiceTTSPlan('auto').join(',') === 'xai,openai,elevenlabs',
    'automatic speech output must retain modality-priced cloud backups');
  delete keys.xai;
  assert(selectVoiceTTSProvider('auto') === 'openai',
    'automatic speech output must fall through to the next ready provider');
  delete keys.openai;
  assert(selectVoiceTTSProvider('auto') === 'elevenlabs',
    'automatic speech output must retain a final configured backup');

  const startVoiceMode = extractFunction('startVoiceMode');
  assert(/Tap once to start voice/.test(startVoiceMode) && !/permissions\.query/.test(startVoiceMode),
    'deep-linked mobile voice must wait for a real media gesture');
  assert(/blockedText/.test(extractFunction('ttsPlaybackBlocked')) &&
    /retryBlockedSpeech/.test(source) && /id="v-audio-retry"/.test(source),
    'a blocked spoken answer must be retained and recoverable without regeneration');
  assert(/__homebaseDiscard/.test(extractFunction('stopVoiceRec')) &&
    /stopVoiceRec\(true\)/.test(extractFunction('initVoice')),
    'backgrounding must discard captured audio instead of submitting it later');
  assert(/getBase\('xai'\) \+ '\/tts'/.test(source) &&
    /sttProvider === 'xai' \? '\/stt'/.test(source),
    'xAI speech output and transcription endpoints must remain wired');

  assert(!/chatgpt\.com/i.test(dashboard),
    'the Tesla dashboard must no longer launch ChatGPT');
  // David's choice (2026-07-21): the corner voice orb READS the daily briefing on
  // the dashboard itself — top-level audio works on iOS, where the old Homebase-voice
  // hand-off (embedded iframe / a separate voice page) silently failed on his iPhone
  // ("enable sound → nothing happens"). The Homebase + Briefing link buttons and the
  // More→Apps Homebase tiles were removed at his request. Guard the briefing wiring,
  // not a Homebase link count.
  assert(/function briefingTap\s*\(/.test(dashboard) && /briefingTap\(\)/.test(dashboard) &&
    /function briefingToggle\s*\(/.test(dashboard),
    'the corner voice orb must read the daily briefing (briefingTap → briefingToggle)');
  assert(!/href="ai\/\?voice=1"/.test(dashboard) && !/data-href="ai\//.test(dashboard),
    'the dashboard must not re-add the removed Homebase voice link buttons (iOS iframe/hand-off audio breaks)');

  // --- loud/high-quality voice + mobile-sound regression guards ---
  // The playback <audio> element must NEVER be tapped with a
  // MediaElementSource — that silences cloud TTS on mobile Safari. Check the
  // functions where a tap could live (not the changelog prose that documents
  // this rule) so the guard is robust against its own description.
  const audioFns = ['unlockAudio','playTTSBuffer','playTTSBlob','voiceVizKick','vmeterActiveAnalyser']
    .map(extractFunction).join('\n');
  assert(!/createMediaElementSource/.test(audioFns),
    'no audio playback/metering function may tap the element via createMediaElementSource (silences mobile audio)');
  assert(!/function\s+vmeterMaybeWireTts/.test(source),
    'the removed element-tap helper (vmeterMaybeWireTts) must not return');
  // The dynamic "energy orb" renderer: an audio-reactive deformed ring
  // (frequency data) drawn with additive glow. Guards against a silent revert
  // to the flat static visualization.
  const viz = extractFunction('voiceVizKick');
  assert(/getByteFrequencyData/.test(viz) && /globalCompositeOperation\s*=\s*'lighter'/.test(viz),
    'the voice orb must remain the audio-reactive additive-glow energy field');
  // Loud playback goes through a decoded AudioBuffer + gain + limiter, which is
  // safe on iOS and lets output exceed the <audio> 100% ceiling.
  const playBuffer = extractFunction('playTTSBuffer');
  assert(/createBufferSource\(\)/.test(playBuffer) && /createGain\(\)/.test(playBuffer) &&
    /createDynamicsCompressor\(\)/.test(playBuffer),
    'the loud Web Audio TTS path (buffer + gain + limiter) must be present');
  assert((source.match(/await playTTSBuffer\(blob, text, playId\)/g) || []).length >= 3,
    'all cloud TTS providers must play through the loud buffer path');
  assert(/u\.volume = 1;/.test(extractFunction('ttsBrowser')),
    'the browser speech path must request maximum volume');
  const pump = extractFunction('ttsPump');
  assert(/mobileCloudVoice/.test(pump) && /is-mobile/.test(pump) && /selectVoiceTTSProvider/.test(pump),
    'mobile automatic voice must prefer a ready cloud voice for loudness/reliability');
  // Premium redesign: the childish rainbow starfield/aurora is gone.
  assert(!/class="v-stars"/.test(source) && !/class="v-aurora"/.test(source),
    'the rainbow starfield/aurora nodes must stay removed from the voice overlay');

  console.log('  ✓ mobile voice reliability and Tesla launcher tests pass');
}

try { main(); }
catch (err) {
  console.error('  ✗ mobile voice reliability:', err.message);
  process.exit(1);
}
