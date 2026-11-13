// 初始化页面内的流程图，并保持使用本地资源的安全渲染配置。
function initBattleDesignDiagrams() {
  mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'strict' });
}

// 切换设计演示标签页，同时维护键盘和无障碍选中状态。
function initDesignTabs() {
  var tabs = Array.from(document.querySelectorAll('.tab'));
  tabs.forEach(function(tab, index) {
    // 响应鼠标选择并激活对应内容面板。
    tab.addEventListener('click', function handleTabClick() { activateTab(tab); });
    // 支持左右方向键在标签之间循环切换。
    tab.addEventListener('keydown', function handleTabKeydown(event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      var delta = event.key === 'ArrowRight' ? 1 : -1;
      var next = tabs[(index + delta + tabs.length) % tabs.length];
      activateTab(next);
      next.focus();
    });
  });

  // 更新选中的标签、内容区和无障碍状态。
  function activateTab(activeTab) {
    // 同步标签选中状态与对应面板可见性。
    tabs.forEach(function updateTab(tab) {
      var selected = tab === activeTab;
      tab.setAttribute('aria-selected', String(selected));
      document.getElementById(tab.getAttribute('aria-controls')).classList.toggle('hidden', !selected);
    });
    if (activeTab.id === 'tab-balance') renderTroopChart();
  }
}

// 在图表提示框中说明提案曲线的数据含义。
function formatTroopTooltip(items) {
  return items[0].axisValue + '% 兵力<br>建议伤害系数：' + items[0].data.toFixed(2);
}

// 处理窗口尺寸变化，保持兵力曲线在响应式布局下可读。
function resizeTroopChart() {
  var chartElement = document.getElementById('troop-chart');
  if (chartElement && chartElement.chartInstance) chartElement.chartInstance.resize();
}

// 绘制用于讨论的兵力系数示意图，不将提案曲线描述为实测数据。
function renderTroopChart() {
  var element = document.getElementById('troop-chart');
  if (element.dataset.rendered) return;
  var style = getComputedStyle(document.documentElement);
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var accent = style.getPropertyValue('--accent').trim();
  var chart = echarts.init(element, null, { renderer: 'svg' });
  chart.setOption({
    animation: false,
    tooltip: { trigger: 'axis', appendToBody: true, formatter: formatTroopTooltip },
    grid: { left: 48, right: 22, top: 24, bottom: 38 },
    xAxis: { type: 'category', name: '剩余兵力比例', data: ['30','40','50','60','70','80','90','100'], axisLine: { lineStyle: { color: rule } }, axisLabel: { color: muted }, nameTextStyle: { color: muted } },
    yAxis: { type: 'value', name: '伤害系数', min: 0.2, max: 1, interval: 0.2, axisLabel: { color: muted }, splitLine: { lineStyle: { color: rule } }, nameTextStyle: { color: muted } },
    series: [{ type: 'line', name: '提案曲线', data: [0.3,0.4,0.5,0.6,0.7,0.8,0.9,1], smooth: false, symbolSize: 7, lineStyle: { color: accent, width: 3 }, itemStyle: { color: accent }, areaStyle: { color: accent, opacity: 0.09 } }],
    textStyle: { color: ink }
  });
  element.chartInstance = chart;
  element.dataset.rendered = 'true';
  window.addEventListener('resize', resizeTroopChart);
}

// 根据当前索引更新战斗事件文本、回合提示和事件计数。
function updateBattleLog() {
  var log = document.getElementById('battle-log');
  var indicator = document.getElementById('round-indicator');
  log.innerHTML = '';
  if (battleIndex === 0) {
    log.innerHTML = '<div class="muted small">选择“播放”或“下一事件”查看演示战报。</div>';
    indicator.textContent = '回合 1 / 2 · 0 / ' + battleEvents.length + ' 事件';
    return;
  }
  // 按当前回放进度逐行生成已发生事件。
  battleEvents.slice(0, battleIndex).forEach(function appendBattleEvent(item) {
    var row = document.createElement('div');
    row.className = 'log-entry';
    row.innerHTML = '<time>回合 ' + item.round + '</time><div>' + item.text + '</div>';
    log.appendChild(row);
  });
  log.scrollTop = log.scrollHeight;
  var current = battleEvents[Math.min(battleIndex - 1, battleEvents.length - 1)];
  indicator.textContent = '回合 ' + current.round + ' / 2 · ' + battleIndex + ' / ' + battleEvents.length + ' 事件';
}

