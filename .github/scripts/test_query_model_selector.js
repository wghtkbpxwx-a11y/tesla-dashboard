#!/usr/bin/env node
'use strict';

const fs = require('fs');
const source = fs.readFileSync('ai/index.html', 'utf8');

function extractFunction(name) {
  const marker = new RegExp('function\\s+' + name + '\\s*\\(');
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

const PROVIDERS = {xai:{name:'xAI Grok'}, groq:{name:'Groq'}};
const S = {settings:{maxTokens:2048}};
const classifyAIRequest = () => ({tier:2, tools:true, actions:true});
const cloudProvider = (provider) => provider !== 'lmstudio';
const modelInfo = (provider, model) => ({label:model === 'grok-3-mini' ? 'Grok 3 mini' : model});
const queryModelValue = eval('(' + extractFunction('queryModelValue') + ')');
const parseQueryModelValue = eval('(' + extractFunction('parseQueryModelValue') + ')');
const queryOverrideRoute = eval('(' + extractFunction('queryOverrideRoute') + ')');

function main() {
  assert(source.includes('id="query-model-select"'), 'composer must contain the next-message model dropdown');

  const encoded = queryModelValue('xai', 'grok/model:preview');
  const decoded = parseQueryModelValue(encoded);
  assert(decoded && decoded.provider === 'xai' && decoded.model === 'grok/model:preview',
    'provider/model values must round-trip safely through the dropdown');
  assert(parseQueryModelValue('not-a-route') === null, 'invalid dropdown values must be rejected');

  const route = queryOverrideRoute({provider:'xai', model:'grok-3-mini'}, {text:'send an email'}, {toolsOn:true});
  assert(route.provider === 'xai' && route.model === 'grok-3-mini', 'the exact selected model must become the query route');
  assert(route.maxTokens === 2048 && route.classification.actions, 'the exact route must preserve request classification and limits');
  assert(/Chosen for this message/.test(route.reason), 'the response must explain that the route was chosen for this message');

  assert(/configuredCouncilReady\s*=\s*!!\(!queryOverride/.test(source),
    'a one-message selection must suppress the model council');
  assert(/autoTeam\s*=\s*\(S\.settings\.autoRoute\s*&&\s*!queryOverride/.test(source),
    'a one-message selection must suppress automatic specialist delegation');
  assert(/autoFailover:!!S\.settings\.autoRoute\s*&&\s*!queryOverride/.test(source),
    'a one-message selection must not silently fail over to another model');
  assert(/um\.requestedRoute\s*=/.test(source) && /opts\.regen\s*&&\s*latestUser\.requestedRoute/.test(source),
    'the selected route must survive regeneration while the composer resets');
  assert(/S\.queryModelOverride\s*=\s*null;\s*refreshQueryModelSelect\(\)/.test(source),
    'the composer must reset to Automatic after accepting the query');

  console.log('  ✓ per-query model selector tests pass');
}

try { main(); }
catch (err) {
  console.error('  ✗ per-query model selector:', err.message);
  process.exit(1);
}
