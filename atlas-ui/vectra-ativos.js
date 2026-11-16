/* VECTRA · MESA DE ATIVOS
   Os tres ativos que o robo vigia: Bitcoin, Ethereum, Zcash.
   Preco, variacao 24h, vies das EMAs e nivel de referencia de cada um.
   Niveis ficam salvos no navegador (vx_niveis) e podem ser trocados a qualquer momento. */

(function () {
  'use strict';

  var ATIVOS = [
    { sym: 'BTCUSDT', par: 'BTC-USD', curto: 'BTC', nome: 'Bitcoin', gatilho: 74100, termometro: 72511 },
    { sym: 'ETHUSDT', par: 'ETH-USD', curto: 'ETH', nome: 'Ethereum', gatilho: null, termometro: null },
    { sym: 'ZECUSDT', par: 'ZEC-USD', curto: 'ZEC', nome: 'Zcash', gatilho: null, termometro: null }
  ];

  var CHAVE = 'vx_niveis';

  function lerNiveis() {
    try {
      var s = JSON.parse(localStorage.getItem(CHAVE) || '{}');
      ATIVOS.forEach(function (a) {
        if (s[a.curto] && typeof s[a.curto].gatilho === 'number') a.gatilho = s[a.curto].gatilho;
        if (s[a.curto] && typeof s[a.curto].termometro === 'number') a.termometro = s[a.curto].termometro;
      });
    } catch (e) {}
  }

  function salvarNiveis() {
    var s = {};
    ATIVOS.forEach(function (a) { s[a.curto] = { gatilho: a.gatilho, termometro: a.termometro }; });
    try { localStorage.setItem(CHAVE, JSON.stringify(s)); } catch (e) {}
  }

  function fmt(v) {
    if (v == null || isNaN(v)) return '--';
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtCurto(v) {
    if (v == null || isNaN(v)) return '--';
    return v >= 1000 ? v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : fmt(v);
  }

  /* ---------- desenho ---------- */

  function montar() {
    var pagina = document.querySelector('.page-col');
    if (!pagina || document.getElementById('vx-assets')) return;
    var barra = document.createElement('section');
    barra.id = 'vx-assets';
    barra.innerHTML = '<div class="vx-assets-top"><span class="vx-assets-titulo">Ativos vigiados pelo robô</span>' +
      '<span class="vx-assets-nota">clique no ativo para abrir o gráfico · clique no nível para trocar</span></div>' +
      '<div class="vx-assets-linha" id="vx-assets-linha"></div>';
    var cabecalho = document.getElementById('vx-head');
    if (cabecalho && cabecalho.parentNode) cabecalho.insertAdjacentElement('afterend', barra);
    else pagina.insertBefore(barra, pagina.firstChild);
    pintar();
    buscar();
    setInterval(buscar, 25000);
  }

  function pintar() {
    var linha = document.getElementById('vx-assets-linha');
    if (!linha) return;
    linha.innerHTML = ATIVOS.map(function (a) {
      var preco = a.preco;
      var var24 = a.var24;
      var vies = a.vies || '—';
      var classeVies = vies === 'compra' ? 'alta' : (vies === 'venda' ? 'baixa' : 'neutro');
      var dist = (preco != null && a.gatilho) ? (a.gatilho - preco) : null;
      var nivelHtml;
      if (a.gatilho) {
        nivelHtml = '<span class="vx-a-num">' + fmtCurto(a.gatilho) + '</span>' +
          '<span class="vx-a-dist ' + (dist != null && dist <= 0 ? 'passou' : '') + '">' +
          (dist == null ? '--' : (dist > 0 ? fmtCurto(dist) + ' abaixo' : fmtCurto(Math.abs(dist)) + ' acima')) + '</span>';
      } else {
        nivelHtml = '<span class="vx-a-vazio">definir nível</span>';
      }
      return '<article class="vx-a-card" data-sym="' + a.sym + '" data-curto="' + a.curto + '">' +
        '<header><b>' + a.curto + '</b><small>' + a.nome + '</small>' +
        '<i class="vx-a-vies ' + classeVies + '">' + vies + '</i></header>' +
        '<div class="vx-a-preco">' + (preco == null ? '--' : fmt(preco)) +
        '<span class="vx-a-var ' + (var24 == null ? '' : (var24 >= 0 ? 'alta' : 'baixa')) + '">' +
        (var24 == null ? '--' : (var24 >= 0 ? '+' : '') + var24.toFixed(2) + '%') + '</span></div>' +
        '<div class="vx-a-nivel" data-nivel="' + a.curto + '" title="Clique para definir o gatilho">' +
        '<u>gatilho</u>' + nivelHtml + '</div>' +
        '</article>';
    }).join('');

    Array.prototype.forEach.call(linha.querySelectorAll('.vx-a-card'), function (card) {
      card.addEventListener('click', function (ev) {
        if (ev.target.closest('[data-nivel]')) return;
        if (typeof window.changeSym === 'function') window.changeSym(card.getAttribute('data-sym'));
      });
    });
    Array.prototype.forEach.call(linha.querySelectorAll('[data-nivel]'), function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var curto = el.getAttribute('data-nivel');
        var ativo = ATIVOS.filter(function (a) { return a.curto === curto; })[0];
        if (!ativo) return;
        var resp = window.prompt('Gatilho do ' + ativo.nome + ' em US$ (deixe vazio para apagar)', ativo.gatilho || '');
        if (resp === null) return;
        ativo.gatilho = resp.trim() === '' ? null : Number(String(resp).replace(/[^\d.]/g, ''));
        salvarNiveis();
        pintar();
      });
    });
  }

  /* ---------- dados ---------- */

  function lerCoinbase(a) {
    return fetch('https://api.exchange.coinbase.com/products/' + a.par + '/stats', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.last) return null;
        var preco = parseFloat(j.last);
        var ab = parseFloat(j.open);
        return { preco: preco, var24: ab ? ((preco - ab) / ab) * 100 : null };
      })
      .catch(function () { return null; });
  }

  function lerBinance(a) {
    return fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=' + a.sym, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.lastPrice) return null;
        return { preco: parseFloat(j.lastPrice), var24: parseFloat(j.priceChangePercent) };
      })
      .catch(function () { return null; });
  }

  function buscar() {
    ATIVOS.forEach(function (a) {
      lerCoinbase(a).then(function (d) { return d || lerBinance(a); }).then(function (d) {
        if (d && d.preco) { a.preco = d.preco; a.var24 = d.var24; }
        pintar();
      });
    });
    if (contadorVies++ % 2 === 0) vies();
  }

  var contadorVies = 0;

  /* vies de cada ativo pelas EMAs 8/16 das velas de 15 minutos dele */
  function vies() {
    ATIVOS.forEach(function (a) {
      fetch('https://api.exchange.coinbase.com/products/' + a.par + '/candles?granularity=900&limit=40', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!Array.isArray(j) || j.length < 20) return;
          var velas = j.slice().reverse().map(function (c) { return parseFloat(c[4]); });
          var e8 = media(velas.slice(-8)), e16 = media(velas.slice(-16));
          a.vies = e8 > e16 ? 'compra' : (e8 < e16 ? 'venda' : 'neutro');
          pintar();
        })
        .catch(function () {});
    });
  }

  function media(v) {
    if (!v.length) return null;
    return v.reduce(function (s, x) { return s + x; }, 0) / v.length;
  }

  function viesAntigo() {
    try {
      var tfs = (typeof mtfData !== 'undefined' && mtfData) ? mtfData : null;
      if (!tfs) return;
      var dirs = {};
      Object.keys(tfs).forEach(function (k) {
        var c = tfs[k];
        if (!c || c.length < 20) return;
        var e8 = emaSimples(c, 8), e16 = emaSimples(c, 16);
        if (e8 == null || e16 == null) return;
        dirs[k] = e8 > e16 ? 'compra' : (e8 < e16 ? 'venda' : 'neutro');
      });
      ATIVOS.forEach(function (a) { if (!a.vies) a.vies = dirs['15'] || null; });
    } catch (e) {}
  }

  function emaSimples(velas, n) {
    if (!velas || velas.length < n) return null;
    var soma = 0;
    for (var i = velas.length - n; i < velas.length; i++) soma += parseFloat(velas[i].close);
    return soma / n;
  }

  lerNiveis();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(montar, 900); });
  else setTimeout(montar, 900);
  window.vxAtivos = { ativos: ATIVOS, buscar: buscar, salvar: salvarNiveis };
})();
