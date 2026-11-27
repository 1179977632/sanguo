(function registerBattleReplay(global) {
  var api = global.SanguoBattle || (global.SanguoBattle = {});
  var replay = { result: null, index: 0, timer: null, showDetails: false };
  var unitMetadata = Object.create(null);
  api.data.createSampleTeams().forEach(function cacheTeam(team) {
    team.units.forEach(function cacheUnit(unit) {
      unitMetadata[unit.id] = { name: unit.name, position: unit.position, general: unit.general };
    });
  });

  // 将概率转换为百分比文本。
  function formatPercent(value) {
    return Math.round(value * 100) + '%';
  }

  // 将数值保留两位小数，缺失时返回破折号。
  function formatDecimal(value) {
    return typeof value === 'number' && isFinite(value) ? value.toFixed(2) : '—';
  }

  // 将单位编号转换为武将名，未知编号回退原值。
  function unitName(id) {
    return unitMetadata[id] ? unitMetadata[id].name : id;
  }

  // 将状态计时方式转换为可读文本。
  function formatDuration(event) {
    if (!event.duration) return '直到来源倒下';
    return event.duration + (event.durationType === 'actions' ? ' 个行动轮次' : ' 回合');
  }

  // 将伤害类型转换为中文名称。
  function damageTypeName(type) {
    return type === 'tactical' ? '谋略' : '兵刃';
  }

  // 根据事件记录生成战法详细效果，没有可展开数据时返回空串。
  function buildDetail(event) {
    if (event.kind === 'skillCheck') {
      var skillTarget = event.targetId ? ' → ' + unitName(event.targetId) : '';
      return '战法「' + event.skill + '」发动检定' + skillTarget + '：概率 ' + formatPercent(event.chance) + ' · 掷值 ' + formatDecimal(event.roll) + ' → ' + (event.hit ? '成功' : '失败');
    }
    if (event.kind === 'hitCheck') {
      return '命中检定 · ' + unitName(event.targetId) + '：概率 ' + formatPercent(event.chance) + ' · 掷值 ' + (event.roll === null ? '必中' : formatDecimal(event.roll)) + ' → ' + (event.hit ? '命中' : '未命中');
    }
    if (event.kind === 'controlCheck') {
      return '控制检定 · ' + (event.status || '控制') + ' → ' + unitName(event.targetId) + '：概率 ' + formatPercent(event.chance) + ' · 掷值 ' + formatDecimal(event.roll) + ' → ' + (event.hit ? '施加成功' : '被抵抗');
    }
    if (event.kind === 'damage') {
      var factors = event.factors || {};
      return '伤害构成 · ' + event.skill + '（' + damageTypeName(event.damageType) + '）→ ' + unitName(event.targetId) + '：基础 ' + (event.baseDamage !== undefined ? event.baseDamage : '—') + ' × 倍率 ' + formatDecimal(event.multiplier) + ' × 兵力 ' + formatDecimal(factors.troop) + ' × 属性 ' + formatDecimal(factors.attribute) + ' × 兵种 ' + formatDecimal(factors.troopType) + ' × 增减伤 ' + formatDecimal(factors.damageTaken) + ' × 浮动 ' + formatDecimal(factors.variance) + ' = 理论 ' + event.theoreticalDamage + ' · 实际 ' + event.damage + '（' + event.before + ' → ' + event.after + '）' + (event.immune ? ' · 免疫该类伤害' : '');
    }
    if (event.kind === 'periodicDamage') {
      return '持续伤害 · ' + (event.status || '持续效果') + ' → ' + unitName(event.targetId) + '：固定快照 ' + (event.perTick !== undefined ? event.perTick : '—') + ' / 跳 · 本次实际 ' + event.amount + '（' + event.before + ' → ' + event.after + '）';
    }
    if (event.kind === 'periodicHeal') {
      var overflow = event.perTick !== undefined ? Math.max(0, event.perTick - event.amount) : '—';
      return '持续治疗 · ' + (event.status || '持续效果') + ' → ' + unitName(event.targetId) + '：固定快照 ' + (event.perTick !== undefined ? event.perTick : '—') + ' / 跳 · 本次实际 ' + event.amount + ' · 溢出 ' + overflow + '（' + event.before + ' → ' + event.after + '）';
    }
    if (event.kind === 'heal') {
      return '治疗 · ' + (event.skill || '治疗') + ' → ' + unitName(event.targetId) + '：理论 ' + event.theoreticalHealing + ' · 实际 ' + event.healing + ' · 溢出 ' + event.overflow + '（' + event.before + ' → ' + event.after + '）';
    }
    if (event.kind === 'status') {
      if (event.text && event.text.indexOf('重复施加失败') >= 0) return '同名控制已存在：本次不刷新时长、不叠加，也不消耗控制随机数。';
      if (event.text && event.text.indexOf('施加失败') >= 0) return '本次未创建状态实例，旧状态保持不变。';
      var parts = ['状态「' + event.status + '」' + (event.control ? '（控制）' : '（非控制）') + ' → ' + unitName(event.targetId)];
      if (event.duration !== undefined) parts.push('持续 ' + formatDuration(event));
      if (event.snapshotDamage !== undefined) parts.push('每跳固定伤害 ' + event.snapshotDamage + (event.ticks !== undefined ? ' · ' + event.ticks + ' 跳' : ''));
      if (event.snapshotHealing !== undefined) parts.push('每跳固定治疗 ' + event.snapshotHealing + (event.ticks !== undefined ? ' · ' + event.ticks + ' 跳' : ''));
      return parts.join(' · ');
    }
    if (event.kind === 'prepare') {
      if (event.text && event.text.indexOf('开始准备') >= 0) return '准备开始：占用本轮主动阶段，普攻机会保留；释放时再选目标。';
      if (event.text && event.text.indexOf('释放已完成准备') >= 0) return '准备释放：按当前合法目标与实时属性重新结算。';
    }
    return '';
  }

  // 按当前事件的单位快照渲染六名武将兵力与状态。
  function renderSnapshot(snapshot) {
    var root = document.getElementById('replay-roster');
    root.innerHTML = '';
    snapshot.forEach(function renderUnit(unit) {
      var data = unitMetadata[unit.id];
      var row = document.createElement('div');
      row.className = 'replay-unit' + (unit.alive ? '' : ' defeated');
      var position = data ? ['前锋', '中军', '后军'][data.position] : '';
      var statuses = (unit.statuses || []).map(function statusName(status) { return status.name; });
      if (unit.prepared) statuses.push('准备中');
      row.innerHTML = '<span>' + (position || '') + ' · ' + (data ? data.name : unit.id) + (data && data.general ? ' <b>主将</b>' : '') + '</span><strong>' + unit.troop + ' / ' + unit.maxTroop + '</strong><small>' + (statuses.length ? statuses.join('、') : '无状态') + '</small>';
      root.appendChild(row);
    });
  }

  // 绘制已播放的结构化战斗事件与当前回放进度。
  function renderReplay(preserveScroll) {
    var log = document.getElementById('battle-log');
    var previousScroll = log.scrollTop;
    var indicator = document.getElementById('round-indicator');
    var events = replay.result ? replay.result.events : [];
    log.innerHTML = '';
    if (!events.length) {
      indicator.textContent = '尚未运行';
      log.innerHTML = '<div class="muted small">输入随机种子并运行模拟，生成本场战斗记录。</div>';
      renderSnapshot(api.data.createSampleTeams().flatMap(function units(team, side) {
        return team.units.map(function unit(unitData) { return { id: unitData.id, troop: unitData.troop, maxTroop: unitData.maxTroop, alive: true, side: side, statuses: [] }; });
      }));
      return;
    }
    var visible = events.slice(0, replay.index);
    visible.forEach(function appendEvent(event) {
      var row = document.createElement('div');
      row.className = 'log-entry';
      var time = document.createElement('time');
      time.textContent = '回合 ' + event.round;
      var message = document.createElement('div');
      message.textContent = event.text;
      var detail = replay.showDetails ? buildDetail(event) : '';
      if (detail) {
        var detailElement = document.createElement('div');
        detailElement.className = 'log-detail';
        detailElement.innerHTML = detail;
        message.appendChild(detailElement);
      }
      row.appendChild(time);
      row.appendChild(message);
      log.appendChild(row);
    });
    log.scrollTop = preserveScroll ? previousScroll : log.scrollHeight;
    var event = replay.index ? events[replay.index - 1] : events[0];
    indicator.textContent = '回合 ' + event.round + ' / ' + replay.result.result.rounds + ' · ' + replay.index + ' / ' + events.length + ' 事件';
    renderSnapshot(event.snapshot);
  }

  // 根据战斗结果更新胜负、回合及主将兵力摘要。
  function renderResult() {
    var output = document.getElementById('battle-result');
    if (!replay.result) {
      output.textContent = '等待运行模拟';
      output.className = 'battle-result muted';
      return;
    }
    var result = replay.result.result;
    var sideName = result.winnerSide === 0 ? '青州军' : '山越军';
    var label = result.outcome === 'draw' ? '平局' : sideName + '获胜';
    var generals = replay.result.finalSnapshot.filter(function isGeneral(unit) {
      return unit.troop >= 0 && (unit.id === 'han-ce' || unit.id === 'lu-xiao');
    });
    var summary = generals.map(function general(unit) { return unit.name + ' ' + unit.troop + ' / ' + unit.maxTroop; }).join(' · ');
    output.textContent = label + ' · ' + result.reason + ' · ' + summary;
    output.className = 'battle-result ' + (result.outcome === 'draw' ? 'draw' : 'finished');
  }

  // 停止已有播放计时器，避免重复模拟时多重推进。
  function pauseReplay() {
    if (replay.timer !== null) global.clearInterval(replay.timer);
    replay.timer = null;
  }

  // 前进一步回放并在记录末尾停止计时器。
  function stepReplay() {
    if (!replay.result || replay.index >= replay.result.events.length) {
      pauseReplay();
      return;
    }
    replay.index += 1;
    renderReplay();
    if (replay.index >= replay.result.events.length) pauseReplay();
  }

  // 从随机种子运行新战斗并重置事件回放。
  function runSimulation() {
    pauseReplay();
    var seed = Number(document.getElementById('battle-seed').value);
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) {
      document.getElementById('battle-result').textContent = '请输入 0 到 4294967295 之间的整数种子。';
      document.getElementById('battle-result').className = 'battle-result error';
      return;
    }
    replay.result = api.engine.runBattle({ seed: seed });
    replay.index = 0;
    renderResult();
    renderReplay();
  }

  // 开始定时播放当前模拟结果。
  function playReplay() {
    if (!replay.result) runSimulation();
    if (!replay.result) return;
    if (replay.index >= replay.result.events.length) replay.index = 0;
    pauseReplay();
    replay.timer = global.setInterval(stepReplay, 550);
  }

  // 将当前事件索引归零并显示初始编队状态。
  function resetReplay() {
    pauseReplay();
    replay.index = 0;
    renderReplay();
  }

  // 绑定模拟、回放操作与战法详情开关并初始化样例状态。
  function init() {
    document.getElementById('run-battle').addEventListener('click', runSimulation);
    document.getElementById('play').addEventListener('click', playReplay);
    document.getElementById('pause').addEventListener('click', pauseReplay);
    document.getElementById('step').addEventListener('click', stepReplay);
    document.getElementById('reset').addEventListener('click', resetReplay);
    var detailToggle = document.getElementById('battle-detail-toggle');
    replay.showDetails = detailToggle.checked;
    document.getElementById('battle-log').classList.toggle('detailed', replay.showDetails);
    detailToggle.addEventListener('change', function toggleDetails() {
      replay.showDetails = detailToggle.checked;
      document.getElementById('battle-log').classList.toggle('detailed', replay.showDetails);
      renderReplay(true);
    });
    document.getElementById('battle-seed').addEventListener('keydown', function runOnEnter(event) {
      if (event.key === 'Enter') runSimulation();
    });
    renderResult();
    renderReplay();
  }

  api.replay = { init: init, run: runSimulation, pause: pauseReplay, step: stepReplay, reset: resetReplay };
})(window);
