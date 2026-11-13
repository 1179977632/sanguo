(function registerBattleReplay(global) {
  var api = global.SanguoBattle || (global.SanguoBattle = {});
  var replay = { result: null, index: 0, timer: null };
  var unitMetadata = Object.create(null);
  api.data.createSampleTeams().forEach(function cacheTeam(team) {
    team.units.forEach(function cacheUnit(unit) {
      unitMetadata[unit.id] = { name: unit.name, position: unit.position, general: unit.general };
    });
  });

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
  function renderReplay() {
    var log = document.getElementById('battle-log');
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
      row.appendChild(time);
      row.appendChild(message);
      log.appendChild(row);
    });
    log.scrollTop = log.scrollHeight;
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

  // 绑定模拟和回放操作并初始化样例状态。
  function init() {
    document.getElementById('run-battle').addEventListener('click', runSimulation);
    document.getElementById('play').addEventListener('click', playReplay);
    document.getElementById('pause').addEventListener('click', pauseReplay);
    document.getElementById('step').addEventListener('click', stepReplay);
    document.getElementById('reset').addEventListener('click', resetReplay);
    document.getElementById('battle-seed').addEventListener('keydown', function runOnEnter(event) {
      if (event.key === 'Enter') runSimulation();
    });
    renderResult();
    renderReplay();
  }

  api.replay = { init: init, run: runSimulation, pause: pauseReplay, step: stepReplay, reset: resetReplay };
})(window);
