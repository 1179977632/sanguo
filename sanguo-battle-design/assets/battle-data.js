(function registerBattleData(global) {
  var api = global.SanguoBattle || (global.SanguoBattle = {});

  // 返回原型采用的六名武将及其站位、属性和战法配置。
  function createSampleTeams() {
    return [
      {
        id: 'qingzhou',
        name: '青州军',
        side: 0,
        units: [
          { id: 'han-ce', name: '韩策', position: 0, general: true, troop: 1000, maxTroop: 1000, speed: 120, strength: 150, intelligence: 150, command: 150, troopType: 'shield', skills: ['juma'] },
          { id: 'xu-ling', name: '许翎', position: 1, general: false, troop: 920, maxTroop: 1000, speed: 100, strength: 150, intelligence: 150, command: 150, troopType: 'bow', skills: ['liuhuo'] },
          { id: 'tang-ce', name: '唐策', position: 2, general: false, troop: 880, maxTroop: 1000, speed: 80, strength: 150, intelligence: 150, command: 150, troopType: 'cavalry', skills: ['taizhen'] }
        ]
      },
      {
        id: 'shanyue',
        name: '山越军',
        side: 1,
        units: [
          { id: 'shi-kui', name: '石魁', position: 0, general: false, troop: 980, maxTroop: 1000, speed: 110, strength: 150, intelligence: 150, command: 150, troopType: 'spear', skills: ['hanyong'] },
          { id: 'lu-xiao', name: '陆骁', position: 1, general: true, troop: 1000, maxTroop: 1000, speed: 90, strength: 150, intelligence: 150, command: 150, troopType: 'bow', skills: ['liannu'] },
          { id: 'mei-heng', name: '梅蘅', position: 2, general: false, troop: 900, maxTroop: 1000, speed: 70, strength: 150, intelligence: 150, command: 150, troopType: 'shield', skills: ['huichun'] }
        ]
      }
    ];
  }

  api.data = {
    version: '0.5',
    parameters: {
      maxRounds: 8,
      baseDamage: 100,
      troopFactorMin: 0.3,
      attributeFactorMin: 0.5,
      attributeFactorMax: 1.5,
      damageVarianceMin: 0.95,
      damageVarianceMax: 1.05,
      controlChanceMin: 0.05,
      controlChanceMax: 0.95,
      classAdvantage: 1.1,
      classDisadvantage: 0.9
    },
    skills: {
      juma: { id: 'juma', name: '拒马阵', type: 'active', chance: 0.45, target: 'front', damageType: 'physical', multiplier: 1.2, control: { name: '缴械', chance: 0.45, duration: 1, durationType: 'actions' } },
      liuhuo: { id: 'liuhuo', name: '流火计', type: 'active', chance: 0.5, target: 'randomEnemy', damageType: 'tactical', multiplier: 1.4, status: { name: '易伤', category: 'damageTaken', value: 0.1, duration: 1, durationType: 'rounds' } },
      taizhen: { id: 'taizhen', name: '踏阵', type: 'chase', chance: 0.35, damageType: 'physical', multiplier: 0.6 },
      hanyong: { id: 'hanyong', name: '悍勇', type: 'passive', basicMultiplier: 1.15 },
      liannu: { id: 'liannu', name: '连弩齐射', type: 'active', chance: 0.35, prepare: 1, target: 'randomEnemy', damageType: 'physical', multiplier: 2.2 },
      huichun: { id: 'huichun', name: '回春', type: 'passive', trigger: 'roundEnd', healRatio: 0.1, target: 'lowestRatioAlly' }
    },
    createSampleTeams: createSampleTeams
  };
})(window);
