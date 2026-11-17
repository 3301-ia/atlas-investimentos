/* VECTRA · SINAL MULTI POR ATIVO
   Os três ativos vigiados ganham a mesma régua de tempos do painel:
   1m, 5m, 15m, 1H, 4H e 1D, cada um votando pelo que o código calcula.
     EMA 8/16/50 (peso 2) + RSI 14 (peso 1)
     soma >= +2 compra | <= -2 venda | resto neutro
   4 ou mais tempos no mesmo lado = ALINHADO (n/6); senão, CONFLITO.
   Dominância não entra aqui: ela é do gráfico aberto, não do ativo parado. */

(function () {
  'use strict';

  var ATIVOS = [
    { curto: 'BTC', par: 'BTC-USD' },
    { curto: 'ETH', par: 'ETH-USD' },
    { curto: 'ZEC', par: 'ZEC-USD' }
  ];
  var TFS = [
    { g: 60, rot: '1m' },
    { g: 300, rot: '5m' },
    { g: 900, rot: '15m' },
    { g: 3600, rot: '1H' },
    { g: 21600, rot: '4H' },
    { g: 86400, rot: '1D' }
  ];

  var cache = {};      // par -> { t: ts, votos }
  var ultimo = null;   // resumo dos tres ativos
  var VAL_MS = 60000;

  function ema(v, n) {
    if (!v || v.length < n) return null;
    var a = 2 / (n + 1), e = v[v.length - n];
    for (var i = v.length - n + 1; i < v.length; i++) e = v[i] * a + e * (1 - a);
    return e;
  }

  function rsi(v, n) {
    if (!v || v.length < n + 2) return null;
    var g = 0, p = 0;
    for (var i = v.length - n; i < v.length; i++) {
      var d = v[i] - v[i - 1];
      if (d > 0) g += d; else p -= d;
    }
    g /= n; p /= n;
    if (p === 0) return 100;
    return 100 - 100 / (1 + g / p);
  }

  function votarTempo(fechas) {
    var e8 = ema(fechas, 8), e16 = ema(fechas, 16), e50 = ema(fechas, 50);
    if (e8 == null || e16 == null || e50 == null) return null;
    var p = 0;
    if (e8 > e16 && e16 > e50) p = 2;
    else if (e8 > e16) p = 1;
    else if (e8 < e16 && e16 < e50) p = -2;
    else if (e8 < e16) p = -1;
    var r = rsi(fechas, 14);
    if (r != null) { if (r > 55) p += 1; else if (r < 45) p -= 1; }
    return { voto: p >= 2 ? 'COMPRA' : (p <= -2 ? 'VENDA' : 'NEUTRO'), soma: p, rsi: r };
  }

  function carregar(ativo) {
    var velho = cache[ativo.par];
    if (velho && Date.now() - velho.t < VAL_MS) return Promise.resolve(velho.votos);

    return Promise.all(TFS.map(function (tf) {
      return fetch('https://api.exchange.coinbase.com/products/' + ativo.par +
        '/candles?granularity=' + tf.g + '&limit=200', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!Array.isArray(j) || j.length < 60) return null;
          var v = j.slice().reverse().map(function (c) { return parseFloat(c[4]); });
          var x = votarTempo(v);
          if (!x) return null;
          x.rot = tf.rot;
          return x;
        })
        .catch(function () { return null; });
    })).then(function (lista) {
      var votos = lista.filter(Boolean);
      cache[ativo.par] = { t: Date.now(), votos: votos };
      return votos;
    });
  }

  function resumir(votos) {
    var c = { COMPRA: 0, VENDA: 0, NEUTRO: 0 };
    votos.forEach(function (v) { c[v.voto]++; });
    var lado = null, n = 0;
    if (c.COMPRA >= 4 && c.COMPRA > c.VENDA) { lado = 'COMPRA'; n = c.COMPRA; }
    else if (c.VENDA >= 4 && c.VENDA > c.COMPRA) { lado = 'VENDA'; n = c.VENDA; }
    return { contagem: c, lado: lado, n: n, total: votos.length,
             texto: lado ? ('ALINHADO ' + lado) : (votos.length ? 'CONFLITO' : '--') };
  }

  /* ---------- pintura: selo do cartão ---------- */
  function aplicar() {
    var cards = document.querySelectorAll('#vx-assets-linha .vx-a-card');
    if (!cards.length) return;

    Promise.all(ATIVOS.map(function (a) {
      return carregar(a).then(function (votos) { return { curto: a.curto, votos: votos, r: resumir(votos) }; })
        .catch(function () { return null; });
    })).then(function (lista) {
      var resumo = {};
      lista.forEach(function (item) {
        if (!item) return;
        resumo[item.curto] = item.r;
        var card = document.querySelector('#vx-assets-linha .vx-a-card[data-curto="' + item.curto + '"]');
        if (!card) return;
        var selo = card.querySelector('.vx-a-vies');
        if (selo && item.r.lado) {
          selo.textContent = item.r.lado + ' ' + item.r.n + '/' + item.r.total;
          selo.className = 'vx-a-vies ' + (item.r.lado === 'COMPRA' ? 'alta' : 'baixa');
        } else if (selo) {
          selo.textContent = item.r.texto;
          selo.className = 'vx-a-vies neutro';
        }
        var detalhe = item.votos.map(function (v) { return v.rot + ' ' + v.voto.toLowerCase(); }).join(' · ');
        card.title = item.curto + ' no código: ' + detalhe;
      });
      ultimo = resumo;
      pintarLinha(resumo);
    });
  }

  function pintarLinha(resumo) {
    var ctx = document.getElementById('vx-ctx-estado');
    if (!ctx) return;
    var alvo = document.getElementById('vx-ctx-ativos');
    if (!alvo) {
      alvo = document.createElement('div');
      alvo.id = 'vx-ctx-ativos';
      alvo.className = 'vx-ctx-ativos';
      ctx.appendChild(alvo);
    }
    var partes = [], compra = 0, venda = 0;
    ['BTC', 'ETH', 'ZEC'].forEach(function (k) {
      var r = resumo[k];
      if (!r) return;
      if (r.lado === 'COMPRA') compra++;
      else if (r.lado === 'VENDA') venda++;
      partes.push('<span class="vx-ma"><u>' + k + '</u>' +
        (r.lado ? '<b class="' + (r.lado === 'COMPRA' ? 'c' : 'v') + '">' + r.lado.toLowerCase() + ' ' + r.n + '/' + r.total + '</b>'
                : '<b class="n">conflito</b>') + '</span>');
    });
    var fecho = compra + venda === 3 ? 'os três concordam' :
      (compra === 2 ? 'dois de três compram' : (venda === 2 ? 'dois de três vendem' : 'os três divergem'));
    alvo.innerHTML = partes.join('') + '<span class="vx-ma-fecho">' + fecho + '</span>';
  }

  function ciclo() { try { aplicar(); } catch (e) {} }

  [2000, 5000, 9000, 15000, 25000, 40000].forEach(function (t) { setTimeout(ciclo, t); });
  // o cartão é redesenhado a cada preço novo: repinta o selo por cima (dados em cache)
  setInterval(ciclo, 1500);

  window.vxMulti = { ler: function () { return ultimo; }, aplicar: aplicar };
})();
