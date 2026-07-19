#!/usr/bin/env node
'use strict';

/**
 * Specialist-team harness: team budget cap via production buildAutoAgentTeam,
 * plus partial member failure settlement that still reaches lead synthesis
 * (mirrors the sendMessage Promise.all + catch contract).
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

let S = {
  settings:{
    autoDelegate:true,
    maxSubagents:4,
    teamBudgetUsd:1.5
  }
};

function clamp(v, a, b){ return Math.min(b, Math.max(a, v)); }
function classifyAIRequest(){ return {tier:3, tools:true, actions:true}; }

let roleCatalog = [];
let picksByLabel = {};

function shouldAutoDelegate(){ return !!S.settings.autoDelegate; }
function agentRolesForTask(){ return roleCatalog.slice(0, clamp(+S.settings.maxSubagents || 4, 2, 6)); }
function cheapestRoleModel(role){
  return picksByLabel[role.label] || null;
}

const buildAutoAgentTeam = eval('(' + extractFunction('buildAutoAgentTeam') + ')');

function testTeamBudgetCapDropsLaterRoles(){
  S.settings.teamBudgetUsd = 0.05;
  S.settings.maxSubagents = 4;
  roleCatalog = [
    {label:'Architecture', quality:4, prompt:'a', tools:['list_dashboard']},
    {label:'Product & UI', quality:3, prompt:'b', tools:['list_dashboard']},
    {label:'Data & connectors', quality:3, prompt:'c', tools:['list_connectors']},
    {label:'Implementation & QA', quality:4, prompt:'d', tools:['list_dashboard']}
  ];
  picksByLabel = {
    'Architecture':{provider:'openai', model:'mini', estimatedCost:0.02, maxTokens:1000},
    'Product & UI':{provider:'openai', model:'mini', estimatedCost:0.02, maxTokens:1000},
    'Data & connectors':{provider:'openai', model:'mini', estimatedCost:0.02, maxTokens:1000},
    'Implementation & QA':{provider:'openai', model:'mini', estimatedCost:0.02, maxTokens:1000}
  };
  const team = buildAutoAgentTeam('build a dashboard feature', {classification:{tier:3}}, [{text:'q'}]);
  assert(team.length === 2, 'cap must keep the first two roles and drop the rest (got ' + team.length + ')');
  assert(Math.abs(team.projectedCost - 0.04) < 1e-12, 'projected cost must equal the kept members');
  assert(team[0].label === 'Architecture' && team[1].label === 'Product & UI', 'roles are kept in declaration order');
}

function testTeamBelowTwoMembersReturnsEmpty(){
  S.settings.teamBudgetUsd = 1.5;
  roleCatalog = [
    {label:'Planner', quality:3, prompt:'p', tools:[]},
    {label:'Specialist', quality:3, prompt:'s', tools:[]}
  ];
  picksByLabel = {
    'Planner':{provider:'openai', model:'mini', estimatedCost:0.01, maxTokens:800}
    // Specialist missing → only one pick
  };
  const team = buildAutoAgentTeam('delegate several agents on this audit', {classification:{tier:3}}, []);
  assert(team.length === 0, 'fewer than two ready specialists must fall back to single-agent mode');
}

function testAutoDelegateOffYieldsEmptyTeam(){
  S.settings.autoDelegate = false;
  roleCatalog = [
    {label:'A', quality:3, prompt:'a', tools:[]},
    {label:'B', quality:3, prompt:'b', tools:[]}
  ];
  picksByLabel = {
    A:{provider:'xai', model:'grok', estimatedCost:0.01, maxTokens:800},
    B:{provider:'xai', model:'grok', estimatedCost:0.01, maxTokens:800}
  };
  assert(buildAutoAgentTeam('build an app', {classification:{tier:4}}, []).length === 0,
    'autoDelegate=false must suppress specialist teams');
  S.settings.autoDelegate = true;
}

/**
 * Behavioral mirror of the sendMessage member-job catch + lead synthesis path.
 * Production source contracts are asserted separately so drift fails loudly.
 */
