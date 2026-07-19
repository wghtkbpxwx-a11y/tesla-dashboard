#!/usr/bin/env node
/* Deterministic safety tests for Homebase AI (ai/index.html).
 *
 * Extracts the REAL production functions out of the single-file app by name
 * (brace matching, then a parse check), evaluates them in a vm sandbox with
 * mocked storage/config leaves, and asserts the safety invariants:
 *   - rolling $50 hard stop through the central reservation path
 *   - reservation settle/release idempotency (no double count, no leak)
 *   - local-first / cheapest-adequate routing, direct before OpenRouter,
 *     unknown pricing blocked, quality floor, freshness vs mutation split
 *   - mobile never auto-starts WebLLM; desktop fallback still works
 *   - sub-agents are read-only: blocked tools stripped AND blocked at exec
 *   - team budget cap and role clamps
 *   - vault merge: tombstones (delete wins, edit-beats-delete, TTL),
 *     usage dedup/clearedAt, secrets stripped when sync is off
 *   - repository guards: repoPath, validateSourceText, getBase origin pinning
 *
 * Run: node ai/tests/homebase.test.js  (no dependencies)
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* ---------- extraction ---------- */
function extractFunction(name){
  var re = new RegExp('(^|\\n)(async )?function ' + name + '\\s*\\(');
  var m = re.exec(HTML);
  if (!m) throw new Error('Function not found in ai/index.html: ' + name);
  var start = m.index + m[1].length;
  var i = HTML.indexOf('{', start), depth = 0;
  for (; i < HTML.length; i++){
    var c = HTML[i];
    if (c === '{') depth++;
    else if (c === '}'){ depth--; if (depth === 0) break; }
  }
  var src = HTML.slice(start, i + 1);
  new Function(src); // parse check — fails loudly if brace matching went wrong
  return src;
}
function extractVar(name){
  var re = new RegExp('(^|\\n)var ' + name + ' = [\\s\\S]*?;');
  var m = re.exec(HTML);
  if (!m) throw new Error('Var not found in ai/index.html: ' + name);
  var src = m[0].replace(/^\n/, '');
  new Function(src);
  return src;
}

var FUNCTIONS = [
  'lsGet','lsSet','getBase','providerReady','localEndpoint','cloudProvider',
  'providerInAutoCooldown','claimAutoProviderProbe','clearAutoProviderCooldown',
  'automaticModelUnavailableMessage',
  'cloudBudgetCfg','usageLedger','cloudSpendInfo','saveCloudUsage',
  'modelRequestCost','estimateRequestInput','reserveCloudChat','finishCloudChat',
  'releaseCloudReservation','reserveFixedCloud','finishFixedCloud','modelQuality',
  'normalizedModelName','explicitModelRequest','classifyAIRequest',
  'recentLocalProvider','localRouteCandidate','cloudRouteCandidates','selectAIRoute',
  'agentRolesForTask','shouldAutoDelegate','localModelForRole','cheapestRoleModel',
  'buildAutoAgentTeam','subagentAllowedTool','toolsForNames',
  'vaultMergeItems','vaultSectionTime','mergeVaultPayload','vaultStripConnectorSecrets',
  'loadTombstones','saveTombstones','addTombstones','mergeTombstoneLists',
  'vaultItemTime','applyTombstoneFilter','repoPath','validateSourceText'
];
var VARS = ['SUBAGENT_BLOCKED_TOOLS','LS_TOMBSTONES','TOMBSTONE_TTL_MS',
  'AUTO_PROVIDER_COOLDOWNS','AUTO_PROVIDER_PROBES'];

