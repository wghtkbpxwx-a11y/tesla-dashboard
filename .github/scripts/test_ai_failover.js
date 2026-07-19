#!/usr/bin/env node
'use strict';

const fs = require('fs');
const source = fs.readFileSync('ai/index.html', 'utf8');

function extractFunction(name) {
  const marker = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = marker.exec(source);
  if (!match) throw new Error('Function not found: ' + name);
  const start = match.index;
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
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

const autoFailurePolicy = eval('(' + extractFunction('autoFailurePolicy') + ')');

let buildAutoFailoverPlan;
let providerInAutoCooldown;
let providerReady;
let runChatAttempt;
let autoFailoverPolicyForError;
let markAutoProviderFailure;
const runChat = eval('(' + extractFunction('runChat') + ')');

let modelQuality = () => 3;
let cloudProvider = () => true;
let cloudRouteCandidates;
const productionBuildAutoFailoverPlan = eval('(' + extractFunction('buildAutoFailoverPlan') + ')');

async function testFailurePolicies() {
  let p = autoFailurePolicy(429, 'You exceeded your current quota. Check billing.', 0);
  assert(p.eligible && p.scope === 'provider' && p.reason === 'credits unavailable', 'quota must disable the provider and fail over');
  assert(p.cooldownMs >= 21600000, 'quota cooldown must avoid repeatedly burning requests');

  p = autoFailurePolicy(429, 'Too many requests', 120000);
  assert(p.eligible && p.reason === 'temporarily rate limited' && p.cooldownMs === 120000, '429 retry-after must be respected');

  p = autoFailurePolicy(401, 'invalid api key', 0);
  assert(p.eligible && p.scope === 'provider' && p.reason === 'key or access unavailable', 'invalid keys must move to another provider');

  p = autoFailurePolicy(404, 'model not found', 0);
  assert(p.eligible && p.scope === 'model', 'model-specific failures must not disable the whole provider');

  p = autoFailurePolicy(0, 'Failed to fetch', 0);
  assert(p.eligible && p.scope === 'provider' && p.reason === 'network unavailable', 'network failures must permit failover');

  p = autoFailurePolicy(0, 'user cancelled', 0);
  assert(!p.eligible, 'unknown errors must not be retried blindly');
}

async function testBackupPlanRemainsGloballyCostRanked() {
  cloudRouteCandidates = () => [
    {provider:'xai', model:'grok', estimatedCost:0.003, searchRank:0, fallbackRank:0, quality:3},
    {provider:'openai', model:'mini', estimatedCost:0.001, searchRank:0, fallbackRank:0, quality:3},
    {provider:'google', model:'flash', estimatedCost:0.002, searchRank:0, fallbackRank:0, quality:3}
  ];
  const plan = productionBuildAutoFailoverPlan({
    provider:'openai', model:'nano', maxTokens:500, qualityFloor:3,
    msgs:[], tools:null, classification:{tier:2}
  });
  assert(plan.slice(0, 5).map((x) => x.provider + '/' + x.model).join(',') ===
    'openai/nano,openai/mini,google/flash,xai/grok,demo/demo',
    'backup models must stay globally cost-ranked even when the same provider has multiple eligible models');
}

function setupRunChat(plan, behavior, readiness, cooldown) {
  const marked = [];
  const blocked = new Set();
  buildAutoFailoverPlan = () => plan;
  providerReady = (provider) => provider === 'demo' || (readiness ? readiness(provider) : true);
  providerInAutoCooldown = (provider) => cooldown ? cooldown(provider) : blocked.has(provider);
  autoFailoverPolicyForError = (err) => err.autoFailurePolicy || autoFailurePolicy(0, err.message, 0);
  markAutoProviderFailure = (provider, policy) => {
    marked.push({provider, policy});
    if (policy.scope === 'provider') blocked.add(provider);
  };
  runChatAttempt = behavior;
  return marked;
}

async function testQuotaFallsThroughToCheapestEligibleProvider() {
  const calls = [];
  const plan = [
    {provider:'openai', model:'gpt-5-nano'},
    {provider:'xai', model:'grok-3-mini'},
    {provider:'demo', model:'demo'}
  ];
  const marked = setupRunChat(plan, async (o) => {
    calls.push(o.provider);
    if (o.provider === 'openai') {
      const err = new Error('current quota exceeded');
      err.autoFailurePolicy = autoFailurePolicy(429, err.message, 0);
      throw err;
    }
    return {text:'real answer', usage:{}};
  });
  const result = await runChat({provider:'openai', model:'gpt-5-nano', autoFailover:true});
  assert(calls.join(',') === 'openai,xai', 'quota failure must try the next ranked provider exactly once');
  assert(result.usedProvider === 'xai' && result.usedModel === 'grok-3-mini', 'successful fallback route must be returned');
  assert(result.failovers.length === 1 && result.failovers[0].reason === 'credits unavailable', 'fallback reason must remain visible');
  assert(marked.length === 1 && marked[0].provider === 'openai', 'quota-exhausted provider must enter cooldown');
}

async function testMissingKeyIsSkipped() {
  const calls = [];
  const plan = [
    {provider:'openai', model:'gpt-5-nano'},
    {provider:'xai', model:'grok-3-mini'},
    {provider:'demo', model:'demo'}
  ];
  setupRunChat(plan, async (o) => { calls.push(o.provider); return {text:'ok', usage:{}}; },
    (provider) => provider !== 'openai');
  const result = await runChat({provider:'openai', model:'gpt-5-nano', autoFailover:true});
  assert(calls.join(',') === 'xai', 'provider without a key must be skipped without an API call');
  assert(result.usedProvider === 'xai', 'next configured provider must answer');
}

async function testNoProviderUsesSafeDemoFallback() {
  const calls = [];
  const plan = [
    {provider:'openai', model:'gpt-5-nano'},
    {provider:'demo', model:'demo'}
  ];
  setupRunChat(plan, async (o) => { calls.push(o.provider); return {text:'demo', usage:{}}; }, () => false);
  const result = await runChat({provider:'openai', model:'gpt-5-nano', autoFailover:true});
  assert(calls.join(',') === 'demo' && result.usedProvider === 'demo', 'no-key state must remain functional in honest demo mode');
}

async function testPartialStreamDoesNotDuplicateAcrossProviders() {
  const calls = [];
  const plan = [
    {provider:'openai', model:'gpt-5-nano'},
    {provider:'xai', model:'grok-3-mini'}
  ];
  setupRunChat(plan, async (o) => {
    calls.push(o.provider);
    o.onText('partial');
    const err = new Error('quota after stream');
    err.autoFailurePolicy = autoFailurePolicy(429, err.message, 0);
    throw err;
  });
  let rejected = false;
  try { await runChat({provider:'openai', model:'gpt-5-nano', autoFailover:true, onText:() => {}}); }
  catch (err) { rejected = true; }
  assert(rejected, 'partial-stream error must be surfaced');
  assert(calls.join(',') === 'openai', 'partial output must never be duplicated by retrying another model');
}

async function testDemoStillRunsAfterAttemptCap() {
  const calls = [];
  const plan = ['a','b','c','d','e','f','g','h'].map((provider) => ({provider, model:'model'}));
  plan.push({provider:'demo', model:'demo'});
  setupRunChat(plan, async (o) => {
    calls.push(o.provider);
    if (o.provider === 'demo') return {text:'demo', usage:{}};
    const err = new Error('network error');
    err.autoFailurePolicy = autoFailurePolicy(0, err.message, 0);
    throw err;
  });
  const result = await runChat({provider:'a', model:'model', autoFailover:true});
  assert(result.usedProvider === 'demo', 'safe demo fallback must remain reachable after the cloud-attempt cap');
  assert(calls.length === 7 && calls[calls.length - 1] === 'demo', 'failover must cap cloud attempts at six, then use demo');
}

async function main() {
  await testFailurePolicies();
  await testBackupPlanRemainsGloballyCostRanked();
  await testQuotaFallsThroughToCheapestEligibleProvider();
  await testMissingKeyIsSkipped();
  await testNoProviderUsesSafeDemoFallback();
  await testPartialStreamDoesNotDuplicateAcrossProviders();
  await testDemoStillRunsAfterAttemptCap();
  console.log('  ✓ AI automatic provider failover tests pass');
}

main().catch((err) => {
  console.error('  ✗ AI automatic provider failover:', err.message);
  process.exit(1);
});