async function settleSpecialistTeam(members, runMember, runLead){
  const council = members.map(function(mem){
    return {
      label:mem.label, provider:mem.provider, model:mem.model,
      text:'', state:'run', error:null
    };
  });
  const memberJobs = council.map(function(cm){
    return (async function(){
      try {
        cm.text = await runMember(cm);
        cm.state = 'done';
      } catch (e) {
        if (e && (e.name === 'AbortError' || e.code === 20)) throw e;
        cm.state = 'err';
        cm.error = (e && e.message) || String(e);
      }
    })();
  });
  await Promise.all(memberJobs);
  const dossier = council.map(function(cm, i){
    return '### Specialist ' + (i + 1) + ' — ' + cm.label + '\n' +
      (cm.error ? '[error] ' + cm.error : (cm.text || '(empty)'));
  }).join('\n\n');
  const lead = await runLead(dossier, council);
  return {council:council, dossier:dossier, lead:lead};
}

async function testPartialMemberFailureStillSynthesizes(){
  const outcome = await settleSpecialistTeam(
    [
      {label:'Architecture', provider:'openai', model:'mini'},
      {label:'Product & UI', provider:'xai', model:'grok'},
      {label:'Implementation & QA', provider:'openai', model:'mini'}
    ],
    async function(cm){
      if (cm.label === 'Product & UI') throw new Error('credits unavailable');
      await Promise.resolve();
      return cm.label + ' handoff';
    },
    async function(dossier, council){
      assert(/\[error\] credits unavailable/.test(dossier), 'failed member must appear in the lead dossier');
      assert(/Architecture handoff/.test(dossier) && /Implementation & QA handoff/.test(dossier),
        'successful handoffs must still reach the lead');
      assert(council.filter(function(c){ return c.state === 'done'; }).length === 2, 'two members succeed');
      assert(council.filter(function(c){ return c.state === 'err'; }).length === 1, 'one member records err');
      return {text:'lead reconciled partial team', usedProvider:'openai', usedModel:'mini'};
    }
  );
  assert(outcome.lead.text === 'lead reconciled partial team', 'lead synthesis must run after partial failure');
}

async function testAbortStillCancelsTheTeam(){
  let leadCalled = false;
  let threw = false;
  try {
    await settleSpecialistTeam(
      [
        {label:'A', provider:'openai', model:'mini'},
        {label:'B', provider:'xai', model:'grok'}
      ],
      async function(cm){
        if (cm.label === 'A'){
          const err = new Error('aborted');
          err.name = 'AbortError';
          err.code = 20;
          throw err;
        }
        await new Promise(function(resolve){ setTimeout(resolve, 30); });
        return 'late';
      },
      async function(){
        leadCalled = true;
        return {text:'should not run'};
      }
    );
  } catch (err) {
    threw = err.name === 'AbortError';
  }
  assert(threw, 'user abort must reject the team Promise.all');
  assert(!leadCalled, 'lead synthesis must not run after abort');
}

function testSendMessagePartialFailureContracts(){
  const send = extractFunction('sendMessage');
  assert(/await Promise\.all\(memberJobs\)/.test(send), 'specialists must run in parallel via Promise.all');
  assert(/cm\.state = 'err'/.test(send) && /cm\.error =/.test(send),
    'non-abort member failures must be recorded on the member, not kill the team');
  assert(/e\.name === 'AbortError' \|\| e\.code === 20/.test(send),
    'only abort errors rethrow from the member catch');
  assert(/runTeamLeadSynthesis\(/.test(send), 'lead synthesis always follows member settlement');
  assert(/cm\.error \? '\[error\]'/.test(send) || /cm\.error \? "\[error\]"/.test(send) ||
    /cm\.error \? '\[error\] ' \+ cm\.error/.test(send),
    'failed member errors are included in the lead dossier');
  assert(/allowDemoFallback:false/.test(extractFunction('runSubagentMember')),
    'sub-agents must not fall through to Demo mid-team');
  assert(/allowDemoFallback:false/.test(extractFunction('runTeamLeadSynthesis')),
    'lead synthesis must not fall through to Demo mid-team');
}

async function main(){
  testTeamBudgetCapDropsLaterRoles();
  testTeamBelowTwoMembersReturnsEmpty();
  testAutoDelegateOffYieldsEmptyTeam();
  await testPartialMemberFailureStillSynthesizes();
  await testAbortStillCancelsTheTeam();
  testSendMessagePartialFailureContracts();
  console.log('  ✓ Specialist team tests pass');
}

main().catch(function(err){
  console.error('  ✗ Specialist team:', err.message);
  process.exit(1);
});
