/* VECTRA · DOMINÂNCIA DE MERCADO
   BTC.D, ETH.D e ZEC.D — participação real de cada ativo no valor total do
   mercado, não o placar interno do painel.
   Fonte: CoinPaprika (CORS aberto); reserva: CoinGecko. */

(function () {
  'use strict';

  var total = null, zecCap = null;

  function f1(v) {
    return v == null || isNaN(v) ? '--' : v.toFixed(1).replace('.', ',') + '%';
  }

  function pintar(id, valor, titulo) {
    var box = document.getElementById('kpi-' + id);
    if (!box) return;
    var b = box.querySelector('b'), s = box.querySelector('small');
    if (b) b.textContent = f1(valor);
    if (s) s.textContent = titulo || '';
    box.title = (titulo || '') + (valor == null ? '' : ' · ' + f1(valor));
  }

  function cap(id) {
    return fetch('https://api.coinpaprika.com/v1/tickers/' + id + '?quotes=USD', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && j.quotes && j.quotes.USD) ? j.quotes.USD.market_cap : null; })
      .catch(function () { return null; });
  }

  function papel() {
    return Promise.all([
      fetch('https://api.coinpaprika.com/v1/global', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      cap('eth-ethereum'),
      cap('zec-zcash')
    ]).then(function (res) {
      var g = res[0], ethCap = res[1], zecCap = res[2];
      if (!g || !g.market_cap_usd) return null;
      var tot = g.market_cap_usd;
      return {
        btc: g.bitcoin_dominance_percentage != null ? g.bitcoin_dominance_percentage : null,
        eth: ethCap ? (ethCap / tot) * 100 : (g.ethereum_dominance_percentage || null),
        zec: zecCap ? (zecCap / tot) * 100 : null,
        total: tot
      };
    });
  }

  function reserva() {
    return Promise.all([
      fetch('https://api.coingecko.com/api/v3/global', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=zcash', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var g = res[0] && res[0].data, zc = res[1] && res[1][0];
      if (!g || !g.market_cap_percentage) return null;
      var p = g.market_cap_percentage;
      var tot = g.total_market_cap && g.total_market_cap.usd;
      return {
        btc: p.btc, eth: p.eth,
        zec: (zc && zc.market_cap && tot) ? (zc.market_cap / tot) * 100 : null
      };
    });
  }

  function atualizar() {
    papel().then(function (d) { return d || reserva(); }).then(function (d) {
      if (!d) return;
      pintar('btcdom', d.btc, 'do mercado');
      pintar('ethdom', d.eth, 'do mercado');
      pintar('zecdom', d.zec, 'do mercado');
      window.__vxDominancia = d;
    }).catch(function () {});
  }

  [9000, 12000, 20000, 35000].forEach(function (t) { setTimeout(atualizar, t); });
  setInterval(atualizar, 120000);

  window.vxDominancia = { atualizar: atualizar };
})();
