// Trailing stop e Fibonacci no preco, desenhados no grafico principal.
//
// Duas coisas aqui:
//  1) a linha do trailing stop (Chandelier com catraca) vinda do nucleo puro
//     em core/trailing.js, atualizada a cada 2s em candle fechado;
//  2) os niveis de Fibonacci mais importantes do fibo atual como linhas de
//     preco, para ver no grafico onde esta cada alvo.
//
// O nucleo de calculo nao mora aqui: este arquivo so le, desenha e mostra.

(function () {
  'use strict';

  var NIVEIS_FIB = [0, 0.382, 0.5, 0.618, 1, 1.618];
  var CORES_FIB = {
    0: '#9e9e9e', 0.382: '#FF9800', 0.5: '#4CAF50',
    0.618: '#009688', 1: '#00BCD4', 1.618: '#2196F3'
  };

  var core = null;
  var serieTS = null;
  var linhasFib = [];
  var ancoraFib = null;
  var chip = null;
  var tsLigado = true;
  var fibLigado = true;
  var estado = null;

  function num(v) { return typeof v === 'number' && isFinite(v); }
  function preco(v) { return num(v) ? v.toFixed(2) : '--'; }

  function obterCore() {
    if (core) return Promise.resolve(core);
    if (window.AtlasTrailingCore) { core = window.AtlasTrailingCore; return Promise.resolve(core); }
    return import('./core/trailing.js').then(function (m) {
      core = m;
      window.AtlasTrailingCore = m;
      return m;
    }).catch(function (e) {
      console.warn('[trailing] nucleo indisponivel:', e && e.message);
      return null;
    });
  }

  function candlesFechados() {
    try {
      if (typeof candles !== 'undefined' && Array.isArray(candles) && candles.length) {
        // a ultima vela do grafico pode estar em formacao
        return candles.slice(0, candles.length - 1);
      }
    } catch (e) {}
    return [];
  }

  function garantirSerie() {
    if (serieTS) return serieTS;
    try {
      if (typeof chart === 'undefined' || !chart || typeof chart.addLineSeries !== 'function') return null;
      serieTS = chart.addLineSeries({
        color: '#D9B45B',
        lineWidth: 2,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: 'TS'
      });
    } catch (e) {
      serieTS = null;
    }
    return serieTS;
  }

  function calcular() {
    var velas = candlesFechados();
    if (!core || velas.length < 40) return null;
    try { return core.trailingStop(velas); } catch (e) { return null; }
  }

  function desenharTS() {
    var s = garantirSerie();
    if (!s) return;
    var plano = calcular();
    if (!plano || !plano.serie.length) return;
    estado = plano.estado;
    if (tsLigado) {
      try { s.setData(plano.serie.map(function (p) { return { time: p.time, value: p.value }; })); } catch (e) {}
    } else {
      try { s.setData([]); } catch (e) {}
    }
    pintarChip();
  }

  function diboAtual() {
    try { if (typeof fiboAtual === 'function') return fiboAtual(); } catch (e) {}
    try {
      if (typeof drawings === 'function') {
        var lista = drawings();
        for (var i = lista.length - 1; i >= 0; i--) if (lista[i] && lista[i].type === 'fibbo') return lista[i];
      }
    } catch (e) {}
    return null;
  }

  function limparFib() {
    if (!linhasFib.length) return;
    linhasFib.forEach(function (l) { try { candleSeries.removePriceLine(l); } catch (e) {} });
    linhasFib = [];
  }

  function desenharFib() {
    if (typeof candleSeries === 'undefined' || !candleSeries || typeof candleSeries.createPriceLine !== 'function') return;
    var d = diboAtual();
    if (!d || !d.p0 || !d.p1 || !num(d.p0.price) || !num(d.p1.price)) { limparFib(); ancoraFib = null; return; }
    var chave = d.p0.price + '_' + d.p1.price;
    if (chave === ancoraFib) return;
    ancoraFib = chave;
    limparFib();
    if (!fibLigado) return;
    var p0 = d.p0.price, p1 = d.p1.price;
    NIVEIS_FIB.forEach(function (lv) {
      var valor = p1 + (p0 - p1) * lv;
      if (!num(valor) || valor <= 0) return;
      try {
        linhasFib.push(candleSeries.createPriceLine({
          price: valor,
          color: CORES_FIB[lv] || '#9e9e9e',
          lineWidth: 1,
          lineStyle: lv === 0 || lv === 1 ? 0 : 2,
          axisLabelVisible: true,
          title: 'fib ' + lv
        }));
      } catch (e) {}
    });
  }

  function montarChip() {
    if (chip || !document.body) return;
    chip = document.createElement('div');
    chip.id = 'ts-chip';
    chip.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9998;display:flex;align-items:center;gap:8px;' +
      'background:rgba(8,14,22,.92);border:1px solid rgba(217,180,91,.45);border-radius:6px;padding:6px 9px;' +
      'font:11px/1.3 ui-monospace,Consolas,monospace;color:#cfe9f7;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    chip.innerHTML =
      '<span id="ts-lado" style="font-weight:700;color:#D9B45B">TS --</span>' +
      '<span id="ts-val">--</span>' +
      '<span id="ts-dist" style="opacity:.6">--</span>' +
      '<button type="button" id="ts-btn" title="ligar/desligar a linha do trailing" ' +
        'style="min-height:40px;min-width:40px;background:transparent;border:1px solid rgba(217,180,91,.45);' +
        'border-radius:5px;color:#D9B45B;font:11px ui-monospace,monospace;cursor:pointer">TS</button>' +
      '<button type="button" id="ts-fib" title="ligar/desligar os niveis de Fibonacci no preco" ' +
        'style="min-height:40px;min-width:40px;background:transparent;border:1px solid rgba(0,188,212,.45);' +
        'border-radius:5px;color:#00BCD4;font:11px ui-monospace,monospace;cursor:pointer">FIB</button>';
    document.body.appendChild(chip);

    chip.querySelector('#ts-btn').addEventListener('click', function () {
      tsLigado = !tsLigado;
      this.style.opacity = tsLigado ? '1' : '.35';
      desenharTS();
    });
    chip.querySelector('#ts-fib').addEventListener('click', function () {
      fibLigado = !fibLigado;
      this.style.opacity = fibLigado ? '1' : '.35';
      ancoraFib = null;
      desenharFib();
    });
  }

  function pintarChip() {
    if (!chip || !estado) return;
    var lado = chip.querySelector('#ts-lado');
    var val = chip.querySelector('#ts-val');
    var dist = chip.querySelector('#ts-dist');
    if (lado) {
      lado.textContent = 'TS ' + (estado.lado === 'alta' ? '▲' : '▼');
      lado.style.color = estado.lado === 'alta' ? '#3FBF8F' : '#E2685F';
    }
    if (val) val.textContent = preco(estado.stop);
    if (dist) dist.textContent = preco(estado.distancia) + ' (' + estado.distanciaPercentual + '%)';
    chip.title = 'stop ' + preco(estado.stop) + ' · preco ' + preco(estado.preco) +
      ' · viradas ' + estado.viradas;
  }

  function ciclo() {
    desenharTS();
    desenharFib();
  }

  function iniciar() {
    montarChip();
    obterCore().then(function (m) {
      if (!m) return;
      garantirSerie();
      ciclo();
      setInterval(ciclo, 2000);
    });
  }

  window.AtlasTrailing = {
    ciclo: ciclo,
    estado: function () { return estado; },
    ligarTS: function (v) { tsLigado = !!v; desenharTS(); },
    ligarFib: function (v) { fibLigado = !!v; ancoraFib = null; desenharFib(); }
  };

  function esperar() {
    var tent = 0;
    var iv = setInterval(function () {
      var pronto = false;
      try {
        pronto = typeof chart !== 'undefined' && !!chart && typeof candles !== 'undefined' &&
          Array.isArray(candles) && candles.length > 40 && typeof candleSeries !== 'undefined' && !!candleSeries;
      } catch (e) { pronto = false; }
      if (pronto) { clearInterval(iv); iniciar(); return; }
      if (++tent > 120) clearInterval(iv);
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', esperar);
  else esperar();
})();
