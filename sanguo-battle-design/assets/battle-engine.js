(function registerBattleEngine(global) {
  var api = global.SanguoBattle || (global.SanguoBattle = {});
  var rules = api.rules;

  // 校验双方编队并创建隔离的运行时战斗状态。
  function createBattle(options) {
    var teams = options.teams || api.data.createSampleTeams();
    if (teams.length !== 2 || teams.some(function invalidTeam(team) {
      return team.units.length !== 3 || team.units.some(function invalidPosition(unit, index) { return unit.position !== index; }) || team.units.filter(function isGeneral(unit) { return unit.general; }).length !== 1;
    })) throw new Error('每方须按前锋、中军、后军配置三名武将且恰有一名主将');
    var units = [];
    teams.forEach(function addTeam(team, side) {
      team.units.forEach(function copyUnit(unit) {
        units.push(Object.assign({}, unit, { side: side, teamName: team.name, statuses: [], actionCount: 0, prepared: null, alive: unit.troop > 0 }));
      });
    });
    return {
      version: api.data.version,
      seed: options.seed >>> 0,
      round: 0,
      phase: 'initializing',
      currentActorId: null,
      currentStage: 'none',
      actedThisRound: new Set(),
      units: units,
      skills: options.skills || api.data.skills,
      random: rules.createRandom(options.seed, options.randomSequence),
      events: [],
      result: null,
      parameters: Object.assign({}, api.data.parameters, options.parameters || {})
    };
  }

  // 创建本事件对应的只读快照。
  function createSnapshot(state) {
    return state.units.map(function copyUnit(unit) {
      return { id: unit.id, troop: unit.troop, maxTroop: unit.maxTroop, alive: unit.troop > 0, statuses: unit.statuses.map(function copyStatus(status) { return Object.assign({}, status); }), prepared: unit.prepared ? Object.assign({}, unit.prepared) : null };
    });
  }

  // 记录带有发生后战场快照的结构化事件。
  function record(state, event) {
    state.events.push(Object.assign({ index: state.events.length + 1, round: state.round, phase: state.phase, snapshot: createSnapshot(state) }, event));
  }

  // 取消准备状态并记录取消原因。
  function cancelPreparation(state, unit, reason) {
    if (!unit.prepared) return;
    var skillId = unit.prepared.skillId;
    unit.prepared = null;
    record(state, { kind: 'prepare', actorId: unit.id, skill: skillId, text: unit.name + reason });
  }

  // 根据目标本轮行动进度计算持续效果最早触发回合。
  function firstDueActionRound(state, target, definition) {
    var dueRound = state.round;
    var timingPassed = false;
    if (definition.timing) {
      if (target.id === state.currentActorId) {
        timingPassed = definition.timing === 'beforeAction'
          ? state.currentStage !== 'beforeAction'
          : state.currentStage === 'afterAction' || state.currentStage === 'roundEnd';
      } else timingPassed = state.actedThisRound.has(target.id);
    } else timingPassed = state.actedThisRound.has(target.id) && (target.id !== state.currentActorId || state.currentStage !== 'beforeAction');
    return timingPassed ? dueRound + 1 : dueRound;
  }

  // 将单位置为倒下并清除其准备、状态及所持有的指挥效果。
  function defeatUnit(state, unit) {
    unit.troop = 0;
    unit.alive = false;
    cancelPreparation(state, unit, '倒下，取消尚未释放的准备战法。');
    clearCommandEffects(state, unit);
    unit.statuses = [];
  }

  // 清理由已倒下指挥来源创建的所有存续状态。
  function clearCommandEffects(state, source) {
    state.units.forEach(function cleanTarget(target) {
      var removed = target.statuses.filter(function fromCommand(status) { return status.sourceId === source.id && status.sourceType === 'command'; });
      if (!removed.length) return;
      target.statuses = target.statuses.filter(function keep(status) { return !(status.sourceId === source.id && status.sourceType === 'command'); });
      removed.forEach(function recordRemoval(status) {
        record(state, { kind: 'status', actorId: source.id, targetId: target.id, status: status.name, text: source.name + '倒下，其指挥效果「' + status.name + '」从' + target.name + '身上移除。' });
      });
    });
  }

  // 在一个效果原子完成后判定主将胜负并清除未完成准备。
  function checkResult(state) {
    var generals = state.units.filter(function isGeneral(unit) { return unit.general; });
    var fallen = generals.filter(function isFallen(unit) { return unit.troop <= 0; });
    if (!fallen.length) return false;
    state.result = fallen.length === 2
      ? { outcome: 'draw', reason: '双方主将在同一结算原子内倒下' }
      : { outcome: fallen[0].side === 0 ? 'defeat' : 'victory', winnerSide: 1 - fallen[0].side, reason: fallen[0].name + '主将倒下' };
    state.phase = 'finished';
    state.units.forEach(function cancelPendingPreparation(unit) {
      cancelPreparation(state, unit, '因战斗结束取消尚未释放的准备战法。');
    });
    record(state, { kind: 'result', actorId: null, text: state.result.outcome === 'draw' ? '双方主将同一原子内倒下，战斗平局。' : state.units.filter(function survived(unit) { return unit.general && unit.troop > 0; })[0].name + '主将存活，战斗结束。' });
    return true;
  }

  // 按来源与状态种类应用状态并处理覆盖或重复控制。
  function applyStatus(state, source, target, definition, skill) {
    if (!target || target.troop <= 0) return false;
    if (definition.control && rules.hasControl(target, definition.name)) {
      record(state, { kind: 'status', actorId: source.id, targetId: target.id, status: definition.name, text: target.name + '已有' + definition.name + '，重复施加失败且不刷新时长。' });
      return false;
    }
    var firstActionRound = firstDueActionRound(state, target, definition);
    var status = Object.assign({}, definition, {
      sourceId: source.id,
      sourceSkill: skill.id,
      sourceType: skill.type,
      appliedRound: state.round,
      remaining: definition.duration,
      control: Boolean(definition.control),
      firstActionRound: firstActionRound,
      nextTick: 0,
      ticks: definition.ticks || definition.duration
    });
    if (definition.damagePerTick !== undefined) status.damagePerTick = definition.damagePerTick;
    if (definition.healPerTick !== undefined) status.healPerTick = definition.healPerTick;
    if (definition.damageSnapshot) status.damagePerTick = Math.floor(rules.calculateDamage(source, target, { damageType: definition.damageType || skill.damageType, multiplier: definition.multiplier || skill.multiplier }, state.random, state.parameters).amount);
    if (definition.healRatio !== undefined) status.healPerTick = Math.floor(target.maxTroop * definition.healRatio);
    var duplicateIndex = target.statuses.findIndex(function sameSourceSkill(existing) {
      return !definition.control && existing.name === definition.name && existing.sourceId === source.id && existing.sourceSkill === skill.id;
    });
    if (duplicateIndex >= 0) target.statuses.splice(duplicateIndex, 1);
    target.statuses.push(status);
    record(state, { kind: 'status', actorId: source.id, targetId: target.id, status: definition.name, snapshotDamage: status.damagePerTick, snapshotHealing: status.healPerTick, text: source.name + '对' + target.name + '施加' + definition.name + (status.damagePerTick !== undefined ? '，每跳固定伤害 ' + status.damagePerTick : '') + (status.healPerTick !== undefined ? '，每跳固定治疗 ' + status.healPerTick : '') + '。' });
    return true;
  }

  // 执行攻击命中判定并返回是否命中及伤害结果。
  function resolveAttack(state, source, target, skill, label) {
    if (!target || target.troop <= 0 || state.result) return { hit: false, ended: false, damage: 0 };
    var hitChance = Math.max(0.05, Math.min(1, 1 + (source.hit || 0) - (target.evasion || 0)));
    var hitRoll = hitChance < 1 ? state.random() : null;
    var hit = hitRoll === null || hitRoll < hitChance;
    record(state, { kind: 'hitCheck', actorId: source.id, targetId: target.id, skill: label, chance: hitChance, roll: hitRoll, hit: hit, text: hit ? source.name + '命中' + target.name + '。' : source.name + '未命中' + target.name + '。' });
    if (!hit) return { hit: false, ended: false, damage: 0 };
    var before = target.troop;
    var immune = Array.isArray(target.damageImmunity) && target.damageImmunity.indexOf(skill.damageType) >= 0;
    var calculation = rules.calculateDamage(source, target, skill, state.random, state.parameters);
    var dealt = immune ? 0 : Math.min(before, calculation.amount);
    target.troop -= dealt;
    if (target.troop <= 0) defeatUnit(state, target);
    record(state, { kind: 'damage', actorId: source.id, targetId: target.id, skill: label, damage: dealt, theoreticalDamage: calculation.amount, before: before, after: target.troop, factors: calculation.factors, immune: immune, text: immune ? target.name + '免疫该类伤害。' : source.name + '发动「' + label + '」，对' + target.name + '造成' + dealt + '兵力伤害（' + before + ' → ' + target.troop + '）。' });
    return { hit: true, ended: false, damage: dealt, before: before, after: target.troop };
  }

  // 结算攻击及其绑定的吸血、自损或反伤子效果后统一检查胜负。
  function resolveAtomicAttack(state, source, target, skill, label, hitEffects) {
    var attack = resolveAttack(state, source, target, skill, label);
    if (!attack.hit) return attack;
    (hitEffects || []).forEach(function applyBoundEffect(effect) {
      var recipient = effect.targetId ? state.units.find(function findUnit(unit) { return unit.id === effect.targetId; }) : source;
      if (!recipient || recipient.troop <= 0) return;
      var before = recipient.troop;
      var amount = effect.amount;
      if (effect.type === 'lifesteal') {
        amount = Math.floor(attack.damage * effect.ratio);
        recipient.troop = Math.min(recipient.maxTroop, recipient.troop + amount);
      } else if (effect.type === 'heal') recipient.troop = Math.min(recipient.maxTroop, recipient.troop + amount);
      else if (effect.type === 'damage' || effect.type === 'selfDamage' || effect.type === 'reflect') recipient.troop = Math.max(0, recipient.troop - amount);
      if (recipient.troop === 0 && before > 0) defeatUnit(state, recipient);
      record(state, { kind: effect.type, actorId: source.id, targetId: recipient.id, amount: amount, before: before, after: recipient.troop, text: '绑定效果使' + recipient.name + '兵力 ' + before + ' → ' + recipient.troop + '。' });
    });
    attack.ended = checkResult(state);
    return attack;
  }

  // 按成功命中的技能效果顺序施加状态或持续效果。
  function resolveHitEffects(state, source, target, skill) {
    if (state.result || target.troop <= 0) return;
    if (skill.status) applyStatus(state, source, target, skill.status, skill);
    if (!skill.control) return;
    if (rules.hasControl(target, skill.control.name)) {
      record(state, { kind: 'status', actorId: source.id, targetId: target.id, status: skill.control.name, text: target.name + '已有' + skill.control.name + '，本次控制施加失败。' });
      return;
    }
    var chance = Math.max(state.parameters.controlChanceMin, Math.min(state.parameters.controlChanceMax, skill.control.chance + (source.statusHit || 0) - (target.statusResistance || 0)));
    var roll = state.random();
    var hit = roll < chance;
    record(state, { kind: 'controlCheck', actorId: source.id, targetId: target.id, chance: chance, roll: roll, hit: hit, text: skill.control.name + '命中率 ' + Math.round(chance * 100) + '%，' + (hit ? '施加成功。' : '被抵抗。') });
    if (hit) applyStatus(state, source, target, Object.assign({ control: true, category: 'control' }, skill.control), skill);
  }

  // 释放主动战法时选择合法目标并执行命中、伤害和后续状态。
  function releaseActive(state, source, skill, prepared) {
    var targets = rules.selectTargets(state, source, skill, state.random);
    if (!targets.length) {
      if (prepared) record(state, { kind: 'prepare', actorId: source.id, skill: skill.id, text: source.name + '的「' + skill.name + '」释放时没有合法目标，准备取消。' });
      record(state, { kind: 'skill', actorId: source.id, skill: skill.name, text: source.name + '的「' + skill.name + '」释放时没有合法目标，战法取消。' });
      return;
    }
    var target = targets[0];
    if (prepared) record(state, { kind: 'prepare', actorId: source.id, skill: skill.id, text: source.name + '释放已完成准备的「' + skill.name + '」。' });
    var attack = resolveAtomicAttack(state, source, target, skill, skill.name, skill.onHitEffects);
    if (attack.hit && !state.result) resolveHitEffects(state, source, target, skill);
  }

  // 检查技能是否存在任意合法目标而不提前抽取随机目标。
  function hasLegalTarget(state, source, skill) {
    if (skill.target === 'randomAlly' || skill.target === 'lowestRatioAlly') return state.units.some(function ally(unit) { return unit.side === source.side && unit.troop > 0; });
    return state.units.some(function enemy(unit) { return unit.side !== source.side && unit.troop > 0; });
  }

  // 处理主动阶段的控制、准备进度和技能发动检定。
  function resolveActive(state, actor) {
    var fear = actor.statuses.some(function isFear(status) { return status.name === '震慑'; });
    var seal = actor.statuses.some(function isSeal(status) { return status.name === '封印'; });
    if (fear) {
      record(state, { kind: 'control', actorId: actor.id, text: actor.name + '受到震慑，跳过主动与普攻。' });
      return { skipBasic: true };
    }
    if (seal) {
      record(state, { kind: 'control', actorId: actor.id, text: actor.name + '受到封印，主动阶段跳过且准备暂停。' });
      return { skipBasic: false };
    }
    if (actor.prepared) {
      var pending = actor.prepared;
      var preparedSkill = state.skills[pending.skillId];
      if (pending.remaining > 1) {
        pending.remaining -= 1;
        record(state, { kind: 'prepare', actorId: actor.id, skill: pending.skillId, text: actor.name + '继续准备「' + preparedSkill.name + '」。' });
      } else {
        actor.prepared = null;
        releaseActive(state, actor, preparedSkill, true);
      }
      return { skipBasic: false };
    }
    if (actor.statuses.some(function isSilenced(status) { return status.name === '沉默'; })) {
      record(state, { kind: 'control', actorId: actor.id, text: actor.name + '受到沉默，不能检定新的主动战法。' });
      return { skipBasic: false };
    }
    var skills = actor.skills.map(function getSkill(id) { return state.skills[id]; }).filter(function active(skill) { return skill && skill.type === 'active'; });
    for (var i = 0; i < skills.length; i += 1) {
      var skill = skills[i];
      if (!hasLegalTarget(state, actor, skill)) {
        record(state, { kind: 'skill', actorId: actor.id, skill: skill.name, text: '「' + skill.name + '」没有合法目标，跳过发动检定。' });
        continue;
      }
      var roll = state.random();
      if (roll >= skill.chance) {
        record(state, { kind: 'skillCheck', actorId: actor.id, skill: skill.name, chance: skill.chance, roll: roll, hit: false, text: actor.name + '发动「' + skill.name + '」失败。' });
        continue;
      }
      record(state, { kind: 'skillCheck', actorId: actor.id, skill: skill.name, chance: skill.chance, roll: roll, hit: true, text: actor.name + '发动「' + skill.name + '」成功。' });
      if (skill.prepare) {
        actor.prepared = { skillId: skill.id, remaining: skill.prepare };
        record(state, { kind: 'prepare', actorId: actor.id, skill: skill.id, text: actor.name + '开始准备「' + skill.name + '」，本轮仍保留普攻。' });
      } else releaseActive(state, actor, skill, false);
      break;
    }
    return { skipBasic: false };
  }

  // 结算持续伤害或治疗的一个固定快照跳数。
  function resolvePeriodicEffect(state, target, status) {
    var source = state.units.find(function findSource(unit) { return unit.id === status.sourceId; }) || { id: status.sourceId, name: '已倒下来源' };
    if (status.damagePerTick !== undefined) {
      var beforeDamage = target.troop;
      var damage = Math.min(beforeDamage, status.damagePerTick);
      target.troop -= damage;
      if (target.troop <= 0) defeatUnit(state, target);
      record(state, { kind: 'periodicDamage', actorId: source.id, targetId: target.id, status: status.name, amount: damage, before: beforeDamage, after: target.troop, text: target.name + '受到「' + status.name + '」持续伤害 ' + damage + '（' + beforeDamage + ' → ' + target.troop + '）。' });
      if (checkResult(state)) return;
    } else if (status.healPerTick !== undefined && target.troop > 0) {
      var beforeHeal = target.troop;
      var healing = Math.min(target.maxTroop - target.troop, status.healPerTick);
      target.troop += healing;
      record(state, { kind: 'periodicHeal', actorId: source.id, targetId: target.id, status: status.name, amount: healing, before: beforeHeal, after: target.troop, text: target.name + '受到「' + status.name + '」持续治疗 ' + healing + '（' + beforeHeal + ' → ' + target.troop + '）。' });
    }
    status.nextTick += 1;
    status.remaining -= 1;
  }

  // 处理目标行动前或行动后的固定持续效果。
  function triggerPeriodic(state, target, timing) {
    var effects = target.statuses.filter(function due(status) {
      return (status.timing === timing) && (status.damagePerTick !== undefined || status.healPerTick !== undefined) && status.firstActionRound <= state.round && status.nextTick < status.ticks;
    });
    effects.forEach(function tick(status) {
      if (!state.result && target.troop > 0) resolvePeriodicEffect(state, target, status);
    });
    target.statuses = target.statuses.filter(function keep(status) {
      return status.remaining > 0 && status.nextTick < status.ticks;
    });
  }

  // 根据技能命中后效果为持续状态创建施加时数值快照。
  function resolveStatusSnapshots(state, source, target, skill) {
    if (skill.status && (skill.status.damageSnapshot || skill.status.damagePerTick !== undefined || skill.status.healRatio !== undefined || skill.status.healPerTick !== undefined)) applyStatus(state, source, target, skill.status, skill);
    if (skill.control) resolveHitEffects(state, source, target, Object.assign({}, skill, { status: null }));
  }

  // 结算普攻以及按配置顺序最多一次的命中追击。
  function resolveBasic(state, actor) {
    if (actor.statuses.some(function disarmed(status) { return status.name === '缴械'; })) {
      record(state, { kind: 'control', actorId: actor.id, text: actor.name + '受到缴械，跳过普攻。' });
      return;
    }
    var targets = rules.orderByPosition(state.units.filter(function enemy(unit) { return unit.side !== actor.side && unit.troop > 0; }));
    var target = targets[0];
    if (!target) return;
    var passive = actor.skills.map(function getSkill(id) { return state.skills[id]; }).find(function empowered(skill) { return skill && skill.basicMultiplier; });
    var basic = { id: 'basic', name: '普通攻击', type: 'basic', damageType: 'physical', multiplier: passive ? passive.basicMultiplier : 1 };
    var outcome = resolveAtomicAttack(state, actor, target, basic, '普通攻击', basic.onHitEffects);
    if (outcome.ended || state.result || !outcome.hit) return;
    var chase = actor.skills.map(function getSkill(id) { return state.skills[id]; }).find(function isChase(skill) { return skill && skill.type === 'chase'; });
    if (!chase) return;
    var roll = state.random();
    if (roll >= chase.chance) {
      record(state, { kind: 'skillCheck', actorId: actor.id, targetId: target.id, skill: chase.name, chance: chase.chance, roll: roll, hit: false, text: '普攻命中后「' + chase.name + '」追击失败。' });
      return;
    }
    record(state, { kind: 'skillCheck', actorId: actor.id, targetId: target.id, skill: chase.name, chance: chase.chance, roll: roll, hit: true, text: '普攻命中后「' + chase.name + '」追击成功。' });
    var chaseResult = resolveAtomicAttack(state, actor, target, chase, chase.name, chase.onHitEffects);
    if (chaseResult.hit && !state.result) resolveStatusSnapshots(state, actor, target, chase);
  }

  // 按速度、站位及技能顺序逐个结算回合末效果。
  function resolveRoundEnd(state) {
    var sources = rules.orderActors(state.units.filter(function alive(unit) { return unit.troop > 0; }));
    for (var i = 0; i < sources.length && !state.result; i += 1) {
      var source = sources[i];
      var skills = source.skills.map(function getSkill(id) { return state.skills[id]; }).filter(function roundEnd(skill) { return skill && skill.trigger === 'roundEnd'; });
      for (var j = 0; j < skills.length && !state.result; j += 1) {
        var skill = skills[j];
        var target = rules.lowestRatioAlly(state.units, source.side);
        if (!target) continue;
        var theoretical = Math.floor(target.maxTroop * skill.healRatio);
        var before = target.troop;
        var healing = Math.min(target.maxTroop - target.troop, theoretical);
        target.troop += healing;
        record(state, { kind: 'heal', actorId: source.id, targetId: target.id, skill: skill.name, healing: healing, theoreticalHealing: theoretical, overflow: theoretical - healing, before: before, after: target.troop, text: source.name + '的「' + skill.name + '」治疗' + target.name + '，恢复' + healing + '兵力（' + before + ' → ' + target.troop + '）。' });
        if (skill.onHitEffects && checkResult(state)) break;
      }
    }
  }

  // 执行一场最多八回合的自动战斗并返回确定性事件记录。
  function runBattle(options) {
    var state = createBattle(options || {});
    record(state, { kind: 'start', actorId: null, text: '战斗开始，随机种子 ' + state.seed + '。' });
    state.units.forEach(function applyOpeningPassives(unit) {
      unit.skills.forEach(function applyOpening(id) {
        var skill = state.skills[id];
        if (skill && skill.type === 'passive' && skill.basicMultiplier) record(state, { kind: 'passive', actorId: unit.id, skill: skill.name, text: unit.name + '的被动「' + skill.name + '」生效。' });
      });
    });
    for (var round = 1; round <= state.parameters.maxRounds && !state.result; round += 1) {
      state.round = round;
      state.phase = 'roundStart';
      state.actedThisRound = new Set();
      record(state, { kind: 'round', actorId: null, text: '第' + round + '回合开始。' });
      while (!state.result) {
        var candidates = rules.orderActors(state.units.filter(function ready(unit) { return unit.troop > 0 && !state.actedThisRound.has(unit.id); }));
        if (!candidates.length) break;
        var actor = candidates[0];
        state.actedThisRound.add(actor.id);
        state.currentActorId = actor.id;
        state.phase = 'action';
        state.currentStage = 'beforeAction';
        record(state, { kind: 'action', actorId: actor.id, text: actor.name + '开始行动。' });
        triggerPeriodic(state, actor, 'beforeAction');
        if (!state.result && actor.troop > 0) {
          state.currentStage = 'active';
          var outcome = resolveActive(state, actor);
          state.currentStage = 'basic';
          if (!state.result && !outcome.skipBasic && actor.troop > 0 && !actor.statuses.some(function feared(status) { return status.name === '震慑'; })) resolveBasic(state, actor);
          state.currentStage = 'afterAction';
          if (!state.result && actor.troop > 0) triggerPeriodic(state, actor, 'afterAction');
          if (actor.troop > 0) actor.actionCount += 1;
          actor.statuses.forEach(function tickActionStatus(status) {
            if (status.durationType === 'actions' && status.firstActionRound <= state.round) status.remaining -= 1;
          });
          actor.statuses = actor.statuses.filter(function keepStatus(status) { return status.remaining > 0 && (status.nextTick === undefined || status.nextTick < status.ticks); });
        }
        state.currentActorId = null;
        state.currentStage = 'none';
      }
      if (state.result) break;
      state.phase = 'roundEnd';
      record(state, { kind: 'roundEnd', actorId: null, text: '第' + round + '回合行动结束，开始回合末效果队列。' });
      resolveRoundEnd(state);
      if (state.result) break;
      state.units.forEach(function tickRound(unit) {
        unit.statuses.forEach(function tickStatus(status) { if (status.durationType === 'rounds' && round > status.appliedRound) status.remaining -= 1; });
        unit.statuses = unit.statuses.filter(function keepStatus(status) { return status.remaining > 0 && (status.nextTick === undefined || status.nextTick < status.ticks); });
      });
      if (round === state.parameters.maxRounds) {
        state.result = { outcome: 'draw', reason: state.parameters.maxRounds + '回合结束双方主将仍存活' };
        state.phase = 'finished';
        state.units.forEach(function cancelPendingPreparation(unit) {
          cancelPreparation(state, unit, '因战斗结束取消尚未释放的准备战法。');
        });
        record(state, { kind: 'result', actorId: null, text: state.result.reason + '，战斗平局。' });
      }
    }
    state.currentActorId = null;
    state.result.rounds = state.round;
    return {
      version: state.version,
      seed: state.seed,
      parameters: state.parameters,
      initialSnapshot: state.events[0].snapshot,
      events: state.events,
      finalSnapshot: state.units.map(function finalUnit(unit) { return { id: unit.id, name: unit.name, side: unit.side, general: unit.general, troop: unit.troop, maxTroop: unit.maxTroop }; }),
      result: state.result
    };
  }

  api.engine = { runBattle: runBattle, createBattle: createBattle, applyStatus: applyStatus, checkResult: checkResult, resolveAtomicAttack: resolveAtomicAttack };
})(window);
