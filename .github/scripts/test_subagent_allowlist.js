#!/usr/bin/env node
/* Adversarial sub-agent tool allowlist tests (Wave 1 P0-1).
 *
 * A prompt-injected sub-agent must not be able to reach ANY tool it was not
 * granted — and especially not a mutating tool such as
 * propose_repository_changes. This harness extracts the REAL production
 * SUBAGENT_BLOCKED_TOOLS + subagentAllowedTool out of ai/index.html (brace
 * matched, then parse-checked), evaluates the pure guard in a vm sandbox, and
 * proves:
 *   - a granted read-only tool is allowed
 *   - an ungranted tool is refused even though nothing "blocks" it
 *   - a blocked mutating tool is refused even when smuggled into the allowlist
 *   - runSubagentMember enforces the allowlist at EXECUTION time (the check
 *     runs BEFORE execTool for every emitted tool call)
 *
 * Run: node .github/scripts/test_subagent_allowlist.js   (no dependencies)
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'ai', 'index.html'), 'utf8');

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
  new Function(src); // parse check — fails loudly if brace matching drifted
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

var ctx = { console: console };
vm.createContext(ctx);
vm.runInContext(extractVar('SUBAGENT_BLOCKED_TOOLS'), ctx);
vm.runInContext(extractFunction('subagentAllowedTool'), ctx);

var PASS = 0, FAILS = [];
function assert(cond, msg){ if (cond){ PASS++; console.log('  \u2713 ' + msg); } else { FAILS.push(msg); console.log('  \u2717 ' + msg); } }

console.log('Sub-agent tool allowlist (P0-1) adversarial tests...');

/* The blocked list must contain every externally-mutating tool. */
['propose_repository_changes','use_connector','update_dashboard','schedule_task',
 'remember','update_memory','forget_memory'].forEach(function(n){
  assert(ctx.SUBAGENT_BLOCKED_TOOLS.indexOf(n) >= 0, 'SUBAGENT_BLOCKED_TOOLS includes mutating tool ' + n);
});

var allow = ['web_search','read_url','calculate'];

assert(ctx.subagentAllowedTool('web_search', allow) === true,
  'a granted read-only tool is allowed');
assert(ctx.subagentAllowedTool('get_weather', allow) === false,
  'an ungranted (but not blocked) tool is refused — allowlist is positive, not just a denylist');
assert(ctx.subagentAllowedTool('propose_repository_changes', allow.concat(['propose_repository_changes'])) === false,
  'a blocked repo-write tool is refused even when smuggled into the allowlist');
assert(ctx.subagentAllowedTool('use_connector', allow.concat(['use_connector'])) === false,
  'a blocked connector-write tool is refused even when smuggled into the allowlist');
assert(ctx.subagentAllowedTool('update_dashboard', ['update_dashboard']) === false,
  'a blocked dashboard-write tool is refused even if it is the ONLY name in the allowlist');
assert(ctx.subagentAllowedTool('web_search', []) === false &&
       ctx.subagentAllowedTool('web_search', null) === false,
  'nothing is allowed when the allowlist is empty or missing');

/* Execution-time enforcement: the guard must run BEFORE execTool inside
 * runSubagentMember, so a model that emits an unauthorized tool name is
 * rejected instead of executed. This is a source contract check. */
var body = extractFunction('runSubagentMember');
var guardIdx = body.indexOf('subagentAllowedTool(call.name');
var execIdx = body.indexOf('execTool(call.name');
assert(guardIdx >= 0, 'runSubagentMember checks subagentAllowedTool(call.name, ...) per call');
assert(execIdx >= 0, 'runSubagentMember still executes granted calls via execTool(call.name, ...)');
assert(guardIdx >= 0 && execIdx >= 0 && guardIdx < execIdx,
  'the allowlist check runs BEFORE execTool (unauthorized names never reach execution)');
assert(/results\.push\(\{[\s\S]*?is outside this sub-agent/.test(body) || /outside this sub-agent/.test(body),
  'a refused call returns an allowlist error string to the model instead of throwing');

console.log('');
if (FAILS.length){
  console.log('FAILED: ' + FAILS.length + ' sub-agent allowlist check(s) did not pass.');
  process.exit(1);
}
console.log('All ' + PASS + ' sub-agent allowlist checks passed.');
