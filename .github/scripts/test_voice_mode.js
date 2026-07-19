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
  elevenTtsModel:'eleven_flash_v2_5', elevenSttModel:'scribe_v2', preferPremiumVoiceMobile:false
}};
const keys = {xai:'xai-test', elevenlabs:'eleven-test', openai:'openai-test'};
const getKey = (provider) => keys[provider] || '';
const S = {settings:{speech:{engine:'auto', xaiVoice:'eve', elevenVoiceId:'voice-id', preferPremiumVoiceMobile:false}}};

// Mutable device context for the mobile premium opt-in checks below.
let IS_IOS = false;
let mobileFlag = false;
const document = { body: { classList: { contains: (c) => c === 'is-mobile' && mobileFlag } } };

const chooseVoiceTranscript = eval('(' + extractFunction('chooseVoiceTranscript') + ')');
const normalizeSpeechSettings = eval('(' + extractFunction('normalizeSpeechSettings') + ')');
const voiceSTTPlan = eval('(' + extractFunction('voiceSTTPlan') + ')');
const selectVoiceSTTProvider = eval('(' + extractFunction('selectVoiceSTTProvider') + ')');
const voiceTTSPlan = eval('(' + extractFunction('voiceTTSPlan') + ')');
const selectVoiceTTSProvider = eval('(' + extractFunction('selectVoiceTTSProvider') + ')');
const isMobileVoiceDevice = eval('(' + extractFunction('isMobileVoiceDevice') + ')');
const mobilePremiumVoiceCloudFirst = eval('(' + extractFunction('mobilePremiumVoiceCloudFirst') + ')');

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

  // ---- Mobile premium voice opt-in (Wave 2 P1) ----
  // Restore the full key set for the opt-in scenarios.
  keys.xai = 'xai-test'; keys.openai = 'openai-test'; keys.elevenlabs = 'eleven-test';

  // Default (opt-in OFF): Automatic keeps the documented free-device-first plan.
  S.settings.speech.engine = 'auto';
  S.settings.speech.preferPremiumVoiceMobile = false;
  mobileFlag = true; IS_IOS = true;
  assert(mobilePremiumVoiceCloudFirst() === false,
    'without the opt-in, Automatic voice must stay free-device-first even on mobile');

  // Opt-in ON + ready xAI key on mobile: cloud voice first, ordered by cost.
  S.settings.speech.preferPremiumVoiceMobile = true;
  assert(mobilePremiumVoiceCloudFirst() === true,
    'the opt-in with a ready cloud key on mobile must run cloud voice first');
  assert(selectVoiceTTSProvider('auto') === 'xai',
    'mobile premium voice must pick the lowest-cost ready cloud provider first');
  assert(voiceTTSPlan('auto').join(',') === 'xai,openai,elevenlabs',
    'mobile premium voice plan must stay modality-cost-ordered');

  // Opt-in ON but no cloud keys: falls back to device speech (no spend).
  const savedKeys = Object.assign({}, keys);
  delete keys.xai; delete keys.openai; delete keys.elevenlabs;
  assert(mobilePremiumVoiceCloudFirst() === false,
    'the opt-in must fall back to free device speech when no cloud key is ready (no spend)');
  assert(voiceTTSPlan('auto').length === 0,
    'no cloud keys means no cloud speech plan and no spend');
  Object.assign(keys, savedKeys);

  // Explicit device-only mode never spends, even with the opt-in and keys ready.
  S.settings.speech.engine = 'device';
  assert(mobilePremiumVoiceCloudFirst() === false,
    'explicit device-only mode must never route to cloud voice');
  assert(voiceTTSPlan('device').length === 0,
    'device-only mode must never spend cloud credits');

  // Opt-in ON but a non-mobile device: the free-device-first default is preserved.
  S.settings.speech.engine = 'auto';
  mobileFlag = false; IS_IOS = false;
  assert(mobilePremiumVoiceCloudFirst() === false,
    'the mobile opt-in must not change desktop behaviour');
  // Restore mobile+auto context for any later reads.
  S.settings.speech.preferPremiumVoiceMobile = false;

  const ttsPumpSrc = extractFunction('ttsPump');
  assert(/mobilePremiumVoiceCloudFirst\(\)/.test(ttsPumpSrc) &&
    /runAutomaticTTSFallback\(text, playId\)/.test(ttsPumpSrc) &&
    ttsPumpSrc.indexOf('mobilePremiumVoiceCloudFirst()') < ttsPumpSrc.lastIndexOf('ttsBrowser(text, playId)'),
    'ttsPump must try mobile premium cloud voice before the device-voice fallback');
  assert(/normalizeSpeechSettings/.test(source) &&
    /preferPremiumVoiceMobile\s*=\s*!!/.test(extractFunction('normalizeSpeechSettings')),
    'the premium opt-in must be normalized to a boolean and persisted in speech settings');

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
  assert((dashboard.match(/ai\/\?voice=1/g) || []).length >= 4 && /Homebase Voice/.test(dashboard),
    'Tesla dashboard voice entry points must open Homebase Voice');

  console.log('  ✓ mobile voice reliability and Tesla launcher tests pass');
}

try { main(); }
catch (err) {
  console.error('  ✗ mobile voice reliability:', err.message);
  process.exit(1);
}
