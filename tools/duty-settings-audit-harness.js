'use strict';
// Audit harness for the PIC settings screen and what Auto-Suggest does with it.
//
// WHY THIS EXISTS
// The settings screen and Auto-Suggest meet through four small functions and one
// mirrored variable, and each of them can fail quietly -- a setting that saves,
// displays as saved, and changes nothing. That is the worst failure this feature
// has, because a PIC has no way to tell it happened: the roster simply keeps
// behaving the way it did before.
//
// So this pins down the seams rather than the rules (tools/duty-pairing-harness.js
// covers the rules). Each block corresponds to a finding in the audit. Most are now
// fixed and asserted as fixed; the ones still marked KNOWN GAP assert how the code
// behaves TODAY, so that changing one fails a check and the change has to be
// deliberate rather than incidental.
//
// HOW IT WORKS
// Reimplements nothing: slices the real functions out of Index.html and runs them
// against stubs, and for call-graph claims asserts against the real source text.
//
// USAGE
//   node tools/duty-settings-audit-harness.js                 # checks ../Index.html
//   node tools/duty-settings-audit-harness.js path/to/file.html
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const INDEX = process.argv.slice(2).find(a => !a.startsWith('--')) ||
              path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }

const src = fs.readFileSync(INDEX, 'utf8');
const lines = src.split(/\r?\n/);

const results = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(ok);
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n          got  ' + JSON.stringify(actual) + '\n          want ' + JSON.stringify(expected)));
}

// Slice a top-level `function name(` or `var name =` out of the roster IIFE.
function extract(decl, name) {
  const re = decl === 'function'
    ? new RegExp('^  function ' + name + '\\s*\\(')
    : new RegExp('^  var ' + name + '\\s*=');
  const startIdx = lines.findIndex(l => re.test(l));
  if (startIdx < 0) throw new Error('not found in ' + path.basename(INDEX) + ': ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{' || ch === '[' || ch === '(') { depth++; started = true; }
      else if (ch === '}' || ch === ']' || ch === ')') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced brackets while extracting: ' + name);
}

const want = [
  ['var', 'ROLE_NOT_APPLICABLE'],
  ['function', '_applyPairingOverrides'],
  ['function', '_dutySetting'],
  ['function', '_dutySettingField'],
  ['function', '_builtInApplies'],
  ['function', '_autoFillRoleApplies'],
  ['function', '_firingPairings']
];
console.log('Extracted from ' + path.basename(INDEX) + ':');
const sliced = {};
for (const pair of want) {
  sliced[pair[1]] = extract(pair[0], pair[1]);
  console.log('  ' + pair[1] + ' @ line ' + sliced[pair[1]].line);
}

// Stubs: only what the sliced code actually reaches.
const NORM = 'function _nameNorm(s) { return (s || 0 ? String(s) : \'\').trim().replace(/\\s+/g, \' \').toLowerCase(); }';
const SPLIT = 'function splitCellPeople(v) { return String(v).split(\' / \').map(function(s) { return s.trim(); }).filter(Boolean); }';

const harness = [
  'var ROSTER_DUTY_SETTINGS = {};',
  'var ROSTER_DUTY_PAIRINGS = [];',
  'var STATE = { rosterEdits: new Map() };',
  // The real function guards on window.RosterEngine and then assigns to the bare
  // global. Same object in a browser, so the stub has to be one object too.
  'var RosterEngine = { _dutyPairingOverrides: null, checkClashes: function() {} };',
  'var window = { RosterEngine: RosterEngine };',
  NORM,
  SPLIT,
  sliced.ROLE_NOT_APPLICABLE.text,
  sliced._applyPairingOverrides.text,
  sliced._dutySetting.text,
  sliced._dutySettingField.text,
  sliced._builtInApplies.text,
  sliced._autoFillRoleApplies.text,
  sliced._firingPairings.text,
  'return {',
  '  set: function(o) { ROSTER_DUTY_SETTINGS = o; },',
  '  setPairings: function(a) { ROSTER_DUTY_PAIRINGS = a; },',
  '  setEdits: function(m) { STATE.rosterEdits = m; },',
  '  overrides: function() { return window.RosterEngine._dutyPairingOverrides; },',
  '  resetOverrides: function() { window.RosterEngine._dutyPairingOverrides = null; },',
  '  applyPairingOverrides: _applyPairingOverrides,',
  '  dutySettingField: _dutySettingField,',
  '  autoFillRoleApplies: _autoFillRoleApplies,',
  '  builtInApplies: _builtInApplies,',
  '  firingPairings: _firingPairings',
  '};'
].join('\n');
const A = new Function(harness)();

