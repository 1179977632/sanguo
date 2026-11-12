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
  { round: 1, text: '<strong>韩策</strong>发动「拒马阵」，对石魁造成 <span class="damage">82 兵力伤害</span>；石魁兵力 980 → 898，缴械判定未命中。' },
  { round: 1, text: '<strong>石魁</strong>普通攻击韩策，「悍勇」提高普攻倍率，造成 <span class="damage">104 兵力伤害</span>；韩策兵力 1000 → 896。' },
  { round: 1, text: '<strong>许翎</strong>发动「流火计」，随机选中石魁，造成 <span class="damage">146</span> 伤害，兵力 898 → 752；施加「易伤 10%」，持续至第 2 回合结束。' },
  { round: 1, text: '<strong>陆骁</strong>成功准备「连弩齐射」，消耗本次行动且不普攻；等待下次可推进的行动机会结算。' },
  { round: 1, text: '<strong>唐策</strong>普通攻击石魁，造成 <span class="damage">91</span>，兵力 752 → 661；追击战法「踏阵」追加 <span class="damage">53</span>，兵力 661 → 608。' },
  { round: 1, text: '<strong>梅蘅</strong>普通攻击韩策，造成 <span class="damage">60</span>；韩策兵力 896 → 836。所有武将本回合行动完毕。' },
  { round: 1, text: '<strong>梅蘅</strong>回合结束时触发「回春」，恢复石魁 <span class="control">98 兵力</span>；石魁兵力 608 → 706。' },
  { round: 2, text: '<strong>韩策</strong>发动「拒马阵」，对石魁造成 <span class="damage">82</span>；石魁兵力 706 → 624，且命中缴械，持续至石魁本次行动结束。' },
  { round: 2, text: '<strong>石魁</strong>受缴械影响，跳过普通攻击，本次行动没有造成伤害；行动结束后移除缴械。' },
  { round: 2, text: '<strong>许翎</strong>发动「流火计」，随机选中石魁，造成 <span class="damage">146</span> 伤害，兵力 624 → 478；施加「易伤 10%」，持续至第 3 回合结束。' },
  { round: 2, text: '<strong>陆骁</strong>优先结算已准备的「连弩齐射」，本次不检定发动率；随机选中韩策，造成 <span class="damage">236</span>，兵力 836 → 600，不再普攻。' },
  { round: 2, text: '<strong>唐策</strong>普通攻击石魁，受易伤影响造成 <span class="damage">100</span>，兵力 478 → 378；「踏阵」追加伤害同受易伤影响，造成 <span class="damage">58</span>，兵力 378 → 320。' },
  { round: 2, text: '<strong>梅蘅</strong>普通攻击韩策，造成 <span class="damage">60</span>；韩策兵力 600 → 540。所有武将本回合行动完毕。' },
  { round: 2, text: '<strong>梅蘅</strong>回合结束时再次触发「回春」，恢复石魁 <span class="control">98 兵力</span>；石魁兵力 320 → 418。本次施加刷新易伤持续时间，状态保留至第 3 回合结束。双方主将均存活，样例在此截停。' }
];
var battleIndex = 0;
var battleTimer = null;

initBattleDesignDiagrams();
initDesignTabs();
initBattleReplay();
