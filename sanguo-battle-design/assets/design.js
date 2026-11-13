// 初始化本地 Mermaid 流程图渲染。
function initBattleDesignDiagrams() {
  mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'strict' });
}

// 切换设计样例标签页并维护键盘可访问状态。
function initDesignTabs() {
  var tabs = Array.from(document.querySelectorAll('.tab'));
  tabs.forEach(function(tab, index) {
    tab.addEventListener('click', function handleTabClick() { activateTab(tab); });
    tab.addEventListener('keydown', function handleTabKeydown(event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      var delta = event.key === 'ArrowRight' ? 1 : -1;
      var next = tabs[(index + delta + tabs.length) % tabs.length];
      activateTab(next);
      next.focus();
    });
  });

  // 同步选中标签、面板和按需加载的数值曲线。
  function activateTab(activeTab) {
    tabs.forEach(function updateTab(tab) {
      var selected = tab === activeTab;
      tab.setAttribute('aria-selected', String(selected));
      document.getElementById(tab.getAttribute('aria-controls')).classList.toggle('hidden', !selected);
    });
    if (activeTab.id === 'tab-balance') renderTroopChart();
  }
}

// 格式化兵力曲线悬浮提示。
function formatTroopTooltip(items) {
  return items[0].axisValue + '% 兵力<br>建议伤害系数：' + items[0].data.toFixed(2);
}

// 窗口缩放时调整已初始化的兵力曲线。
function resizeTroopChart() {
  var chartElement = document.getElementById('troop-chart');
  if (chartElement && chartElement.chartInstance) chartElement.chartInstance.resize();
}

// 绘制与战斗原型参数一致的兵力系数曲线。
function renderTroopChart() {
  var element = document.getElementById('troop-chart');
  if (element.dataset.rendered) return;
  var style = getComputedStyle(document.documentElement);
  var api = window.SanguoBattle;
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var accent = style.getPropertyValue('--accent').trim();
  var minimum = api.data.parameters.troopFactorMin;
  var chart = echarts.init(element, null, { renderer: 'svg' });
  chart.setOption({
    animation: false,
    tooltip: { trigger: 'axis', appendToBody: true, formatter: formatTroopTooltip },
    grid: { left: 48, right: 22, top: 24, bottom: 38 },
    xAxis: { type: 'category', name: '剩余兵力比例', data: ['30','40','50','60','70','80','90','100'], axisLine: { lineStyle: { color: rule } }, axisLabel: { color: muted }, nameTextStyle: { color: muted } },
    yAxis: { type: 'value', name: '伤害系数', min: minimum, max: 1, interval: 0.2, axisLabel: { color: muted }, splitLine: { lineStyle: { color: rule } }, nameTextStyle: { color: muted } },
    series: [{ type: 'line', name: '原型参数', data: [minimum,0.4,0.5,0.6,0.7,0.8,0.9,1], smooth: false, symbolSize: 7, lineStyle: { color: accent, width: 3 }, itemStyle: { color: accent }, areaStyle: { color: accent, opacity: 0.09 } }],
    textStyle: { color: ink }
  });
  element.chartInstance = chart;
  element.dataset.rendered = 'true';
  window.addEventListener('resize', resizeTroopChart);
}

// 初始化设计图、交互标签和自动战斗回放。
function initBattleDesignPage() {
  initBattleDesignDiagrams();
  initDesignTabs();
  window.SanguoBattle.replay.init();
}

initBattleDesignPage();