// ---------------------------------------------------------------------------
console.log('\n1. Singer counts -- two on Traditional, three on Contemporary');
check('Singer 3 is skipped on Traditional',
  A.autoFillRoleApplies('singer3', 'traditional'), false);
check('Singer 3 runs on Contemporary',
  A.autoFillRoleApplies('singer3', 'contemporary'), true);
check('Singer 4 is skipped on Traditional',
  A.autoFillRoleApplies('singer4', 'traditional'), false);
check('Singer 4 is skipped on Contemporary too -- no silent fourth singer',
  A.autoFillRoleApplies('singer4', 'contemporary'), false);
check('Singers 1 and 2 run on both',
  ['singer1', 'singer2'].map(function(r) {
    return A.autoFillRoleApplies(r, 'traditional') && A.autoFillRoleApplies(r, 'contemporary');
  }), [true, true]);

// ---------------------------------------------------------------------------
console.log('\n2. Saving a duty no longer pins "Runs on this service"');
// applies used to be written as a boolean every time, so merely opening a duty
// and saving it froze that answer and outranked ROLE_NOT_APPLICABLE from then on
// -- the singer4 fix above would not have reached a PIC who had saved Singer 4 /
// Contemporary first. Save now stores null while the box agrees with the built-in
// list, so a later change to that list still reaches everybody.
check('Save stores null while the box agrees with the built-in answer',
  /applies: \(appliesNow === _builtInApplies\(_dsRole, _dsTeam\)\) \? null : appliesNow/.test(src), true);
check('the built-in answer is read without consulting any saved row',
  (function() {
    A.set({ 'singer4__contemporary': { roleId: 'singer4', serviceType: 'contemporary',
            people: null, monthlyCap: null, applies: true } });
    return A.builtInApplies('singer4', 'contemporary');
  })(), false);
check('a deliberate override is still honoured -- it only exists on disagreement',
  A.autoFillRoleApplies('singer4', 'contemporary'), true);
A.set({ 'singer4__contemporary': { roleId: 'singer4', serviceType: 'contemporary',
        people: null, monthlyCap: null, applies: null } });
check('a null applies defers to the built-in list',
  A.autoFillRoleApplies('singer4', 'contemporary'), false);
A.set({});

// ---------------------------------------------------------------------------
console.log('\n3. Which row wins: the specific service type over "all"');
A.set({
  'pianist__all':         { roleId: 'pianist', serviceType: 'all',         people: ['Anyone'], monthlyCap: 5, applies: null },
  'pianist__traditional': { roleId: 'pianist', serviceType: 'traditional', people: null,       monthlyCap: 3, applies: null }
});
check('a specific monthlyCap beats the all-services one',
  A.dutySettingField('pianist', 'traditional', 'monthlyCap'), 3);
check('a null field on the specific row falls through to all-services',
  A.dutySettingField('pianist', 'traditional', 'people'), ['Anyone']);
check('a service type with no specific row reads the all-services one',
  A.dutySettingField('pianist', 'contemporary', 'monthlyCap'), 5);
check('an unset duty reads as null, meaning built-in behaviour',
  A.dutySettingField('usher1', 'traditional', 'monthlyCap'), null);
A.set({});

// ---------------------------------------------------------------------------
console.log('\n4. Clash overrides are read off the <category>__all row only');
A.set({ 'singer__all': { roleId: 'singer', serviceType: 'all', people: null,
        monthlyCap: null, applies: null, mayPairWith: ['communion', 'reader', 'usher'] } });
A.applyPairingOverrides();
check('an all-services row becomes an override',
  A.overrides(), { singer: ['communion', 'reader', 'usher'] });
A.resetOverrides();

A.set({ 'singer__traditional': { roleId: 'singer', serviceType: 'traditional', people: null,
        monthlyCap: null, applies: null, mayPairWith: ['usher'] } });
A.applyPairingOverrides();
check('a per-service row is ignored -- clash rules do not vary by service type',
  A.overrides(), null);
A.resetOverrides();

A.set({ 'singer__all': { roleId: 'singer', serviceType: 'all', people: null,
        monthlyCap: null, applies: null, mayPairWith: null } });
A.applyPairingOverrides();
check('a null mayPairWith is not an override -- the built-in list stands',
  A.overrides(), null);