/* ---------- sandbox ---------- */
function makeContext(){
  var store = new Map();
  var ctx = {
    console: console, URL: URL, JSON: JSON, Math: Math, Date: Date, Object: Object,
    Array: Array, String: String, Number: Number, RegExp: RegExp, Error: Error,
    isFinite: isFinite, parseFloat: parseFloat, parseInt: parseInt, Promise: Promise,
    localStorage: {
      getItem: function(k){ return store.has(k) ? store.get(k) : null; },
      setItem: function(k, v){ store.set(k, String(v)); },
      removeItem: function(k){ store.delete(k); },
      clear: function(){ store.clear(); }
    },
    navigator: { gpu: {} },
    document: { body: { classList: {
      _s: {}, contains: function(c){ return !!this._s[c]; },
      add: function(c){ this._s[c] = true; }, remove: function(c){ delete this._s[c]; }
    } } },
    toast: function(){}, updateBudgetDisplays: function(){}, vaultMarkChanged: function(){},
    uuid: (function(){ var n = 0; return function(){ return 'id-' + (++n); }; })(),
    clamp: function(v, a, b){ return Math.min(b, Math.max(a, v)); },
    estTokens: function(s){ return Math.ceil(String(s || '').length / 4); },
    CLOUD_RESERVED_USD: 0,
    LS_USAGE: 'nova_cloud_usage_v1',
    TOOLS: [{name:'web_search'}, {name:'update_dashboard'}],
    DEFAULT_SETTINGS: { cloudBudget: {limitUsd:50, windowDays:30, hardStop:true} },
    CONNECTOR_DEFS: [
      {id:'github', fields:[{key:'token', secret:true}, {key:'repo'}]},
      {id:'drive',  fields:[{key:'clientId'}]}
    ],
    PROVIDERS: {
      anthropic:  {name:'Anthropic',  base:'https://api.anthropic.com/v1',  needsKey:true},
      openai:     {name:'OpenAI',     base:'https://api.openai.com/v1',     needsKey:true},
      perplexity: {name:'Perplexity', base:'https://api.perplexity.ai',     needsKey:true},
      openrouter: {name:'OpenRouter', base:'https://openrouter.ai/api/v1',  needsKey:true, fallbackOnly:true},
      lmstudio:   {name:'LM Studio',  base:'http://localhost:1234/v1',      local:true},
      webllm:     {name:'Browser',    kind:'webllm', models:[{id:'llama-3.2-1b'}]},
      demo:       {name:'Demo',       kind:'demo'},
      custom:     {name:'Custom',     base:''}
    },
    PROVIDER_ORDER: ['anthropic','openai','perplexity','openrouter','lmstudio','custom'],
    /* fixture model tables (leaves mocked; decision logic stays real) */
    FIX_MODELS: {
      anthropic:  [{id:'claude-sonnet-5', label:'Claude Sonnet 5'}, {id:'claude-haiku-4-5', label:'Claude Haiku 4.5'}],
      openai:     [{id:'gpt-5.6-sol', label:'GPT-5.6 Sol'}, {id:'gpt-5-mini', label:'GPT-5 mini'}, {id:'gpt-unpriced', label:'GPT Unpriced'}],
      perplexity: [{id:'sonar-pro', label:'Sonar Pro'}],
      openrouter: [{id:'or/llama-70b', label:'OR Llama 70B'}],
      lmstudio:   [{id:'qwen/qwen3.5-9b', label:'Qwen 9B'}, {id:'qwen/qwen3.5-4b', label:'Qwen 4B'}]
    },
    FIX_COST: {
      'anthropic:claude-sonnet-5':[3,15], 'anthropic:claude-haiku-4-5':[0.8,4],
      'openai:gpt-5.6-sol':[10,30], 'openai:gpt-5-mini':[0.15,0.6], 'openai:gpt-unpriced':null,
      'perplexity:sonar-pro':[1,1], 'openrouter:or/llama-70b':[0.05,0.2]
    },
    FIX_CAPS: {
      'anthropic:claude-sonnet-5':{tools:true, vision:true},
      'anthropic:claude-haiku-4-5':{tools:true},
      'openai:gpt-5.6-sol':{tools:true, vision:true},
      'openai:gpt-5-mini':{tools:true},
      'openai:gpt-unpriced':{tools:true, vision:true},
      'perplexity:sonar-pro':{nativeSearch:true},
      'openrouter:or/llama-70b':{tools:true},
      'lmstudio:qwen/qwen3.5-9b':{tools:true},
      'lmstudio:qwen/qwen3.5-4b':{}
    },
    FIX_INFO: { 'perplexity:sonar-pro':{quality:3, requestCost:0.005} },
    KEYS: {}
  };
  ctx.providerModels = function(p){ return (ctx.FIX_MODELS[p] || []).slice(); };
  ctx.modelCost = function(p, id){ var v = ctx.FIX_COST[p + ':' + id]; return v === undefined ? null : v; };
  ctx.modelCaps = function(p, id){ return Object.assign({tools:false, vision:false, nativeSearch:false}, ctx.FIX_CAPS[p + ':' + id] || {}); };
  ctx.modelInfo = function(p, id){ return Object.assign({label:id}, ctx.FIX_INFO[p + ':' + id] || {}); };
  ctx.getKey = function(p){ return ctx.KEYS[p] || ''; };
  ctx.enabledTools = function(){
    return ['web_search','read_url','calculate','search_memory','list_dashboard','research',
      'list_connectors','read_connector','list_repository_files','read_repository_file','search_repository',
      'update_dashboard','propose_repository_changes','use_connector','remember','forget_memory','schedule_task']
      .map(function(n){ return {name:n}; });
  };
  ctx.S = null; // set by resetState
  vm.createContext(ctx);
  var src = VARS.map(extractVar).concat(FUNCTIONS.map(extractFunction)).join('\n');
  vm.runInContext(src, ctx, {filename:'extracted-from-ai-index.html'});
  return ctx;
}

