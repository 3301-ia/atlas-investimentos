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

  /* memória do lado confirmado: exige duas leituras seguidas no lado novo e
     pelo menos 3 minutos desde a última troca, para o selo não ficar piscando */
  var memoria = {};
  var TROCAS = 2, ESPERA_MS = 3 * 60 * 1000, JANELA_MS = 2 * 60 * 1000;
  try { memoria = JSON.parse(localStorage.getItem('vx_multi_memoria') || '{}') || {}; } catch (e) { memoria = {}; }
  Object.keys(memoria).forEach(function (k) { if (['BTC', 'ETH', 'ZEC'].indexOf(k) < 0) delete memoria[k]; });
  function guardar() { try { localStorage.setItem('vx_multi_memoria', JSON.stringify(memoria)); } catch (e) {} }

  function firmar(chave, ladoLido, quando, forca) {
    var m = memoria[chave] || { lado: null, desde: 0, pendente: null, n: 0, pendenteDesde: 0 };
    if (!ladoLido) { m.pendente = null; m.n = 0; m.pendenteDesde = 0; memoria[chave] = m; return m; }
    if (m.lado === ladoLido) { m.pendente = null; m.n = 0; m.pendenteDesde = 0; memoria[chave] = m; return m; }
    // leitura forte (5 ou 6 de 6) entra de primeira: o selo já nasce com o lado
    if (!m.lado && (forca || 0) >= 5) {
      m.lado = ladoLido; m.desde = quando; m.pendente = null; m.n = 0; m.pendenteDesde = 0;
      memoria[chave] = m; guardar(); return m;
    }
    if (m.pendente === ladoLido) {
      // conta uma confirmação por leitura de dados, não por repintura da tela
      if ((quando - (m.ultima || 0)) >= 45000) { m.n = Math.min((m.n || 0) + 1, 9); m.ultima = quando; }
    } else {
      m.pendente = ladoLido; m.n = 1; m.pendenteDesde = quando; m.ultima = quando;
    }
    // troca só com duas leituras no lado novo, separadas por 2 minutos,
    // e no mínimo 3 minutos desde a última troca
    var espalhou = (quando - (m.pendenteDesde || 0)) >= JANELA_MS;
    var liberou = (quando - (m.desde || 0)) >= ESPERA_MS;
    if (m.n >= TROCAS && espalhou && liberou) {
      m.lado = ladoLido; m.desde = quando; m.pendente = null; m.n = 0; m.pendenteDesde = 0;
    }
    memoria[chave] = m;
    guardar();
    return m;
  }

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

  /* O voto de cada tempo soma cinco leituras do próprio código:
     cascata de EMAs (peso 2), RSI 14 (1), estrutura de rompimento (1)
     e momento EMA12-EMA26 contra o sinal (1). Nada de opinião externa. */
  function votarTempo(fechas) {
    var e8 = ema(fechas, 8), e16 = ema(fechas, 16), e50 = ema(fechas, 50);
    if (e8 == null || e16 == null || e50 == null) return null;
    var p = 0, partes = { ema: 0, rsi: 0, est: 0, macd: 0 };

    if (e8 > e16 && e16 > e50) partes.ema = 2;
    else if (e8 > e16) partes.ema = 1;
    else if (e8 < e16 && e16 < e50) partes.ema = -2;
    else if (e8 < e16) partes.ema = -1;

    var r = rsi(fechas, 14);
    if (r != null) { if (r > 55) partes.rsi = 1; else if (r < 45) partes.rsi = -1; }

    // estrutura: fechou acima da máxima das 20 velas anteriores sai compra,
    // perdeu a mínima das 20 sai venda
    if (fechas.length > 24) {
      var ultimo = fechas[fechas.length - 1];
      var cauda = fechas.slice(-21, -1);
      var topo = Math.max.apply(null, cauda), fundo = Math.min.apply(null, cauda);
      if (ultimo > topo) partes.est = 1;
      else if (ultimo < fundo) partes.est = -1;
      else {
        var meio = (topo + fundo) / 2;
        partes.est = ultimo > meio ? 0.5 : -0.5;   // lado da faixa, meio voto
      }
    }

    // momento: EMA 12 contra EMA 26 e contra o próprio sinal
    var e12 = ema(fechas, 12), e26 = ema(fechas, 26);
    if (e12 != null && e26 != null) {
      var m = e12 - e26;
      partes.macd = m > 0 ? 2 : -2;   // acima de zero compra, abaixo vende
    }

    p = partes.ema + partes.rsi + partes.est + partes.macd;
    var lado = p >= 2 ? 'COMPRA' : (p <= -2 ? 'VENDA' : 'NEUTRO');
    return { voto: lado, soma: p, rsi: r, partes: partes };
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
             texto: lado ? ('ALINHADO ' + lado) : (votos.length ? 'SEM CONSENSO' : '--') };
  }

  function trocado(el, chave, valor) {
    el.dataset['vx' + chave] = el.dataset['vx' + chave] || '';
    if (el.dataset['vx' + chave] === valor) return false;
    el.dataset['vx' + chave] = valor;
    return true;
  }

  /* ---------- pintura: selo do cartão ---------- */
  function aplicar() {
    var cards = document.querySelectorAll('#vx-assets-linha .vx-a-card');
    if (!cards.length) return;

    Promise.all(ATIVOS.map(function (a) {
      return carregar(a).then(function (votos) { return { curto: a.curto, votos: votos, r: resumir(votos) }; })
        .catch(function () { return null; });
    })).then(function (lista) {
      var resumo = {}, agora = Date.now();
      lista.forEach(function (item) {
        if (!item) return;
        var m = firmar(item.curto, item.r.lado, agora, item.r.lado === 'COMPRA' ? item.r.contagem.COMPRA : item.r.contagem.VENDA);
        var firme = { lado: m.lado, n: m.lado === 'COMPRA' ? item.r.contagem.COMPRA : item.r.contagem.VENDA };
        resumo[item.curto] = { lado: m.lado, n: firme.n, total: item.r.total,
                               conflito: !m.lado, pendente: m.pendente, votos: item.r.contagem };
        var card = document.querySelector('#vx-assets-linha .vx-a-card[data-curto="' + item.curto + '"]');
        if (!card) return;
        var selo = card.querySelector('.vx-a-vies');
        if (selo) {
          var texto, classe;
          if (m.lado) {
            texto = m.lado + ' ' + firme.n + '/' + item.r.total;
            classe = m.lado === 'COMPRA' ? 'alta' : 'baixa';
            if (m.pendente && m.pendente !== m.lado) texto += ' \u2192 ' + m.pendente.toLowerCase() + ' ' + Math.min(m.n, TROCAS) + '/' + TROCAS;
          } else if (m.pendente) {
            texto = 'abrindo ' + m.pendente.toLowerCase() + ' ' + Math.min(m.n, TROCAS) + '/' + TROCAS;
            classe = 'neutro';
          } else {
            texto = 'sem lado';
            classe = 'neutro';
          }
          if (trocado(card, 'selo', texto)) { selo.textContent = texto; selo.className = 'vx-a-vies ' + classe; }
        }
        var detalhe = item.votos.map(function (v) { return v.rot + ' ' + v.voto.toLowerCase(); }).join(' · ');
        var nota = (m.lado ? 'firme em ' + m.lado.toLowerCase() : 'sem lado firme') +
          (m.pendente && m.pendente !== m.lado ? ' · virando para ' + m.pendente.toLowerCase() + ' (' + m.n + ' de ' + TROCAS + ')' : '');
        var titulo = item.curto + ' · ' + nota + '\n' + detalhe;
        if (card.title !== titulo) card.title = titulo;
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
    var partes = [], compra = 0, venda = 0, comLado = [];
    ['BTC', 'ETH', 'ZEC'].forEach(function (k) {
      var r = resumo[k];
      if (!r) return;
      if (r.lado === 'COMPRA') { compra++; comLado.push(k); }
      else if (r.lado === 'VENDA') { venda++; comLado.push(k); }
      partes.push('<span class="vx-ma"><u>' + k + '</u>' +
        (r.lado ? '<b class="' + (r.lado === 'COMPRA' ? 'c' : 'v') + '">' + r.lado.toLowerCase() + ' ' + r.n + '/' + r.total + '</b>'
                : '<b class="n">' + (r.pendente ? 'virando ' + r.pendente.toLowerCase() : 'sem lado') + '</b>') + '</span>');
    });
    var fecho;
    if (compra === 3) fecho = 'os três compram';
    else if (venda === 3) fecho = 'os três vendem';
    else if (compra === 2 && venda === 0) fecho = 'dois de três compram';
    else if (venda === 2 && compra === 0) fecho = 'dois de três vendem';
    else if (comLado.length === 1) fecho = 'só o ' + comLado[0] + ' tem lado; os outros dois estão divididos';
    else if (comLado.length === 0) fecho = 'nenhum dos três tem lado ainda';
    else fecho = 'dois com lado, um dividido';
    alvo.innerHTML = partes.join('') + '<span class="vx-ma-fecho">' + fecho + '</span>';
  }

  function ciclo() { try { aplicar(); } catch (e) {} }

  [2000, 5000, 9000, 15000, 25000, 40000].forEach(function (t) { setTimeout(ciclo, t); });
  // o cartão é redesenhado a cada preço novo: repinta o selo por cima (dados em cache)
  setInterval(ciclo, 1500);

  window.vxMulti = { ler: function () { return ultimo; }, aplicar: aplicar, firmar: firmar, memoria: function () { return memoria; } };
})();