A.resetOverrides();

A.set({ 'preacher__all': { roleId: 'preacher', serviceType: 'all', people: null,
        monthlyCap: null, applies: null, mayPairWith: [] } });
A.applyPairingOverrides();
check('an EMPTY array IS an override -- "this duty pairs with nothing"',
  A.overrides(), { preacher: [] });
A.resetOverrides();
A.set({});

// ---------------------------------------------------------------------------
console.log('\n5. The override survives a server that cannot be reached');
// ROSTER_DUTY_SETTINGS is restored from localStorage while the file parses, but
// RosterEngine does not exist that early, so the mirror it reads cannot be filled
// there. It used to be filled ONLY by a successful cloud fetch, which meant that
// offline the roster quietly fell back to the built-in clash rules while the
// settings screen still showed the PIC's rule as saved. It is applied during roster
// init now, before the network is involved at all.
const initFn = (src.match(/function loadRosterNamesFromCloud\(\) \{[\s\S]*?\n  \}/) || [''])[0];
check('roster init puts the restored override into force',
  /_applyPairingOverrides\(\);/.test(initFn), true);
check('...and does so BEFORE asking the server for anything',
  initFn.indexOf('_applyPairingOverrides();') < initFn.indexOf('_loadDutySettingsFromCloud();'), true);
check('four callers now: init, the cloud success path, a clash edit, and a reset',
  (src.match(/^\s*_applyPairingOverrides\(\);/gm) || []).length, 4);

// ---------------------------------------------------------------------------
console.log('\n6. Pairing rules fire off a cell that is already filled');
const edits = new Map();
edits.set('liturgist__Oct_4', 'Dorine Nathaniel');
edits.set('singer1__Oct_4', 'Alison Phan');
A.setEdits(edits);
A.setPairings([
  { whenRole: 'liturgist', whenPerson: 'Dorine Nathaniel', serviceType: 'all',
    thenRole: 'pianist', thenPeople: ['Aaron Jayaraj'], strict: false },
  { whenRole: 'singer1', whenPerson: 'Alison Phan', serviceType: 'traditional',
    thenRole: 'singer2', thenPeople: ['Cynthia Chin', 'Gina Tai'], strict: false },
  { whenRole: 'singer1', whenPerson: 'Gina Tai', serviceType: 'traditional',
    thenRole: 'singer2', thenPeople: ['Alison Phan'], strict: false },
  // Backwards: Preacher is filled long before Singer 1, so this can never fire.
  { whenRole: 'singer1', whenPerson: 'Alison Phan', serviceType: 'all',
    thenRole: 'preacher', thenPeople: ['Pastor Ashley'], strict: false }
]);
check('the Dorine rule fires for Pianist',
  A.firingPairings('pianist', 'traditional', 'Oct_4').map(function(r) { return r.thenPeople; }),
  [['Aaron Jayaraj']]);
check('the co-singer rule fires for Singer 2',
  A.firingPairings('singer2', 'traditional', 'Oct_4').map(function(r) { return r.thenPeople; }),
  [['Cynthia Chin', 'Gina Tai']]);
check('the rule naming somebody NOT in the cell stays out of it',
  A.firingPairings('singer2', 'traditional', 'Oct_4').length, 1);
check('the wrong service type does not fire',
  A.firingPairings('singer2', 'contemporary', 'Oct_4').length, 0);
check('a date with nothing filled fires nothing',
  A.firingPairings('singer2', 'traditional', 'Oct_11').length, 0);
A.setEdits(new Map([['singer1__Oct_18', 'Alison  Phan ']]));
check('doubled whitespace in a cell still matches the rule',
  A.firingPairings('singer2', 'traditional', 'Oct_18').length, 1);
A.setEdits(new Map([['singer1__Oct_25', 'Jo Tan / Alison Phan']]));
check('a mentor/trainee cell "A / B" matches on either name',
  A.firingPairings('singer2', 'traditional', 'Oct_25').length, 1);
A.setEdits(new Map([['singer1__Nov_1', '__BLANK__']]));
check('a deliberately blanked cell fires nothing',
  A.firingPairings('singer2', 'traditional', 'Nov_1').length, 0);

