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

  // Niveis exatamente como no Pine fornecido: projecao a partir da ancora de
  // pivo, de 0.618 ate 4.618 do range. Nao e retracao.
  var ALVOS_PINE = [0.618, 1.618, 2.618, 3.618, 4.618];
  var CORES_PINE = { 0.618: '#26A69A', 1.618: '#42A5F5', 2.618: '#AB47BC', 3.618: '#FFA726', 4.618: '#EF5350' };

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

  // Le o plano do nucleo Fibonacci (mesma regra do Pine) e desenha no preco.
  function obterFibo() {
    if (window.AtlasFiboCore) return Promise.resolve(window.AtlasFiboCore);
    return import('./core/fibonacci.js').then(function (m) {
      window.AtlasFiboCore = m;
      return m;
    }).catch(function () { return null; });
  }

  function velasFechadas() {
    var lista = null;
    try { if (typeof candles !== 'undefined' && candles && candles.length) lista = candles; } catch (e) {}
    if (!lista) return [];
    return lista.slice(0, Math.max(0, lista.length - 1)).map(function (c) {
      return { t: c.time, o: c.open, h: c.high, l: c.low, c: c.close };
    });
  }

  var planoFib = null;

  function desenharFib() {
    if (typeof candleSeries === 'undefined' || !candleSeries || typeof candleSeries.createPriceLine !== 'function') return;
    if (!fibLigado) { limparFib(); ancoraFib = null; return; }
    obterFibo().then(function (mod) {
      if (!mod) return;
      // fiboAuto entrega a perna ATUAL (o lado que esta no comando agora) e
      // alterna sozinha a cada cruzamento da EMA 8/16; fiboPlan fica como
      // reserva para quando o nucleo antigo estiver em cache no navegador.
      var plano = mod.fiboAuto ? mod.fiboAuto(velasFechadas()) : (mod.fiboPlan ? mod.fiboPlan(velasFechadas()) : null);
      if (!plano || !isFinite(plano.p0) || !isFinite(plano.p1)) { limparFib(); ancoraFib = null; return; }
      planoFib = plano;
      var chave = plano.p0 + '_' + plano.p1 + '_' + plano.lado;
      if (chave === ancoraFib) return;
      ancoraFib = chave;
      limparFib();

      // ancoras: P0 e P1 sao o swing que gerou a projecao
      try {
        linhasFib.push(candleSeries.createPriceLine({
          price: plano.p1, color: '#78909C', lineWidth: 1, lineStyle: 3,
          axisLabelVisible: true, title: 'ancora P1'
        }));
      } catch (e) {}

      (plano.niveis || []).forEach(function (a) {
        var lv = Number(a.mult);
        var cor = CORES_PINE[lv] || '#90A4AE';
        try {
          linhasFib.push(candleSeries.createPriceLine({
            price: a.preco,
            color: cor,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: lv.toFixed(3) + (plano.lado === 'alta' ? ' alta' : ' baixa') + (a.bateu ? ' ok' : '')
          }));
        } catch (e) {}
      });
      pintarFibChip(plano);
    });
  }

  function pintarFibChip(plano) {
    if (!chip || !plano) return;
    var btn = chip.querySelector('#ts-fib');
    if (!btn) return;
    var primeiro = plano.niveis && plano.niveis[0];
    btn.title = 'FIB ' + (plano.lado === 'alta' ? 'alta' : 'baixa') +
      (primeiro ? ' | proximo alvo ' + primeiro.preco.toFixed(2) : '');
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
