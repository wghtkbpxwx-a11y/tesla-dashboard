#!/usr/bin/env node
'use strict';

/**
 * Concurrent cloud-budget reservation / settlement harness.
 * Extends the single-call failover baseline with parallel reserveCloudChat,
 * release/finish idempotency under races, and concurrent runChatAttempt
 * reservation accounting — all by evaluating production functions from
 * ai/index.html (no duplicated budget math).
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

const DEFAULT_SETTINGS = {cloudBudget:{limitUsd:50, windowDays:30, hardStop:true}};
const PROVIDERS = {
  openai:{name:'OpenAI', kind:'openai'},
  xai:{name:'xAI', kind:'openai'},
  demo:{name:'Demo', kind:'demo'},
  lmstudio:{name:'LM Studio', kind:'openai', local:true}
};
let S = {settings:{cloudBudget:{limitUsd:50, windowDays:30, hardStop:true}}};
let CLOUD_RESERVED_USD = 0;
let usageStore = [];
let idSeq = 0;
const LS_USAGE = 'nova_cloud_usage_v1';

function clamp(v, a, b){ return Math.min(b, Math.max(a, v)); }
function estTokens(s){ return Math.ceil(String(s || '').length / 4); }
function uuid(){ return 'id-' + (++idSeq); }
function lsGet(key, fallback){
  if (key !== LS_USAGE) return fallback;
  return usageStore.slice();
}
function lsSet(key, value){
  if (key === LS_USAGE) usageStore = Array.isArray(value) ? value.slice() : [];
}
function updateBudgetDisplays(){}
function vaultMarkChanged(){}
function localEndpoint(p){ return !!(PROVIDERS[p] && PROVIDERS[p].local); }
function cloudProvider(p){
  const pr = PROVIDERS[p];
  return !!(pr && pr.kind !== 'demo' && pr.kind !== 'webllm' && !localEndpoint(p));
}
function estimateRequestInput(){ return 1000; }
function modelInfo(){ return {requestCost:0, label:'m'}; }
// Fixed USD ceilings — keeps concurrent hard-stop math independent of token tables.
let COST_USD = 10;
function modelRequestCost(p, id){
  if (id === 'unpriced') return null;
  if (id === 'cheap') return 4;
  if (id === 'mid') return 8;
  return COST_USD;
}

const cloudBudgetCfg = eval('(' + extractFunction('cloudBudgetCfg') + ')');
const usageLedger = eval('(' + extractFunction('usageLedger') + ')');
const cloudSpendInfo = eval('(' + extractFunction('cloudSpendInfo') + ')');
const saveCloudUsage = eval('(' + extractFunction('saveCloudUsage') + ')');
const reserveCloudChat = eval('(' + extractFunction('reserveCloudChat') + ')');
const finishCloudChat = eval('(' + extractFunction('finishCloudChat') + ')');
const releaseCloudReservation = eval('(' + extractFunction('releaseCloudReservation') + ')');

let runChatRaw;
const runChatAttempt = eval('(' + extractFunction('runChatAttempt') + ')');

function reset(spent){
  CLOUD_RESERVED_USD = 0;
  idSeq = 0;
  usageStore = spent ? [{id:'seed', ts:Date.now() - 1000, costUsd:spent}] : [];
}

async function testParallelReservesNeverExceedHardStop(){
  reset(0);
  COST_USD = 10;
  const jobs = [0, 1, 2, 3, 4, 5].map(async function(){
    await Promise.resolve();
    try {
      return {ok:true, reservation:reserveCloudChat({provider:'openai', model:'gpt-5-mini', msgs:[{text:'q'}], maxTokens:2048})};
    } catch (err) {
      return {ok:false, error:err.message};
    }
  });
  const results = await Promise.all(jobs);
  const accepted = results.filter(function(r){ return r.ok; });
  const rejected = results.filter(function(r){ return !r.ok; });
  assert(accepted.length === 5, 'exactly five $10 reservations fit under the $50 hard stop');
  assert(rejected.length === 1, 'the sixth parallel reservation must hit the hard stop');
  assert(Math.abs(CLOUD_RESERVED_USD - 50) < 1e-9, 'reserved total must land on the $50 ceiling');
  assert(cloudSpendInfo().remaining >= -1e-9, 'remaining must stay non-negative while reservations are held');
  assert(rejected.every(function(r){ return /budget guard/i.test(r.error); }), 'overflow errors must come from the budget guard');
}

async function testReleaseRestoresBudgetForNextCaller(){
  reset(45);
  const first = reserveCloudChat({provider:'openai', model:'cheap', msgs:[{text:'a'}], maxTokens:2048});
  let blocked = false;
  try {
    reserveCloudChat({provider:'xai', model:'cheap', msgs:[{text:'b'}], maxTokens:2048});
  } catch (err) {
    blocked = /budget guard/i.test(err.message);
  }
  assert(blocked, 'a second $4 reservation must fail while the first holds the remaining $5');
  releaseCloudReservation(first);
  assert(Math.abs(CLOUD_RESERVED_USD) < 1e-12, 'release must clear the held reservation');
  const second = reserveCloudChat({provider:'xai', model:'cheap', msgs:[{text:'b'}], maxTokens:2048});
  assert(second && second.maximum === 4, 'released budget must become available to the next caller');
  releaseCloudReservation(second);
  assert(usageLedger().length === 1 && usageLedger()[0].id === 'seed', 'cancellation must not invent ledger spend');
}

async function testFinishAndReleaseDoNotDoubleCount(){
  reset(0);
  COST_USD = 10;
  const o = {provider:'openai', model:'gpt-5-mini', msgs:[{text:'hello'}], maxTokens:512};
  const a = reserveCloudChat(o);
  const b = reserveCloudChat(o);
  const held = CLOUD_RESERVED_USD;
  finishCloudChat(o, a, {text:'done', usage:{costUsd:0.001}});
  releaseCloudReservation(a);
  finishCloudChat(o, a, {text:'done again', usage:{costUsd:0.001}});
  assert(Math.abs(CLOUD_RESERVED_USD - (held - a.maximum)) < 1e-12, 'settled reservation must leave sibling holds intact');
  assert(usageLedger().filter(function(x){ return x.id !== 'seed'; }).length === 1, 'finish+release must record exactly one spend event');
  releaseCloudReservation(b);
  assert(CLOUD_RESERVED_USD === 0, 'releasing the sibling must zero the reserved total');
}

async function testConcurrentRunChatAttemptReservationRace(){
  reset(40);
  let peakReserved = 0;
  runChatRaw = async function(o){
    peakReserved = Math.max(peakReserved, CLOUD_RESERVED_USD);
    await new Promise(function(resolve){ setTimeout(resolve, 15); });
    if (o.provider === 'openai'){
      const err = new Error('current quota exceeded');
      err.status = 429;
      throw err;
    }
    return {text:'ok', usage:{costUsd:0.002, inTok:10, outTok:10}};
  };

  // mid = $8; remaining after $40 spent is $10 → at most one in-flight reservation.
  const settled = await Promise.allSettled([
    runChatAttempt({provider:'openai', model:'mid', msgs:[{text:'one'}], maxTokens:2048}),
    runChatAttempt({provider:'xai', model:'mid', msgs:[{text:'two'}], maxTokens:2048}),
    runChatAttempt({provider:'openai', model:'mid', msgs:[{text:'three'}], maxTokens:2048})
  ]);

  const fulfilled = settled.filter(function(r){ return r.status === 'fulfilled'; });
  const rejected = settled.filter(function(r){ return r.status === 'rejected'; });
  assert(fulfilled.length <= 1, 'tight remaining budget may admit at most one concurrent attempt');
  assert(rejected.length >= 2, 'losing racers must reject (budget or provider failure)');
  assert(peakReserved <= 10 + 1e-9, 'peak reserved during the race must stay within remaining budget');
  assert(CLOUD_RESERVED_USD === 0, 'all reservations must be finished or released after the race');
  const added = usageLedger().filter(function(x){ return x.id !== 'seed'; });
  assert(added.length === fulfilled.length, 'only successful attempts may settle into the ledger');
}

async function testFailoverAttemptReleasesBeforeNextReserve(){
  reset(0);
  COST_USD = 10;
  let rawCalls = [];
  runChatRaw = async function(o){
    rawCalls.push(o.provider + ':' + CLOUD_RESERVED_USD.toFixed(6));
    await Promise.resolve();
    if (o.provider === 'openai'){
      const err = new Error('billing hard limit reached');
      err.status = 429;
      throw err;
    }
    return {text:'fallback ok', usage:{costUsd:0.001, inTok:8, outTok:8}};
  };

  // Mimic production runChat failover: release on failure, then reserve the next pick.
  let result = null;
  let lastErr = null;
  for (const pick of [
    {provider:'openai', model:'gpt-5-mini'},
    {provider:'xai', model:'grok-3-mini'}
  ]){
    try {
      result = await runChatAttempt({provider:pick.provider, model:pick.model, msgs:[{text:'q'}], maxTokens:256});
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  assert(!lastErr && result && result.text === 'fallback ok', 'failover must reach the second provider');
  assert(rawCalls[0].indexOf('openai:') === 0 && rawCalls[1].indexOf('xai:') === 0, 'providers must run in failover order');
  const reservedDuringOpenai = +rawCalls[0].split(':')[1];
  const reservedDuringXai = +rawCalls[1].split(':')[1];
  assert(reservedDuringOpenai === 10, 'first attempt must hold its reservation while in flight');
  assert(reservedDuringXai === 10, 'failed reservation must be released before the failover reserve');
  assert(CLOUD_RESERVED_USD === 0, 'successful finish must clear the held reservation');
  assert(usageLedger().length === 1, 'failed attempt must not leave a spend event');
}

async function main(){
  await testParallelReservesNeverExceedHardStop();
  await testReleaseRestoresBudgetForNextCaller();
  await testFinishAndReleaseDoNotDoubleCount();
  await testConcurrentRunChatAttemptReservationRace();
  await testFailoverAttemptReleasesBeforeNextReserve();
  console.log('  ✓ Cloud budget concurrency tests pass');
}

main().catch(function(err){
  console.error('  ✗ Cloud budget concurrency:', err.message);
  process.exit(1);
});
