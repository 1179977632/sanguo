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

// 构造仅保留指定普攻的战法表，降低定向战斗测试中的随机噪声。
function createBasicOnlySkills() {
  return Object.keys(api.data.skills).reduce((skills, id) => {
    skills[id] = Object.assign({}, api.data.skills[id], { chance: 0 });
    return skills;
  }, {});
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
  skills.juma = Object.assign({}, skills.juma, {
    chance: 1,
    control: null,
    status: { name: '长效易伤', category: 'damageTaken', value: 0.1, duration: 10, durationType: 'rounds' }
  });
  const result = api.engine.runBattle({ seed: 123, teams, skills, parameters: { baseDamage: 0.01 } });
  assert.equal(result.result.outcome, 'draw');
  assert.equal(result.result.rounds, 8);
  assert.match(result.result.reason, /8回合/);
  assert.ok(result.events.some((event) => event.kind === 'status' && event.status === '长效易伤'));
  assert.ok(result.events.at(-1).snapshot.every((unit) => unit.statuses.length === 0 && unit.prepared === null));
}

// 断言行动前持续伤害倒下非主将后仍会继续处理本轮剩余行动者。
function testBeforeActionDefeatDoesNotSkipRound() {
  const teams = api.data.createSampleTeams().map((team) => Object.assign({}, team, {
    units: team.units.map((unit) => Object.assign({}, unit, { speed: 0 }))
  }));
  teams[0].units[0].speed = 200;
  teams[1].units[0].speed = 150;
  teams[1].units[0].troop = 1;
  teams[1].units[0].damageImmunity = ['physical'];
  teams[0].units[1].speed = 100;
  teams[1].units[1].speed = 50;
  const skills = createBasicOnlySkills();
  skills.juma = Object.assign({}, skills.juma, {
    type: 'active', chance: 1, multiplier: 0.01, control: null,
    status: { name: '灼烧', damagePerTick: 1, timing: 'beforeAction', duration: 1, durationType: 'actions', ticks: 1 }
  });
  skills.liuhuo = Object.assign({}, skills.liuhuo, { type: 'active', chance: 0 });
  skills.liannu = Object.assign({}, skills.liannu, { type: 'active', chance: 0 });
  const result = api.engine.runBattle({
    seed: 8,
    teams,
    skills,
    randomSequence: [0.1, 0.1, 0.5, 0.5, 0.5, 0.5],
    parameters: { maxRounds: 1, baseDamage: 1 }
  });
  const roundOneActions = result.events.filter((event) => event.kind === 'action' && event.round === 1).map((event) => event.actorId);
  assert.deepEqual(roundOneActions.slice(0, 3), ['han-ce', 'shi-kui', 'xu-ling']);
  const burnTick = result.events.find((event) => event.kind === 'periodicDamage' && event.status === '灼烧');
  assert.ok(burnTick);
  assert.equal(burnTick.targetId, 'shi-kui');
  assert.ok(result.events.some((event) => event.kind === 'damage' && event.actorId === 'xu-ling' && event.skill === '普通攻击'));
}

// 断言持续伤害在目标本轮行动前首次生效且不会被重复扣减时长。
function testPeriodicDamageTiming() {
  const teams = api.data.createSampleTeams().map((team) => Object.assign({}, team, {
    units: team.units.map((unit) => Object.assign({}, unit, { speed: 0 }))
  }));
  teams[0].units[0].speed = 120;
  teams[0].units[1].speed = 110;
  teams[0].units[2].speed = 100;
  teams[1].units[0].speed = 90;
  teams[1].units[1].speed = 80;
  teams[1].units[2].speed = 70;
  teams[1].units[0].troop = 700;
  const skills = createBasicOnlySkills();
  skills.juma = Object.assign({}, skills.juma, {
    type: 'active', chance: 1, multiplier: 0.01, control: null,
    status: { name: '灼烧', damagePerTick: 100, timing: 'beforeAction', duration: 2, durationType: 'actions', ticks: 2 }
  });
  skills.liuhuo = Object.assign({}, skills.liuhuo, { type: 'active', chance: 0 });
  skills.liannu = Object.assign({}, skills.liannu, { type: 'active', chance: 0 });
  const result = api.engine.runBattle({ seed: 12, teams, skills, parameters: { maxRounds: 1, baseDamage: 1 } });
  const applied = result.events.find((event) => event.kind === 'status' && event.status === '灼烧');
  const tick = result.events.find((event) => event.kind === 'periodicDamage' && event.status === '灼烧');
  assert.ok(applied);
  assert.ok(tick);
  assert.equal(tick.actorId, 'han-ce');
  assert.equal(tick.targetId, 'shi-kui');
  assert.equal(tick.round, 1);
  assert.equal(tick.amount, 100);
  const targetAttack = result.events.find((event) => event.kind === 'damage' && event.actorId === 'shi-kui' && event.skill === '普通攻击');
  assert.ok(targetAttack);
  const activeStatus = targetAttack.snapshot.find((unit) => unit.id === 'shi-kui').statuses.find((status) => status.name === '灼烧');
  assert.ok(activeStatus);
  assert.equal(activeStatus.remaining, 1);
  assert.equal(activeStatus.nextTick, 1);
}

// 断言攻击与绑定自损在同一原子内使双方主将倒下时判为平局。
function testAtomicSimultaneousGeneralDefeat() {
  const teams = api.data.createSampleTeams();
  teams[0].units[0].troop = 40;
  teams[1].units[0].troop = 40;
  teams[1].units[0].general = true;
  teams[1].units[1].general = false;
  const skills = createBasicOnlySkills();
  skills.juma = Object.assign({}, skills.juma, { type: 'active', chance: 1, multiplier: 10, control: null, onHitEffects: [{ type: 'selfDamage', amount: 40 }] });
  skills.liuhuo = Object.assign({}, skills.liuhuo, { type: 'active', chance: 0 });
  skills.liannu = Object.assign({}, skills.liannu, { type: 'active', chance: 0 });
  const result = api.engine.runBattle({ seed: 33, teams, skills });
  assert.equal(result.result.outcome, 'draw');
  assert.equal(result.result.reason, '双方主将在同一结算原子内倒下');
  assert.equal(result.events.at(-1).kind, 'result');
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
  testBeforeActionDefeatDoesNotSkipRound,
  testPeriodicDamageTiming,
  testAtomicSimultaneousGeneralDefeat,
  testSnapshotsAreBounded
].forEach((test) => {
  test();
  process.stdout.write('PASS ' + test.name + '\n');
});