function resetState(ctx){
  ctx.localStorage.clear();
  ctx.CLOUD_RESERVED_USD = 0;
  Object.keys(ctx.AUTO_PROVIDER_COOLDOWNS).forEach(function(k){ delete ctx.AUTO_PROVIDER_COOLDOWNS[k]; });
  Object.keys(ctx.AUTO_PROVIDER_PROBES).forEach(function(k){ delete ctx.AUTO_PROVIDER_PROBES[k]; });
  ctx.document.body.classList._s = {};
  ctx.navigator.gpu = {};
  ctx.KEYS = {anthropic:'k', openai:'k', perplexity:'k', openrouter:'k'};
  ctx.S = {
    settings: {
      localFirst: true,
      cloudBudget: {limitUsd:50, windowDays:30, hardStop:true},
      modelCache: { lmstudio: ['qwen/qwen3.5-9b','qwen/qwen3.5-4b'] },
      providerHealth: { lmstudio: {ok:true, ts:Date.now()} },
      localPreferredModel: { lmstudio: 'qwen/qwen3.5-9b' },
      localFastModel: { lmstudio: 'qwen/qwen3.5-4b' },
      webllmFallback: true, webllmModel: 'llama-3.2-1b',
      maxTokens: 4096, temperature: 0.7, baseURL: {},
      autoDelegate: true, maxSubagents: 4, teamBudgetUsd: 1.5,
      customModels: {}
    },
    keys: ctx.KEYS, memory: [], tasks: [], convos: []
  };
}
function noLocal(ctx){
  ctx.S.settings.providerHealth = {};
  ctx.S.settings.modelCache = {};
}