// 将演示战报推进一个事件，播放结束时停止自动推进。
function stepBattleReplay() {
  if (battleIndex >= battleEvents.length) {
    pauseBattleReplay();
    return;
  }
  battleIndex += 1;
  updateBattleLog();
  if (battleIndex >= battleEvents.length) pauseBattleReplay();
}

// 启动定时战报播放，并在播放到末尾后自动停止。
function playBattleReplay() {
  if (battleIndex >= battleEvents.length) {
    battleIndex = 0;
    updateBattleLog();
  }
  pauseBattleReplay();
  battleTimer = window.setInterval(stepBattleReplay, 1000);
}

// 暂停正在运行的自动战报播放计时器。
function pauseBattleReplay() {
  if (battleTimer !== null) window.clearInterval(battleTimer);
  battleTimer = null;
}

// 重置战报索引并恢复到尚未播放的初始状态。
function resetBattleReplay() {
  pauseBattleReplay();
  battleIndex = 0;
  updateBattleLog();
}

// 绑定战报播放按钮，并在初次加载时显示尚未播放的状态。
function initBattleReplay() {
  document.getElementById('play').addEventListener('click', playBattleReplay);
  document.getElementById('pause').addEventListener('click', pauseBattleReplay);
  document.getElementById('step').addEventListener('click', stepBattleReplay);
  document.getElementById('reset').addEventListener('click', resetBattleReplay);
  updateBattleLog();
}