// ---------------------------------------------------------------------------
console.log('\n7. KNOWN GAP -- a backwards rule works or not depending on the month');
// Duties fill in ROLES order, and the "then" dropdown offers every other duty, so
// a PIC can save a rule whose target is settled BEFORE its trigger.
//
// Such a rule is not simply dead, which is what makes it worth a check: it fires
// if and only if the trigger cell happens to be filled already. Run over a blank
// month it does nothing; run over a month where somebody hand-typed Singer 1
// first, it applies. Same rule, same screen, two behaviours.
const roleOrder = (src.match(/\{type:'role',id:'([a-z0-9]+)'/g) || [])
  .map(function(s) { return s.replace(/.*id:'/, '').replace(/'$/, ''); });
check('ROLES settles Preacher before Singer 1',
  roleOrder.indexOf('preacher') < roleOrder.indexOf('singer1'), true);
check('the "then duty" dropdown offers every duty except the current one',
  /var duties = _dsDuties\(\)\.filter\(function\(r\) \{ return r\.id !== roleId; \}\);/.test(src), true);
A.setEdits(new Map());
check('over a blank month the backwards rule does nothing',
  A.firingPairings('preacher', 'traditional', 'Dec_6').length, 0);
A.setEdits(new Map([['singer1__Dec_6', 'Alison Phan']]));
check('over a month with Singer 1 already typed in, the same rule applies',
  A.firingPairings('preacher', 'traditional', 'Dec_6').length, 1);

// ---------------------------------------------------------------------------
console.log('\n8. A monthly cap outside 1-10 is refused, not silently changed');
// A typed 0 used to come out as 2 (parseInt('0') is falsy) and a typed 40 as 10.
// Silently altering a PIC's number is the same class of bug as ignoring it, so Save
// now declines with a reason and leaves the field as they typed it.
check('the silent clamp is gone',
  /Math\.max\(1, Math\.min\(10, parseInt\(capRaw, 10\) \|\| 2\)\)/.test(src), false);
check('the range guard is live, not merely present',
  /if \(!blankCap && !\(cap >= 1 && cap <= 10\)\) \{/.test(src), true);
check('out-of-range is refused with a reason',
  /A monthly limit has to be a whole number from 1 to 10/.test(src), true);
check('the guard admits 1 through 10 and nothing else',
  [0, 1, 2, 10, 11, NaN].map(function(c) { return !!(c >= 1 && c <= 10); }),
  [false, true, true, true, false, false]);
check('a blank field still means "use the built-in 2"',
  /var blankCap = \(capRaw === '' \|\| capRaw === undefined \|\| capRaw === null\);/.test(src), true);

// ---------------------------------------------------------------------------
console.log('\n9. KNOWN GAP -- Auto-Suggest never places one person twice in a day');
// The clash rules decide what shows RED. assignedToday decides what Auto-Suggest
// will place, and it refuses a second duty outright -- so a PIC who allows a new
// pairing changes the warning, not what Auto-Suggest does with it.
check('the candidate filter blocks anyone already serving that day',
  /if \(role\.id !== 'flowerarrangement' && assignedToday\[_afKey\(name\)\]\) return false;/.test(src), true);
check('that filter never consults the pairing rules',
  /assignedToday[\s\S]{0,200}?_dutiesMayPair/.test(src), false);
check('the one exception is the Liturgist mirrored into Communion Assistant 1',
  /communion1[\s\S]{0,600}?liturgistVal/.test(src), true);

// ---------------------------------------------------------------------------
console.log('\n10. Nothing claims a removal the server has not confirmed');
// Both of these used to write their note before the request resolved, so a failed
// delete read as success and the rule or setting came back on the next reload with
// nothing having said so. Asserting the wording alone would not catch a relapse --
// the fire-and-forget version says the same words -- so assert the waiting.
check('removing a pairing waits for the server before saying it is done',
  /deleteDutyPairing\(rule\)\.then\(function\(\) \{/.test(src), true);
check('...and no longer fires the delete off without waiting',
  /deleteDutyPairing\(rule\)\.catch\(/.test(src), false);
check('...and says so plainly when it could not reach the server',
  /Removed on this device only -- could not reach the server, so it will return/.test(src), true);
check('the interim note does not read as finished',
  /note\.textContent = 'Removing\.\.\.';/.test(src), true);
check('Use default waits for both halves of the revert',
  /Promise\.all\(sent\)\.then\(function\(\) \{/.test(src), true);
check('...and does not announce the default before they land',
  /_dsRenderList\(\); _dsRenderPane\(\);[\s\S]{0,120}?textContent = 'Back to the default\.';/.test(src), false);

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(32));
console.log(passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
