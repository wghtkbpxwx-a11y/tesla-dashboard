#!/usr/bin/env node
'use strict';

/**
 * Schema-v2 vault merge harness — evaluates production mergeVaultPayload /
 * vaultMergeItems / tombstone helpers from ai/index.html and asserts the
 * documented push-abort contract for wrong-passphrase / decrypt failures.
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const TOMBSTONE_TTL_MS = 90 * 86400000;
const CONNECTOR_DEFS = [
  {id:'github', fields:[{key:'token', secret:true}, {key:'repo', secret:false}]},
  {id:'drive', fields:[{key:'clientId', secret:false}]}
];

const vaultSectionTime = eval('(' + extractFunction('vaultSectionTime') + ')');
const vaultMergeItems = eval('(' + extractFunction('vaultMergeItems') + ')');
const vaultItemTime = eval('(' + extractFunction('vaultItemTime') + ')');
const mergeTombstoneLists = eval('(' + extractFunction('mergeTombstoneLists') + ')');
const applyTombstoneFilter = eval('(' + extractFunction('applyTombstoneFilter') + ')');
const vaultStripConnectorSecrets = eval('(' + extractFunction('vaultStripConnectorSecrets') + ')');
const mergeVaultPayload = eval('(' + extractFunction('mergeVaultPayload') + ')');

function payload(over){
  return Object.assign({
    v:2,
    deviceId:'dev',
    exportedAt:Date.now(),
    sectionUpdatedAt:{},
    memory:[],
    tasks:[],
    connectors:{},
    keys:{},
    settings:{},
    cloudUsage:[],
    tombstones:{memory:[], tasks:[]},
    sync:{}
  }, over || {});
}

function testPhoneDesktopSectionTimestampMerge(){
  const now = Date.now();
  // Phone edited settings + a new memory; desktop edited tasks + an older settings stamp.
  const phone = payload({
    deviceId:'phone',
    sectionUpdatedAt:{settings:now, memory:now, tasks:now - 60000},
    settings:{theme:'phone-dark', fontSize:18},
    memory:[{id:'m-phone', ts:now - 1000, text:'from phone'}],
    tasks:[{id:'t-shared', ts:now - 5000, text:'stale phone copy'}]
  });
  const desktop = payload({
    deviceId:'desktop',
    sectionUpdatedAt:{settings:now - 120000, memory:now - 5000, tasks:now},
    settings:{theme:'desktop-light', accent:'#0f0'},
    memory:[{id:'m-desk', ts:now - 2000, text:'from desktop'}],
    tasks:[{id:'t-shared', ts:now - 500, text:'desktop wins task'}, {id:'t-new', ts:now - 400, text:'desktop only'}]
  });

  const mergedPhonePush = mergeVaultPayload(desktop, phone);
  assert(mergedPhonePush.deviceId === 'phone', 'pushing device owns deviceId');
  assert(mergedPhonePush.settings.theme === 'phone-dark', 'newer settings section wins');
  assert(mergedPhonePush.settings.accent === '#0f0', 'older non-conflicting settings fields are preserved');
  assert(mergedPhonePush.memory.map(function(m){ return m.id; }).sort().join(',') === 'm-desk,m-phone',
    'memory items union across devices');
  assert(mergedPhonePush.tasks.find(function(t){ return t.id === 't-shared'; }).text === 'desktop wins task',
    'newer tasks section supplies the shared task body');
  assert(mergedPhonePush.tasks.some(function(t){ return t.id === 't-new'; }), 'desktop-only task survives');
  assert(mergedPhonePush.sectionUpdatedAt.settings === now, 'section clocks take the max timestamp');

  const mergedDesktopPull = mergeVaultPayload(phone, desktop);
  assert(mergedDesktopPull.settings.theme === 'phone-dark', 'merge is commutative for the winning settings value');
  assert(mergedDesktopPull.tasks.find(function(t){ return t.id === 't-shared'; }).text === 'desktop wins task',
    'desktop still wins the newer tasks section when it is the local side');
}

function testUsageEventIdDedup(){
  const now = Date.now();
  const local = payload({
    sync:{usageClearedAt: now - 75},
    cloudUsage:[
      {id:'a', ts: now - 100, costUsd:1},
      {id:'c', ts: now - 10, costUsd:3},
      {id:'c', ts: now - 10, costUsd:3}
    ]
  });
  const remote = payload({
    cloudUsage:[
      {id:'a', ts: now - 100, costUsd:1},
      {id:'b', ts: now - 50, costUsd:2}
    ]
  });
  const merged = mergeVaultPayload(remote, local);
  assert(merged.cloudUsage.map(function(x){ return x.id; }).join(',') === 'b,c',
    'usage events dedupe by id, drop pre-clear rows, and sort by ts');
  assert(merged.sync.usageClearedAt === now - 75, 'clearedAt takes the max across devices');
}

function testEncryptedSecretsFalseStripsSecrets(){
  const local = payload({sync:{encryptedSecrets:false}, keys:{openai:'LOCAL'}});
  const remote = payload({
    keys:{openai:'REMOTE', anthropic:'REMOTE2'},
    connectors:{github:{token:'SECRET_TOKEN', repo:'wghtkbpxwx-a11y/tesla-dashboard'}, drive:{clientId:'cid'}}
  });
  const merged = mergeVaultPayload(remote, local);
  assert(Object.keys(merged.keys).length === 0, 'keys must be emptied when encryptedSecrets is false');
  assert(!merged.connectors.github.token, 'secret connector fields must be stripped');
  assert(merged.connectors.github.repo === 'wghtkbpxwx-a11y/tesla-dashboard', 'non-secret connector fields remain');
  assert(merged.connectors.drive.clientId === 'cid', 'non-secret connectors remain');
  assert(merged.sync.encryptedSecrets === false, 'sync flag stays false after merge');
}

function testDecryptFailureAbortContract(){
  const push = extractFunction('vaultPushToDrive');
  assert(/opts\.mergeRemote !== false/.test(push), 'push must attempt a remote merge by default');
  assert(/decryptVault\(pass, remoteVault\)/.test(push), 'push must decrypt the remote vault before upload');
  assert(/mergeVaultPayload\(remotePayload, payload\)/.test(push), 'push must merge remote into local before encrypting');
  assert(/Sync stopped to protect the existing Drive vault/.test(push),
    'decrypt/download failures must abort with the protective sync-stopped error');
  assert(/No vault file/.test(push), 'only a missing remote vault may skip the abort path');
  assert(!/catch\s*\([^)]*\)\s*\{\s*\}/.test(push.replace(/\s+/g, ' ')),
    'push must not swallow decrypt failures into an empty catch');

  const decrypt = extractFunction('decryptVault');
  assert(/Wrong passphrase or corrupted vault/.test(decrypt),
    'decryptVault must surface wrong-passphrase as an explicit error');

  // Documented contract: any decrypt throw other than "No vault file" becomes a hard abort.
  const fakeDecryptError = new Error('Wrong passphrase or corrupted vault');
  let abortedMessage = null;
  try {
    if (!/No vault file/.test(fakeDecryptError.message || '')) {
      throw new Error('Sync stopped to protect the existing Drive vault: ' + fakeDecryptError.message);
    }
  } catch (err) {
    abortedMessage = err.message;
  }
  assert(/Sync stopped to protect/.test(abortedMessage) && /Wrong passphrase/.test(abortedMessage),
    'wrong passphrase must abort push rather than overwrite the remote vault');
}

function testMissingRemoteReturnsLocal(){
  const local = payload({deviceId:'only', settings:{theme:'solo'}});
  const merged = mergeVaultPayload(null, local);
  assert(merged === local, 'missing remote payload returns local unchanged');
}

function main(){
  testPhoneDesktopSectionTimestampMerge();
  testUsageEventIdDedup();
  testEncryptedSecretsFalseStripsSecrets();
  testDecryptFailureAbortContract();
  testMissingRemoteReturnsLocal();
  console.log('  ✓ Vault merge tests pass');
}

try { main(); }
catch (err) {
  console.error('  ✗ Vault merge:', err.message);
  process.exit(1);
}