var battleEvents = [
  { round: 1, text: '<strong>韩策 · 主动阶段</strong>发动「拒马阵」，对石魁造成 <span class="damage">120 兵力伤害</span>；石魁兵力 980 → 860，缴械判定被抵抗。主动成功后仍保留普攻。' },
  { round: 1, text: '<strong>韩策 · 普攻阶段</strong>普通攻击敌方前锋石魁，造成 <span class="damage">100</span>；石魁兵力 860 → 760。' },
  { round: 1, text: '<strong>石魁 · 主动阶段</strong>未配置主动战法，本阶段无发动检定；开场被动「悍勇」已使普攻倍率提升至 1.15，继续进入普攻阶段。' },
  { round: 1, text: '<strong>石魁 · 普攻阶段</strong>「悍勇」强化后的普通攻击造成 <span class="damage">115</span>；韩策兵力 1000 → 885。' },
  { round: 1, text: '<strong>许翎 · 主动阶段</strong>发动「流火计」，随机选中石魁，造成 <span class="damage">154</span>；石魁兵力 760 → 606，随后施加「易伤 10%」，持续至第 2 回合结束。' },
  { round: 1, text: '<strong>许翎 · 普攻阶段</strong>普通攻击石魁，兵种优势和易伤共同作用，造成 <span class="damage">121</span>；石魁兵力 606 → 485。' },
  { round: 1, text: '<strong>陆骁 · 主动阶段</strong>成功启动「连弩齐射」并开始准备，占用本轮主动阶段；下一次可用主动阶段优先释放，本轮仍可普攻。' },
  { round: 1, text: '<strong>陆骁 · 普攻阶段</strong>准备期间普通攻击韩策，受兵种劣势修正造成 <span class="damage">90</span>；韩策兵力 885 → 795。' },
  { round: 1, text: '<strong>唐策 · 主动阶段</strong>自带「踏阵」为追击战法，未配置主动战法，本阶段无发动检定，继续进入普攻阶段。' },
  { round: 1, text: '<strong>唐策 · 普攻阶段</strong>普通攻击石魁，受兵种劣势修正和易伤影响造成 <span class="damage">99</span>；石魁兵力 485 → 386，命中后进入追击检定。' },
  { round: 1, text: '<strong>唐策 · 追击事件</strong>「踏阵」发动成功，对同一目标追加 <span class="damage">59</span>；石魁兵力 386 → 327。追击不增加新的主动或普攻机会。' },
  { round: 1, text: '<strong>梅蘅 · 主动阶段</strong>自带「回春」为回合末被动，未配置主动战法，本阶段无发动检定，继续进入普攻阶段。' },
  { round: 1, text: '<strong>梅蘅 · 普攻阶段</strong>普通攻击韩策，造成 <span class="damage">100</span>；韩策兵力 795 → 695。六名武将本轮两个阶段均已处理。' },
  { round: 1, text: '<strong>梅蘅 · 回合结束</strong>「回春」选择本方存活兵力比例最低的石魁，恢复 <span class="control">98</span>；石魁兵力 327 → 425。易伤在施加回合不减时，保留至第 2 回合结束。' },
  { round: 2, text: '<strong>韩策 · 主动阶段</strong>以 0.695 的兵力系数发动「拒马阵」，受目标易伤加成造成 <span class="damage">91</span>；石魁兵力 425 → 334，<span class="control">缴械命中</span>，持续至石魁下一次行动结束。' },
  { round: 2, text: '<strong>韩策 · 普攻阶段</strong>普通攻击石魁，受易伤影响造成 <span class="damage">76</span>；石魁兵力 334 → 258。主动施加控制仍不占用普攻。' },
  { round: 2, text: '<strong>石魁 · 主动阶段</strong>缴械不阻止主动战法，本阶段仍有机会；本编队未配置主动战法，无发动检定。' },
  { round: 2, text: '<strong>石魁 · 普攻阶段</strong>因缴械跳过普通攻击，本轮未造成伤害；行动结束后移除缴械。' },
  { round: 2, text: '<strong>许翎 · 主动阶段</strong>发动「流火计」，本次随机选中梅蘅，受兵种劣势修正造成 <span class="damage">126</span>；梅蘅兵力 900 → 774，施加「易伤 10%」，持续至第 3 回合结束。' },
  { round: 2, text: '<strong>许翎 · 普攻阶段</strong>普攻重新按前锋优先选中石魁，造成 <span class="damage">121</span>；石魁兵力 258 → 137。普攻目标不必与主动目标相同。' },
  { round: 2, text: '<strong>陆骁 · 主动阶段</strong>优先释放已准备的「连弩齐射」，不重复检定发动率；随机选中韩策，造成 <span class="damage">198</span>；韩策兵力 695 → 497，随后仍可普攻。' },
  { round: 2, text: '<strong>陆骁 · 普攻阶段</strong>释放准备战法后普通攻击韩策，造成 <span class="damage">90</span>；韩策兵力 497 → 407。' },
  { round: 2, text: '<strong>唐策 · 主动阶段</strong>未配置主动战法，无发动检定，继续进入普攻阶段。' },
  { round: 2, text: '<strong>唐策 · 普攻阶段</strong>普通攻击石魁，受兵种劣势修正与易伤影响理论伤害为 99，实际扣除 <span class="damage">99</span>；石魁兵力 137 → 38，随后检定追击。' },
  { round: 2, text: '<strong>唐策 · 追击事件</strong>「踏阵」再次成功，理论伤害 59，实际扣除 <span class="damage">38</span>；石魁兵力 38 → 0，易伤随倒下移除。石魁并非主将，战斗继续。' },
  { round: 2, text: '<strong>梅蘅 · 主动阶段</strong>未配置主动战法，无发动检定；身上的易伤只影响受到的伤害，不阻止行动。' },
  { round: 2, text: '<strong>梅蘅 · 普攻阶段</strong>以 774 ÷ 900 的兵力系数普通攻击韩策，造成 <span class="damage">86</span>；韩策兵力 407 → 321。六名武将本轮两个阶段均已处理。' },
  { round: 2, text: '<strong>梅蘅 · 回合结束</strong>石魁已倒下，不可治疗；「回春」为存活且兵力比例最低的梅蘅恢复 <span class="control">90</span>；梅蘅兵力 774 → 864，易伤持续至第 3 回合结束。双方主将韩策 321 / 1000、陆骁 1000 / 1000，均存活；样例在此截停，不判整场胜负。' }
];
var battleIndex = 0;
var battleTimer = null;

initBattleDesignDiagrams();
initDesignTabs();
initBattleReplay();
