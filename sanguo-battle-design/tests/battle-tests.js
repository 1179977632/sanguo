const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

global.window = global;
['battle-data.js', 'battle-rules.js', 'battle-engine.js'].forEach((file) => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', file), 'utf8');
  vm.runInThisContext(source, { filename: file });
});

const api = global.SanguoBattle;

// 断言同种子生成完全一致的战斗记录。
function testDeterministicSeed() {
  const first = api.engine.runBattle({ seed: 20260212 });
  const second = api.engine.runBattle({ seed: 20260212 });
  assert.deepEqual(first, second);
  assert.ok(first.events.length > 0);
}

// 断言编队校验拒绝缺少主将或站位不完整的队伍。
function testFormationValidation() {
  const teams = api.data.createSampleTeams();
  teams[0].units[0].general = false;
  assert.throws(() => api.engine.runBattle({ seed: 1, teams }), /恰有一名主将/);
}

// 断言主将倒下后立即结束并记录最终胜负。
function testGeneralDefeatEndsBattle() {
  const teams = api.data.createSampleTeams();
  teams[0].units[0].troop = 1;
  const skills = Object.assign({}, api.data.skills, {
    juma: Object.assign({}, api.data.skills.juma, { chance: 1, multiplier: 20, control: null }),
    liuhuo: Object.assign({}, api.data.skills.liuhuo, { chance: 0 }),
    liannu: Object.assign({}, api.data.skills.liannu, { chance: 0 })
  });
  const result = api.engine.runBattle({ seed: 77, teams, skills });
  assert.ok(result.result);
  assert.ok(result.events.some((event) => event.kind === 'result'));
  const lastResult = result.events.find((event) => event.kind === 'result');
  assert.equal(lastResult.round, result.events.at(-1).round);
}

// 断言长期存活对局在上限回合后以平局结束。
function testRoundLimitDraw() {
  const teams = api.data.createSampleTeams().map((team) => Object.assign({}, team, {
    units: team.units.map((unit) => Object.assign({}, unit, { speed: 0, troop: unit.maxTroop }))
  }));
  const skills = {};
  Object.keys(api.data.skills).forEach((id) => {
    const skill = api.data.skills[id];
    skills[id] = Object.assign({}, skill, { chance: 0, type: skill.trigger === 'roundEnd' ? 'passive' : skill.type });
  });
  const result = api.engine.runBattle({ seed: 123, teams, skills, parameters: { baseDamage: 0.01 } });
  assert.equal(result.result.outcome, 'draw');
  assert.match(result.result.reason, /8回合/);
}

// 断言回放事件快照记录的兵力与最终状态保持一致。
function testSnapshotsAreBounded() {
  const result = api.engine.runBattle({ seed: 901 });
  result.events.forEach((event) => event.snapshot.forEach((unit) => {
    assert.ok(unit.troop >= 0);
    assert.ok(unit.troop <= unit.maxTroop);
  }));
  assert.equal(result.events.at(-1).kind, 'result');
}

[
  testDeterministicSeed,
  testFormationValidation,
  testGeneralDefeatEndsBattle,
  testRoundLimitDraw,
  testSnapshotsAreBounded
].forEach((test) => {
  test();
  process.stdout.write('PASS ' + test.name + '\n');
});
