(function registerBattleRules(global) {
  var api = global.SanguoBattle || (global.SanguoBattle = {});
  var parameters = api.data.parameters;
  var positions = ['前锋', '中军', '后军'];
  var cycle = { shield: 'bow', bow: 'spear', spear: 'cavalry', cavalry: 'shield' };

  // 创建可复现的伪随机数生成器，并支持注入测试随机序列。
  function createRandom(seed, sequence) {
    var state = seed >>> 0;
    var index = 0;
    return function nextRandom() {
      if (sequence && index < sequence.length) return sequence[index++];
      state += 0x6D2B79F5;
      var value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 按站位稳定排序单位，使目标与同速规则共享顺序。
  function orderByPosition(units) {
    return units.slice().sort(function compareUnits(a, b) {
      return a.position - b.position || a.side - b.side;
    });
  }

  // 按速度、站位和进攻方优先级选择下一行动者。
  function orderActors(units) {
    return units.slice().sort(function compareActors(a, b) {
      return effectiveSpeed(b) - effectiveSpeed(a) || a.position - b.position || a.side - b.side;
    });
  }

  // 汇总速度修正，提供实时行动排序速度。
  function effectiveSpeed(unit) {
    return unit.speed + unit.statuses.filter(function isSlow(status) {
      return status.category === 'speed';
    }).reduce(function sumSpeed(total, status) { return total + status.value; }, 0);
  }

  // 根据技能目标模式返回合法且稳定排序的目标集合。
  function selectTargets(state, source, skill, random) {
    var enemies = orderByPosition(state.units.filter(function isEnemy(unit) {
      return unit.side !== source.side && unit.troop > 0;
    }));
    var allies = orderByPosition(state.units.filter(function isAlly(unit) {
      return unit.side === source.side && unit.troop > 0;
    }));
    if (skill.target === 'front') return enemies.length ? [enemies[0]] : [];
    if (skill.target === 'randomEnemy') return enemies.length ? [enemies[Math.floor(random() * enemies.length)]] : [];
    if (skill.target === 'lowestRatioAlly') {
      return allies.sort(function compareRatio(a, b) {
        return a.troop / a.maxTroop - b.troop / b.maxTroop || a.position - b.position;
      }).slice(0, 1);
    }
    if (skill.target === 'randomAlly') return allies.length ? [allies[Math.floor(random() * allies.length)]] : [];
    return enemies.length ? [enemies[0]] : [];
  }

  // 计算兵种循环克制系数。
  function classFactor(sourceType, targetType, activeParameters) {
    var values = Object.assign({}, parameters, activeParameters || {});
    if (cycle[sourceType] === targetType) return values.classAdvantage;
    if (cycle[targetType] === sourceType) return values.classDisadvantage;
    return 1;
  }

  // 依照设计公式计算伤害理论值及各乘区明细。
  function calculateDamage(source, target, skill, random, activeParameters) {
    var damageParameters = Object.assign({}, parameters, activeParameters || {});
    var attackAttribute = skill.damageType === 'tactical' ? source.intelligence : source.strength;
    var defenseAttribute = skill.damageType === 'tactical' ? target.intelligence : target.command;
    var attribute = Math.min(damageParameters.attributeFactorMax, Math.max(damageParameters.attributeFactorMin, 1 + (attackAttribute - defenseAttribute) / 1000));
    var troop = Math.min(1, Math.max(damageParameters.troopFactorMin, source.troop / source.maxTroop));
    var vulnerability = target.statuses.filter(function isVulnerability(status) {
      return status.category === 'damageTaken';
    }).reduce(function sum(total, status) { return total + status.value; }, 0);
    var mitigation = target.statuses.filter(function isMitigation(status) {
      return status.category === 'damageReduction';
    }).reduce(function sum(total, status) { return total + status.value; }, 0);
    var damageTaken = Math.max(0.2, 1 + Math.min(0.8, vulnerability) - Math.min(0.8, mitigation));
    var variance = damageParameters.damageVarianceMin + random() * (damageParameters.damageVarianceMax - damageParameters.damageVarianceMin);
    var classValue = classFactor(source.troopType, target.troopType, damageParameters);
    var raw = damageParameters.baseDamage * skill.multiplier * troop * attribute * classValue * damageTaken * variance;
    return {
      amount: Math.max(1, Math.floor(raw)),
      factors: { troop: troop, attribute: attribute, troopType: classValue, damageTaken: damageTaken, variance: variance }
    };
  }

  // 限定每个单位最多存在一个同名控制状态。
  function hasControl(unit, name) {
    return unit.statuses.some(function matches(status) {
      return status.control && status.name === name;
    });
  }

  // 以目标当前兵力比例和站位选择治疗对象。
  function lowestRatioAlly(units, side) {
    return orderByPosition(units.filter(function eligible(unit) {
      return unit.side === side && unit.troop > 0;
    })).sort(function compareRatio(a, b) {
      return a.troop / a.maxTroop - b.troop / b.maxTroop || a.position - b.position;
    })[0] || null;
  }

  api.rules = {
    positions: positions,
    createRandom: createRandom,
    orderByPosition: orderByPosition,
    orderActors: orderActors,
    effectiveSpeed: effectiveSpeed,
    selectTargets: selectTargets,
    classFactor: classFactor,
    calculateDamage: calculateDamage,
    hasControl: hasControl,
    lowestRatioAlly: lowestRatioAlly
  };
})(window);