/* ---------- tiny runner ---------- */
var PASS = 0, FAIL = 0, FAILED = [];
function test(name, fn){
  try { fn(); PASS++; console.log('  ok  ' + name); }
  catch(e){ FAIL++; FAILED.push(name + ' — ' + e.message); console.log('FAIL  ' + name + '\n      ' + e.message); }
}
function assert(cond, msg){ if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg){ if (a !== b) throw new Error((msg || 'not equal') + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function assertThrows(fn, re, msg){
  try { fn(); } catch(e){
    if (re && !re.test(e.message)) throw new Error((msg || 'wrong error') + ': ' + e.message);
    return;
  }
  throw new Error((msg || 'expected a throw') + ' — no error thrown');
}

var C = makeContext();
console.log('Extracted ' + FUNCTIONS.length + ' functions + ' + VARS.length + ' vars from ai/index.html\n');

/* ================= budget & reservations ================= */
console.log('-- budget / reservation path --');

test('hard stop: reservation over remaining budget throws', function(){
  resetState(C);
  C.lsSet(C.LS_USAGE, [{id:'u1', ts:Date.now() - 1000, costUsd: 49.995}]);
  assertThrows(function(){
    C.reserveCloudChat({provider:'anthropic', model:'claude-sonnet-5', msgs:[{text:'hi'}], maxTokens:4096});
  }, /budget guard/i);
  assertEq(C.CLOUD_RESERVED_USD, 0, 'no reservation leaked after throw');
});

test('hard stop: cheap request still fits under the same budget', function(){
  resetState(C);
  C.lsSet(C.LS_USAGE, [{id:'u1', ts:Date.now() - 1000, costUsd: 49.995}]);
  var r = C.reserveCloudChat({provider:'openai', model:'gpt-5-mini', msgs:[{text:'hi'}], maxTokens:256});
  assert(r && r.maximum > 0 && r.maximum <= 0.005, 'small reservation succeeds');
});

test('unknown pricing is hard-blocked when hardStop is on', function(){
  resetState(C);
  assertThrows(function(){
    C.reserveCloudChat({provider:'openai', model:'gpt-unpriced', msgs:[{text:'hi'}], maxTokens:256});
  }, /pricing is unknown/i);
});

test('local providers never create a cloud reservation', function(){
  resetState(C);
  assertEq(C.reserveCloudChat({provider:'lmstudio', model:'qwen/qwen3.5-9b', msgs:[], maxTokens:256}), null);
  assertEq(C.CLOUD_RESERVED_USD, 0);
});

test('finish settles exactly once (finish then release keeps other reservations intact)', function(){
  resetState(C);
  var o = {provider:'openai', model:'gpt-5-mini', msgs:[{text:'hello'}], maxTokens:512};
  var r1 = C.reserveCloudChat(o);
  var r2 = C.reserveCloudChat(o);
  var both = C.CLOUD_RESERVED_USD;
  assert(Math.abs(both - (r1.maximum + r2.maximum)) < 1e-12, 'both reservations held');
  C.finishCloudChat(o, r1, {text:'reply', usage:{}});
  C.releaseCloudReservation(r1); // double settle attempt — must be a no-op
  C.finishCloudChat(o, r1, {text:'reply', usage:{}}); // and again
  assert(Math.abs(C.CLOUD_RESERVED_USD - r2.maximum) < 1e-12, 'second reservation still held after double-settle of the first');
  assertEq(C.usageLedger().length, 1, 'exactly one ledger entry');
});

test('release then finish records nothing (cancelled call adds no spend)', function(){
  resetState(C);
  var o = {provider:'openai', model:'gpt-5-mini', msgs:[{text:'hello'}], maxTokens:512};
  var r = C.reserveCloudChat(o);
  C.releaseCloudReservation(r);
  C.finishCloudChat(o, r, {text:'late arrival', usage:{}});
  assertEq(C.CLOUD_RESERVED_USD, 0);
  assertEq(C.usageLedger().length, 0, 'no ledger entry after release');
});

test('fixed-cost reservations (search/speech) are idempotent the same way', function(){
  resetState(C);
  var r = C.reserveFixedCloud('brave-search', 'mcp/web-search', 'search', 0.005);
  assertEq(C.CLOUD_RESERVED_USD, 0.005);
  C.finishFixedCloud(r, {});
  C.releaseCloudReservation(r);
  C.finishFixedCloud(r, {});
  assertEq(C.CLOUD_RESERVED_USD, 0);
  assertEq(C.usageLedger().length, 1, 'exactly one fixed-cost ledger entry');
});

test('concurrent reservations reduce remaining for the next caller', function(){
  resetState(C);
  var before = C.cloudSpendInfo().remaining;
  var r = C.reserveFixedCloud('openai', 'gpt-4o-mini-tts', 'speech', 2);
  assert(C.cloudSpendInfo().remaining <= before - 2 + 1e-9, 'remaining shrinks while reserved');
  C.releaseCloudReservation(r);
  assert(Math.abs(C.cloudSpendInfo().remaining - before) < 1e-9, 'remaining restored after release');
});

test('usage ledger drops out-of-window and far-future entries', function(){
  resetState(C);
  var now = Date.now();
  C.lsSet(C.LS_USAGE, [
    {id:'old', ts: now - 31 * 86400000, costUsd: 5},
    {id:'in',  ts: now - 1000,          costUsd: 1},
    {id:'fut', ts: now + 86400000,      costUsd: 7},
    {id:'bad', ts: now - 1000,          costUsd: -3}
  ]);
  var ledger = C.usageLedger();
  assertEq(ledger.length, 1);
  assertEq(ledger[0].id, 'in');
  assertEq(C.cloudSpendInfo().spent, 1);
});

/* ================= routing ================= */
console.log('-- routing / classification --');

test('simple request routes to the fast local no-tool model', function(){
  resetState(C);
  var route = C.selectAIRoute('hello there, quick question about salt', {}, null, [{text:'hi'}]);
  assertEq(route.provider, 'lmstudio');
  assertEq(route.model, 'qwen/qwen3.5-4b', 'tier-1 no-tool prompt uses the fast 4B model');
});

test('explicit local request with tool needs picks the tool-capable 9B model', function(){
  resetState(C);
  var route = C.selectAIRoute('use local models: check the latest news headlines', {}, null, [{text:'x'}]);
  assertEq(route.provider, 'lmstudio');
  assertEq(route.model, 'qwen/qwen3.5-9b', 'tools required → 4B (no tools) skipped');
});

test('mobile never auto-starts WebLLM; desktop fallback still offered', function(){
  resetState(C);
  noLocal(C);
  var cls = {tier:1, vision:false, fresh:false, actions:false, tools:false, homebaseToolsEnabled:true};
  C.document.body.classList.add('is-mobile');
  assertEq(C.localRouteCandidate(cls), null, 'mobile: no silent WebLLM download');
  C.document.body.classList.remove('is-mobile');
  var desk = C.localRouteCandidate(cls);
  assert(desk && desk.provider === 'webllm', 'desktop: WebLLM fallback allowed');
});

test('unpriced models are excluded from automatic candidates', function(){
  resetState(C);
  noLocal(C);
  var cls = {tier:2, vision:false, fresh:false, actions:false, tools:false, explicitMax:false};
  var cands = C.cloudRouteCandidates(cls, 'q', [{text:'q'}], 1000);
  assert(cands.length > 0, 'has candidates');
  assert(!cands.some(function(x){ return x.model === 'gpt-unpriced'; }), 'unpriced model never auto-routed');
});

test('quality floor: tier-3 tasks exclude quality-3 models', function(){
  resetState(C);
  noLocal(C);
  var cands = C.cloudRouteCandidates({tier:3, vision:false, fresh:false, actions:false, tools:false}, 'q', [{text:'q'}], 1000);
  assert(cands.length > 0);
  assert(cands.every(function(x){ return x.quality >= 4; }), 'all candidates meet the floor');
});

test('direct providers outrank OpenRouter even when OpenRouter is cheaper', function(){
  resetState(C);
  noLocal(C);
  var route = C.selectAIRoute('please analyze the architecture trade-offs of this design in depth and compare the trade-offs carefully', {}, null, [{text:'q'}]);
  assert(route.provider !== 'openrouter', 'fallback-only provider not chosen while a direct provider qualifies (got ' + route.provider + ')');
  var cands = C.cloudRouteCandidates({tier:2, vision:false, fresh:false, actions:false, tools:false}, 'q', [{text:'q'}], 1000);
  var or = cands.filter(function(x){ return x.provider === 'openrouter'; })[0];
  var direct = cands.filter(function(x){ return x.provider === 'openai' && x.model === 'gpt-5-mini'; })[0];
  assert(or && direct && or.estimatedCost < direct.estimatedCost, 'fixture keeps OpenRouter cheaper (sanity)');
  assertEq(or.fallbackRank, 1); assertEq(direct.fallbackRank, 0);
});

test('OpenRouter is used when no direct provider qualifies', function(){
  resetState(C);
  noLocal(C);
  C.KEYS = {openrouter:'k'}; C.S.keys = C.KEYS;
  var route = C.selectAIRoute('please analyze this in detail and compare trade-offs across systems for production', {}, null, [{text:'q'}]);
  assertEq(route.provider, 'openrouter', 'fallback provider serves when it is the only one configured');
});

test('freshness prefers native search; mutations exclude native-search-only models', function(){
  resetState(C);
  noLocal(C);
  var fresh = {tier:2, vision:false, fresh:true, actions:false, tools:false};
  var cands = C.cloudRouteCandidates(fresh, 'q', [{text:'q'}], 1000);
  cands.sort(function(a,b){ return a.searchRank - b.searchRank || a.fallbackRank - b.fallbackRank || a.estimatedCost - b.estimatedCost || b.quality - a.quality; });
  assertEq(cands[0].provider, 'perplexity', 'native-search model ranks first for fresh-only');
  var actions = {tier:2, vision:false, fresh:true, actions:true, tools:true};
  var cands2 = C.cloudRouteCandidates(actions, 'q', [{text:'q'}], 1000);
  assert(!cands2.some(function(x){ return x.provider === 'perplexity'; }),
    'tool-less native-search model never receives mutation-tool requests');
});

test('per-request provider fee is included in estimates', function(){
  resetState(C);
  noLocal(C);
  var cands = C.cloudRouteCandidates({tier:2, vision:false, fresh:true, actions:false, tools:false}, 'q', [{text:'q'}], 1000);
  var pplx = cands.filter(function(x){ return x.provider === 'perplexity'; })[0];
  assert(pplx && pplx.estimatedCost > 0.005, 'request fee (0.005) is part of the estimate');
});

test('vision requests exclude text-only models', function(){
  resetState(C);
  noLocal(C);
  var cands = C.cloudRouteCandidates({tier:2, vision:true, fresh:false, actions:false, tools:false}, 'q', [{text:'q'}], 1000);
  assert(cands.length > 0);
  assert(cands.every(function(x){ return C.modelCaps(x.provider, x.model).vision; }), 'all candidates support vision');
});

test('"most advanced model" raises the floor and sorts by quality first', function(){
  resetState(C);
  noLocal(C);
  var cls = C.classifyAIRequest('use the most advanced model to answer this', {}, null);
  assertEq(cls.tier, 4); assert(cls.explicitMax, 'explicitMax set');
  var route = C.selectAIRoute('use the most advanced model to answer this', {}, null, [{text:'q'}]);
  assertEq(route.quality, 5, 'highest-quality candidate wins under explicitMax');
});

test('named model with unknown pricing cannot slip through as free', function(){
  resetState(C);
  noLocal(C);
  var named = C.explicitModelRequest('use gpt unpriced for this request');
  assert(named && named.model === 'gpt-unpriced', 'fixture matches by name');
  var route = C.selectAIRoute('use gpt unpriced for this request', {}, null, [{text:'q'}]);
  assert(route.model !== 'gpt-unpriced', 'unpriced named model rejected; routed to ' + route.model);
});

test('named priced model is honored with a budget check', function(){
  resetState(C);
  noLocal(C);
  var route = C.selectAIRoute('please use sonnet for this one', {}, null, [{text:'q'}]);
  assertEq(route.provider, 'anthropic'); assertEq(route.model, 'claude-sonnet-5');
  assert(isFinite(route.estimatedCost) && route.estimatedCost > 0, 'estimate attached');
});

test('demo fallback only when nothing is configured, budget-eligible, or local', function(){
  resetState(C);
  noLocal(C);
  C.KEYS = {}; C.S.keys = C.KEYS;
  C.S.settings.webllmFallback = false;
  var route = C.selectAIRoute('please analyze this in depth and compare the trade-offs', {}, null, [{text:'q'}]);
  assertEq(route.provider, 'demo', 'demo is the terminal fallback');
});

test('near-exhausted budget: cloud allowed only within the remaining estimate', function(){
  resetState(C);
  C.lsSet(C.LS_USAGE, [{id:'u1', ts:Date.now() - 1000, costUsd: 49.999}]);
  var route = C.selectAIRoute('please analyze this problem and compare the trade-offs in depth', {}, null, [{text:'q'}]);
  if (route.provider !== 'lmstudio' && route.provider !== 'demo'){
    assert(route.estimatedCost <= C.cloudSpendInfo().remaining + 1e-9,
      'any cloud route must fit the remaining budget (est ' + route.estimatedCost + ')');
  }
});

test('fully exhausted budget: no cloud route at all, local serves instead', function(){
  resetState(C);
  C.lsSet(C.LS_USAGE, [{id:'u1', ts:Date.now() - 1000, costUsd: 50}]);
  var route = C.selectAIRoute('please analyze this problem and compare the trade-offs in depth', {}, null, [{text:'q'}]);
  assert(route.provider === 'lmstudio' || route.provider === 'demo',
    'no cloud provider once the window is fully spent (got ' + route.provider + ')');
  assertThrows(function(){
    C.reserveCloudChat({provider:'openai', model:'gpt-5-mini', msgs:[{text:'q'}], maxTokens:256});
  }, /budget guard/i, 'reservation path also refuses');
});

test('cooled-down provider is skipped; routing falls to the next eligible', function(){
  resetState(C);
  noLocal(C);
  C.AUTO_PROVIDER_COOLDOWNS.openai = Date.now() + 600000;
  var cands = C.cloudRouteCandidates({tier:2, vision:false, fresh:false, actions:false, tools:false}, 'q', [{text:'q'}], 1000);
  assert(cands.length > 0, 'other providers still route');
  assert(!cands.some(function(x){ return x.provider === 'openai'; }), 'cooling provider excluded');
});

test('expired cooldown clears itself and the provider returns', function(){
  resetState(C);
  noLocal(C);
  C.AUTO_PROVIDER_COOLDOWNS.openai = Date.now() - 1000;
  assert(!C.providerInAutoCooldown('openai'), 'expired cooldown reports available');
  assert(!C.AUTO_PROVIDER_COOLDOWNS.openai, 'expired entry removed');
});

/* ================= agent teams ================= */
console.log('-- agent teams / sub-agent boundary --');

test('role definitions never include mutating tools (all archetypes)', function(){
  resetState(C);
  ['build a web app feature', 'research drug interaction evidence', 'plan my week'].forEach(function(q){
    C.agentRolesForTask(q, {tier:3}).forEach(function(role){
      role.tools.forEach(function(t){
        assert(C.SUBAGENT_BLOCKED_TOOLS.indexOf(t) < 0, 'role "' + role.label + '" advertises blocked tool ' + t);
      });
    });
  });
});

test('execution-time boundary: blocked and unlisted tools are refused', function(){
  resetState(C);
  var allow = ['web_search','calculate'];
  assert(C.subagentAllowedTool('web_search', allow), 'listed read-only tool allowed');
  assert(!C.subagentAllowedTool('use_connector', allow.concat(['use_connector'])), 'blocked tool refused even if a prompt smuggles it into the allowlist');
  assert(!C.subagentAllowedTool('read_url', allow), 'unlisted tool refused');
  assert(!C.subagentAllowedTool('propose_repository_changes', ['propose_repository_changes']), 'repo writes always refused for sub-agents');
});

test('toolsForNames strips blocked names before schemas are advertised', function(){
  resetState(C);
  var tools = C.toolsForNames(['web_search','update_dashboard','forget_memory','calculate']);
  var names = tools.map(function(t){ return t.name; });
  assertEq(names.join(','), 'web_search,calculate');
});

test('auto-delegate respects the off switch and "work alone"', function(){
  resetState(C);
  C.S.settings.autoDelegate = false;
  assert(!C.shouldAutoDelegate('build a full app with several agents', {tier:4}), 'setting off wins');
  C.S.settings.autoDelegate = true;
  assert(!C.shouldAutoDelegate("don't use agents, build the feature yourself", {tier:3}), 'user opt-out wins');
  assert(C.shouldAutoDelegate('build a new dashboard feature end to end', {tier:3}), 'build-type task delegates');
});

test('team budget cap: first two roles kept, later roles dropped over cap', function(){
  resetState(C);
  noLocal(C);
  C.S.settings.teamBudgetUsd = 0.05;
  C.KEYS = {anthropic:'k'}; C.S.keys = C.KEYS; // only expensive Sonnet/Haiku available
  var team = C.buildAutoAgentTeam('build a new feature for the dashboard app', null, [{text:'q'}]);
  assert(team.length >= 2, 'a viable team keeps at least two members');
  assert(team.length < 4, 'cap dropped at least one role (got ' + team.length + ')');
  assert(team.projectedCost <= 0.05 + 1e-9, 'projected cost within cap');
});

test('maxSubagents clamps the role list', function(){
  resetState(C);
  C.S.settings.maxSubagents = 2;
  assertEq(C.agentRolesForTask('build a web app', {tier:3}).length, 2);
});

test('no eligible models → empty team (single-agent fallback)', function(){
  resetState(C);
  noLocal(C);
  C.KEYS = {}; C.S.keys = C.KEYS;
  var team = C.buildAutoAgentTeam('build a new feature for the dashboard app', null, [{text:'q'}]);
  assertEq(team.length, 0);
});

test('local models only serve roles up to quality 3', function(){
  resetState(C);
  var lo = C.localModelForRole({quality:3, tools:[]});
  assert(lo && lo.provider === 'lmstudio' && lo.estimatedCost === 0, 'quality-3 role can run locally at $0');
  assertEq(C.localModelForRole({quality:4, tools:[]}), null, 'quality-4 role never downgraded to local');
});

/* ================= vault merge & tombstones ================= */
console.log('-- vault merge / tombstones --');

function payload(over){
  return Object.assign({
    v:2, deviceId:'dev', exportedAt:Date.now(), sectionUpdatedAt:{},
    memory:[], tasks:[], connectors:{}, keys:{}, settings:{}, cloudUsage:[], sync:{}
  }, over || {});
}

test('deleted item stays deleted across devices (tombstone beats id-union)', function(){
  resetState(C);
  var now = Date.now();
  var local = payload({deviceId:'A', sectionUpdatedAt:{memory: now},
    memory:[{id:'m1', ts: now - 5000, text:'keep'}],
    tombstones:{memory:[{id:'m2', ts: now - 1000}], tasks:[]}});
  var remote = payload({sectionUpdatedAt:{memory: now - 8000},
    memory:[{id:'m1', ts: now - 5000, text:'keep'}, {id:'m2', ts: now - 6000, text:'deleted elsewhere'}]});
  var merged = C.mergeVaultPayload(remote, local);
  assertEq(merged.memory.length, 1);
  assertEq(merged.memory[0].id, 'm1');
  assert(merged.tombstones.memory.some(function(t){ return t.id === 'm2'; }), 'tombstone travels in the merged payload');
});

test('edit after delete survives (edit beats delete)', function(){
  resetState(C);
  var now = Date.now();
  var local = payload({tombstones:{memory:[{id:'m2', ts: now - 5000}], tasks:[]}});
  var remote = payload({memory:[{id:'m2', ts: now - 1000, text:'re-edited after deletion'}]});
  var merged = C.mergeVaultPayload(remote, local);
  assertEq(merged.memory.length, 1, 'newer edit wins over older tombstone');
});

test('expired tombstones are garbage-collected', function(){
  resetState(C);
  var now = Date.now();
  var merged = C.mergeTombstoneLists([{id:'old', ts: now - C.TOMBSTONE_TTL_MS - 1000}], [{id:'fresh', ts: now - 1000}]);
  assertEq(merged.length, 1);
  assertEq(merged[0].id, 'fresh');
});

test('delete sites record tombstones locally', function(){
  resetState(C);
  C.addTombstones('memory', ['a', 'b', null]);
  C.addTombstones('tasks', ['t1']);
  var t = C.loadTombstones();
  assertEq(t.memory.length, 2); assertEq(t.tasks.length, 1);
  C.addTombstones('memory', ['a']); // re-delete refreshes ts, no duplicate
  assertEq(C.loadTombstones().memory.length, 2);
});

test('usage merge dedups by id, honors clearedAt, sorts by time', function(){
  resetState(C);
  var now = Date.now();
  var local = payload({sync:{usageClearedAt: now - 75}, cloudUsage:[
    {id:'a', ts: now - 100, costUsd:1}, {id:'c', ts: now - 10, costUsd:3}]});
  var remote = payload({cloudUsage:[
    {id:'a', ts: now - 100, costUsd:1}, {id:'b', ts: now - 50, costUsd:2}]});
  var merged = C.mergeVaultPayload(remote, local);
  assertEq(merged.cloudUsage.map(function(x){ return x.id; }).join(','), 'b,c', 'pre-clear entry dropped, rest deduped and sorted');
  assertEq(merged.sync.usageClearedAt, now - 75);
});

test('secrets stripped from merge when this device has secret sync off', function(){
  resetState(C);
  var local = payload({sync:{encryptedSecrets:false}});
  var remote = payload({keys:{openai:'REMOTE'}, connectors:{github:{token:'REMOTE', repo:'r'}}});
  var merged = C.mergeVaultPayload(remote, local);
  assertEq(Object.keys(merged.keys).length, 0, 'keys emptied');
  assert(!merged.connectors.github || !merged.connectors.github.token, 'secret connector fields stripped');
  assertEq(merged.connectors.github.repo, 'r', 'non-secret fields kept');
});

test('newer section wins for settings on conflict', function(){
  resetState(C);
  var now = Date.now();
  var local = payload({sectionUpdatedAt:{settings: now}, settings:{theme:'local-new'}});
  var remote = payload({sectionUpdatedAt:{settings: now - 60000}, settings:{theme:'remote-old', extra:1}});
  var merged = C.mergeVaultPayload(remote, local);
  assertEq(merged.settings.theme, 'local-new');
  assertEq(merged.settings.extra, 1, 'non-conflicting remote fields preserved');
});

/* ================= repository & origin guards ================= */
console.log('-- repository / origin guards --');

test('repoPath blocks traversal, secrets, git internals, workflows', function(){
  resetState(C);
  ['../x', 'a/../b', '.env', 'config/.env.local', '.git/config', 'secrets/keys.txt',
   'credentials.json', '.github/workflows/deploy.yml'].forEach(function(p){
    assertThrows(function(){ C.repoPath(p); }, /not allowed/i, p + ' must be blocked');
  });
  assertEq(C.repoPath('/ai/index.html'), 'ai/index.html', 'normal paths pass (leading slash trimmed)');
  assertEq(C.repoPath('docs/x.gitignore-notes.md'), 'docs/x.gitignore-notes.md');
});

test('validateSourceText rejects embedded credentials and broken JSON/JS', function(){
  resetState(C);
  var fakeSecret = 'api_key = "' + new Array(25).join('A') + '"'; // synthetic, assembled at runtime
  assertThrows(function(){ C.validateSourceText('x.js', fakeSecret); }, /secret/i);
  assertThrows(function(){ C.validateSourceText('x.json', '{nope'); });
  assertThrows(function(){ C.validateSourceText('x.html', '<script>var broken = ;</script>'); });
  assert(C.validateSourceText('x.html', '<script>var fine = 1;</script>'));
});

test('cloud keys stay pinned to official origins; custom stays configurable', function(){
  resetState(C);
  C.S.settings.baseURL = {anthropic:'https://evil.example.com/v1', custom:'http://localhost:8080/v1'};
  assertEq(C.getBase('anthropic'), 'https://api.anthropic.com/v1', 'tampered base override ignored for key-bearing provider');
  assertEq(C.getBase('custom'), 'http://localhost:8080/v1', 'custom endpoint honored');
  C.S.settings.baseURL = {anthropic:'not a url'};
  assertEq(C.getBase('anthropic'), 'https://api.anthropic.com/v1', 'unparseable override falls back to official base');
});

/* ---------- summary ---------- */
console.log('\n' + PASS + ' passed, ' + FAIL + ' failed');
if (FAIL){
  console.log('\nFailures:');
  FAILED.forEach(function(f){ console.log('  - ' + f); });
  process.exit(1);
}
