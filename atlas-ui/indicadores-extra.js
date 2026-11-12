// MACD e Bollinger como indicadores de primeira classe no Atlas.
//
// Os dois existiam escondidos dentro de outros blocos. Aqui ganham entrada
// propria no catalogo do grafico, com desenho proprio e estado salvo:
//
//   Bollinger  tres linhas no preco (media, superior, inferior), categoria
//              overlay, feito para ver compressao e rompimento de banda.
//   MACD       painel proprio abaixo do grafico, com histograma, linha e
//              sinal, categoria subpane.
//
// A conta mora em core/bollinger.js e core/macd.js. Este arquivo apenas le os
// candles, desenha, liga e desliga.

(function () {
  'use strict';

  var CHAVE = 'atlas.extras.v1';
  var cores = { macd: null, boll: null };
  var bb = { ligado: false, series: null };
  var mc = { ligado: false, wrap: null, chart: null, hist: null, linha: null, sinal: null };
  var timer = null;
  var ultimaContagem = -1;

  function num(v) { return typeof v === 'number' && isFinite(v); }

  function velas() {
    try {
      if (typeof candles !== 'undefined' && Array.isArray(candles) && candles.length > 30) {
        return candles.slice(0, candles.length - 1).map(function (c) {
          return { time: c.time, o: c.open, h: c.high, l: c.low, c: c.close };
        });
      }
    } catch (e) {}
    return [];
  }

  function carrega(nome, caminho, janela) {
    if (cores[nome]) return Promise.resolve(cores[nome]);
    var fonte = window[janela] ? Promise.resolve(window[janela])
      : import(caminho).catch(function () { return null; });
    return fonte.then(function (m) {
      if (m) { cores[nome] = m; window[janela] = m; }
      return m;
    });
  }

  function obterCores() {
    return Promise.all([
      carrega('macd', './core/macd.js', 'AtlasMacdCore'),
      carrega('boll', './core/bollinger.js', 'AtlasBollCore')
    ]);
  }

  function lerEstado() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch (e) { return {}; }
  }
  function salvaEstado() {
    try { localStorage.setItem(CHAVE, JSON.stringify({ bollinger: bb.ligado, macd: mc.ligado })); } catch (e) {}
  }

  // ---------------------------------------------------------------- bollinger
  function criarBB() {
    if (bb.series) return bb.series;
    try {
      if (typeof chart === 'undefined' || !chart || typeof chart.addLineSeries !== 'function') return null;
      bb.series = {
        superior: chart.addLineSeries({ color: 'rgba(142,124,195,0.9)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: 'BB+' }),
        media: chart.addLineSeries({ color: 'rgba(176,138,62,0.95)', lineWidth: 1, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: 'BB' }),
        inferior: chart.addLineSeries({ color: 'rgba(142,124,195,0.9)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: 'BB-' })
      };
    } catch (e) { bb.series = null; }
    return bb.series;
  }

  function desenharBB() {
    var s = criarBB();
    if (!s) return;
    if (!bb.ligado) {
      ['superior', 'media', 'inferior'].forEach(function (k) { try { s[k].setData([]); } catch (e) {} });
      return;
    }
    var v = velas();
    if (!cores.boll || v.length < 25) return;
    var r = null;
    try { r = cores.boll.bandas(v); } catch (e) { r = null; }
    if (!r) return;
    var monta = function (arr) {
      var out = [];
      for (var i = 0; i < arr.length; i++) if (num(arr[i])) out.push({ time: v[i].time, value: arr[i] });
      return out;
    };
    try {
      s.superior.setData(monta(r.superior));
      s.media.setData(monta(r.media));
      s.inferior.setData(monta(r.inferior));
    } catch (e) {}
  }

  // -------------------------------------------------------------------- macd
  function criarMacd() {
    if (mc.chart) return mc.chart;
    try {
      if (typeof LightweightCharts === 'undefined' || !LightweightCharts.createChart) return null;
      var base = document.querySelector('.chart-wrap');
      if (!base || !base.parentNode) return null;

      mc.wrap = document.createElement('div');
      mc.wrap.id = 'macd-wrap';
      mc.wrap.className = 'phi-wrap';
      mc.wrap.style.cssText = 'display:none;height:120px;min-height:120px;position:relative';
      var box = document.createElement('div');
      box.id = 'macd-chart';
      box.style.cssText = 'width:100%;height:100%';
      mc.wrap.appendChild(box);
      base.parentNode.insertBefore(mc.wrap, base.nextSibling);

      mc.chart = LightweightCharts.createChart(box, {
        layout: { background: { color: '#fbfbfc' }, textColor: '#6e7683', fontFamily: 'IBM Plex Sans' },
        grid: { vertLines: { color: '#f0f1f3' }, horzLines: { color: '#f0f1f3' } },
        rightPriceScale: { borderColor: '#e3e6ea', autoScale: true, scaleMargins: { top: 0.12, bottom: 0.12 } },
        timeScale: { borderColor: '#e3e6ea', timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 8, lockVisibleTimeRangeOnResize: true },
        crosshair: { mode: 0 }
      });

      mc.hist = mc.chart.addHistogramSeries({ priceFormat: { type: 'price', precision: 2, minMove: 0.01 }, priceLineVisible: false, lastValueVisible: false, title: 'MACD hist' });
      mc.linha = mc.chart.addLineSeries({ color: '#2196F3', lineWidth: 1.4, priceLineVisible: false, lastValueVisible: false, title: 'MACD' });
      mc.sinal = mc.chart.addLineSeries({ color: '#FF9800', lineWidth: 1.2, priceLineVisible: false, lastValueVisible: false, title: 'Sinal' });

      try {
        mc.chart.timeScale().subscribeVisibleLogicalRangeChange(function (r) {
          if (r && typeof syncTimeScales === 'function') syncTimeScales(mc.chart, r);
        });
      } catch (e) {}
    } catch (e) { mc.chart = null; }
    return mc.chart;
  }

  function desenharMacd() {
    var c = criarMacd();
    if (!c) return;
    if (mc.wrap) mc.wrap.style.display = mc.ligado ? 'block' : 'none';
    if (!mc.ligado) {
      try { mc.hist.setData([]); mc.linha.setData([]); mc.sinal.setData([]); } catch (e) {}
      return;
    }
    var v = velas();
    if (!cores.macd || v.length < 40) return;
    var r = null;
    try { r = cores.macd.macd(v); } catch (e) { r = null; }
    if (!r) return;

    var hist = [], linha = [], sinal = [];
    for (var i = 0; i < v.length; i++) {
      if (num(r.histograma[i])) {
        hist.push({
          time: v[i].time,
          value: r.histograma[i],
          color: r.histograma[i] >= 0 ? 'rgba(63,191,143,0.55)' : 'rgba(226,104,95,0.55)'
        });
      }
      if (num(r.linha[i])) linha.push({ time: v[i].time, value: r.linha[i] });
      if (num(r.sinal[i])) sinal.push({ time: v[i].time, value: r.sinal[i] });
    }
    try {
      mc.hist.setData(hist);
      mc.linha.setData(linha);
      mc.sinal.setData(sinal);
    } catch (e) {}
  }

  // ------------------------------------------------------------------ geral
  function atualizar() {
    var v = velas();
    if (!v.length) return;
    desenharBB();
    desenharMacd();
    ultimaContagem = v.length;
    var legenda = '';
    try {
      if (bb.ligado && cores.boll) {
        var rb = cores.boll.bandas(v);
        if (rb) legenda += 'BB ' + rb.estado.media.toFixed(2) + (rb.estado.squeeze ? ' SQUEEZE' : '') + '  ';
      }
      if (mc.ligado && cores.macd) {
        var rm = cores.macd.macd(v);
        if (rm) legenda += 'MACD ' + rm.estado.macd.toFixed(2) + ' ' + (rm.estado.tendencia === 'alta' ? 'alta' : 'baixa');
      }
    } catch (e) {}
    var el = document.getElementById('extras-legenda');
    if (!el) {
      var base = document.querySelector('.chart-wrap');
      if (base && base.parentNode) {
        el = document.createElement('div');
        el.id = 'extras-legenda';
        el.style.cssText = 'position:fixed;right:12px;bottom:64px;z-index:9000;font:11px ui-monospace,monospace;' +
          'color:#4a5666;background:rgba(251,251,252,.9);border:1px solid #e3e6ea;border-radius:5px;padding:4px 8px;display:none';
        document.body.appendChild(el);
      }
    }
    if (el) {
      el.textContent = legenda.trim();
      el.style.display = legenda.trim() ? 'block' : 'none';
    }
  }

  function ligar(qual, valor) {
    if (qual === 'bollinger') bb.ligado = valor; else mc.ligado = valor;
    salvaEstado();
    atualizar();
  }

  function registrar() {
    var reg = null;
    try { if (typeof INDICATORS_REGISTRY !== 'undefined') reg = INDICATORS_REGISTRY; } catch (e) { reg = null; }
    if (!reg || !Array.isArray(reg)) return;
    if (!reg.some(function (x) { return x.id === 'bollinger-atlas'; })) {
      reg.push({
        id: 'bollinger-atlas',
        name: 'Bollinger (20, 2) no Preco',
        category: 'overlay',
        desc: 'Media de 20 e dois desvios no preco, com leitura de compressao de banda e rompimento.',
        isLigado: function () { return bb.ligado; },
        toggle: function () { ligar('bollinger', !bb.ligado); },
        isVisible: function () { return bb.ligado; },
        toggleVisible: function () { ligar('bollinger', !bb.ligado); }
      });
    }
    if (!reg.some(function (x) { return x.id === 'macd-atlas'; })) {
      reg.push({
        id: 'macd-atlas',
        name: 'MACD (12, 26, 9)',
        category: 'subpane',
        desc: 'EMA 12 menos EMA 26, linha de sinal 9 e histograma, em painel proprio com tendencia e ultimo cruzamento.',
        isLigado: function () { return mc.ligado; },
        toggle: function () { ligar('macd', !mc.ligado); },
        isVisible: function () { return mc.ligado; },
        toggleVisible: function () { ligar('macd', !mc.ligado); }
      });
    }
  }

  function iniciar() {
    obterCores().then(function () {
      var est = lerEstado();
      bb.ligado = est.bollinger === true;
      mc.ligado = est.macd === true;
      registrar();
      atualizar();
      if (!timer) timer = setInterval(atualizar, 3000);
    });
  }

  window.AtlasExtras = {
    atualizar: atualizar,
    ligar: ligar,
    estado: function () { return { bollinger: bb.ligado, macd: mc.ligado }; },
    registrar: registrar
  };

  function esperar() {
    var tent = 0;
    var iv = setInterval(function () {
      var ok = false;
      try {
        ok = typeof chart !== 'undefined' && !!chart &&
          typeof candles !== 'undefined' && Array.isArray(candles) && candles.length > 30;
      } catch (e) { ok = false; }
      if (ok) { clearInterval(iv); iniciar(); return; }
      if (++tent > 120) { clearInterval(iv); registrar(); }
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', esperar);
  else esperar();
})();
