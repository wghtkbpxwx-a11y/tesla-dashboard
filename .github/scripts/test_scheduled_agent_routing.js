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

const PROVIDERS = {
  demo: {name:'Demo', kind:'demo'},
  xai: {name:'xAI Grok', kind:'openai'},
  openai: {name:'OpenAI', kind:'openai'}
};
let S = {settings:{autoRoute:true, provider:'demo', model:'demo'}};
let ready = {xai:true, openai:true, demo:true};
let providerReady = (provider) => !!ready[provider];
let modelInfo = (provider, model) => ({label:model});
let classifyAIRequest = () => ({tier:2});
let automaticModelUnavailableMessage = () => 'No real model available.';
let routeCalls = [];
let selectAIRoute = (query, um, convo, msgs) => {
  routeCalls.push({query, um, convo, msgs});
  return {provider:'xai', model:'grok-3-mini', reason:'Auto route', classification:{tier:2}};
};
const selectScheduledTaskRoute = eval('(' + extractFunction('selectScheduledTaskRoute') + ')');

function testAutomaticDefaultUsesTheLiveRouter() {
  routeCalls = [];
  S.settings.autoRoute = true;
  const task = {prompt:'Email my morning briefing', model:''};
  const convo = {id:'c1'}, um = {text:task.prompt}, msgs = [{role:'user', text:task.prompt}];
  const result = selectScheduledTaskRoute(task, convo, um, msgs);
  assert(routeCalls.length === 1 && routeCalls[0].query === task.prompt, 'default scheduled tasks must call the same automatic router as live chat');
  assert(result.provider === 'xai' && result.model === 'grok-3-mini', 'automatic scheduled task must receive the selected real model');
  assert(result.autoFailover === true, 'automatic scheduled tasks must opt into provider failover');
}

function testExplicitTaskModelStaysTerminal() {
  routeCalls = [];
  ready.openai = true;
  const result = selectScheduledTaskRoute({prompt:'Run report', model:'openai::gpt-5-nano'}, {}, {}, []);
  assert(result.provider === 'openai' && result.model === 'gpt-5-nano', 'explicit scheduled model must be preserved');
  assert(result.autoFailover === false && routeCalls.length === 0, 'explicit scheduled model must not silently involve another provider');
}

function testUnavailableTaskNeverPretendsDemoIsAnAgent() {
  ready.openai = false;
  let result = selectScheduledTaskRoute({prompt:'Run report', model:'openai::gpt-5-nano'}, {}, {}, []);
  assert(result.unavailable && result.autoFailover === false, 'disconnected explicit task model must pause with an actionable error');
  S.settings.autoRoute = false;
  S.settings.provider = 'demo'; S.settings.model = 'demo';
  result = selectScheduledTaskRoute({prompt:'Run report', model:''}, {}, {}, []);
  assert(result.unavailable === 'No real model available.', 'manual Demo default must not simulate a scheduled agent');
}

function testRunPipelineContracts() {
  const runTask = extractFunction('runTask');
  assert(/selectScheduledTaskRoute\(t, convo, um, routePreview\)/.test(runTask), 'runTask must resolve its route before starting the agent');
  assert(/autoFailover:!!taskRoute\.autoFailover/.test(runTask), 'runTask must pass automatic failover into runChat');
  assert(/allowDemoFallback:false/.test(runTask), 'scheduled agents must never fall through to simulated Demo after a real provider fails');
  assert(/am\.provider = provider; am\.model = model;/.test(runTask), 'scheduled result metadata must show the model that actually answered');
  assert(/if \(taskRoute\.unavailable\)/.test(runTask), 'scheduled tasks must stop before tool execution when no real model is available');
  assert(source.includes("p === 'demo' || PROVIDERS[p].kind === 'voice'"), 'task model picker must not offer Demo or voice-only providers as agents');
  assert(source.includes('lsSet(LS_KEYS, S.keys || {});'), 'mobile page suspension must synchronously flush provider-key edits');
  assert(source.includes("Automatic paused · no real model ran"), 'unavailable-agent metadata must not label a simulated Demo model as having run');
}

function main() {
  testAutomaticDefaultUsesTheLiveRouter();
  testExplicitTaskModelStaysTerminal();
  testUnavailableTaskNeverPretendsDemoIsAnAgent();
  testRunPipelineContracts();
  console.log('  ✓ Scheduled agent routing tests pass');
}

try { main(); }
catch (err) {
  console.error('  ✗ Scheduled agent routing:', err.message);
  process.exit(1);
}
