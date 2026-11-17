/* VECTRA · MOTOR DO CÓDIGO
   O consenso deixa de ser opinião da IA: cada tempo é votado pelos números que
   o próprio painel calcula (cascata EMA 8/16/50, RSI 14 e a dominância do
   indicador). A IA, quando chamada, escreve a frase — não decide o voto.

   Regra do voto (soma de evidências):
     EMA   e8>e16>e50 = +2   e8>e16 = +1   e8<e16 = -1   e8<e16<e50 = -2
     RSI   >55 = +1          <45 = -1      entre = 0
     DOM   buy = +1          sell = -1     flat = 0
     soma >= +2 -> COMPRA | soma <= -2 -> VENDA | resto -> NEUTRO
   SINAL MULTI: 5 ou 6 tempos no mesmo lado = ALINHADO; 4 ou menos = CONFLITO. */

(function () {
  'use strict';

  var TFS = [
    { id: 'm1', tf: '1', rot: '1M' },
    { id: 'm5', tf: '5', rot: '5M' },
    { id: 'm15', tf: '15', rot: '15M' },
    { id: 'h1', tf: '60', rot: '1H' },
    { id: 'h4', tf: '240', rot: '4H' },
    { id: 'd1', tf: 'D', rot: '1D' }
  ];

  function num(v) { return (v == null || isNaN(v)) ? null : v; }

  /* um tempo: le o snapshot do painel e devolve voto + componentes */
  function votarTempo(a) {
    if (typeof window.vxSnapshot !== 'function') return null;
    var s = null;
    try { s = window.vxSnapshot({ tf: a.tf }); } catch (e) { return null; }
    if (!s || num(s.preco) == null) return null;

    var pEma = 0, sEma = 'plana';
    if (s.e8 > s.e16 && s.e16 > s.e50) { pEma = 2; sEma = 'alta'; }
    else if (s.e8 > s.e16) { pEma = 1; sEma = 'virando p/ alta'; }
    else if (s.e8 < s.e16 && s.e16 < s.e50) { pEma = -2; sEma = 'baixa'; }
    else if (s.e8 < s.e16) { pEma = -1; sEma = 'virando p/ baixa'; }

    var pRsi = s.rsi > 55 ? 1 : (s.rsi < 45 ? -1 : 0);
    var pDom = s.dom === 'buy' ? 1 : (s.dom === 'sell' ? -1 : 0);

    var soma = pEma + pRsi + pDom;
    var voto = soma >= 2 ? 'COMPRA' : (soma <= -2 ? 'VENDA' : 'NEUTRO');

    return {
      id: a.id, rot: a.rot, voto: voto, soma: soma,
      preco: s.preco, e8: s.e8, e16: s.e16, e50: s.e50, rsi: s.rsi,
      dom: s.dom, pos: s.pos, hi: s.hi, lo: s.lo, ema: sEma,
      partes: { ema: pEma, rsi: pRsi, dom: pDom }
    };
  }

  function ler() {
    var votos = TFS.map(votarTempo).filter(Boolean);
    var c = { COMPRA: 0, VENDA: 0, NEUTRO: 0 };
    votos.forEach(function (v) { c[v.voto]++; });
    var multi = 'NEUTRO', lado = null, n = 0;
    if (c.COMPRA >= 5) { multi = 'ALINHADO COMPRA'; lado = 'COMPRA'; n = c.COMPRA; }
    else if (c.VENDA >= 5) { multi = 'ALINHADO VENDA'; lado = 'VENDA'; n = c.VENDA; }
    else if (c.COMPRA + c.VENDA > 0) { multi = 'CONFLITO'; n = Math.max(c.COMPRA, c.VENDA); }
    return { votos: votos, contagem: c, multi: multi, lado: lado, n: n };
  }

  /* ---------- pintura ---------- */

  function corDoVoto(v) {
    return v === 'COMPRA' ? '#26a69a' : v === 'VENDA' ? '#ef5350' : '#8a8f98';
  }

  function pintar() {
    var r = ler();
    if (!r.votos.length) return r;

    r.votos.forEach(function (v) {
      var el = document.getElementById('vx-vd-' + v.id);
      if (el) {
        el.textContent = v.voto;
        el.style.color = corDoVoto(v.voto);
        el.style.fontSize = '9px';
      }
      var card = document.getElementById('vx-ag-' + v.id);
      if (card) {
        card.style.borderColor = v.voto === 'COMPRA' ? 'rgba(38,166,154,.45)'
          : v.voto === 'VENDA' ? 'rgba(239,83,80,.45)' : 'var(--bd2)';
        var comp = card.querySelector('.vx-ag-comp');
        if (!comp) {
          comp = document.createElement('div');
          comp.className = 'vx-ag-comp';
          card.appendChild(comp);
        }
        comp.innerHTML =
          '<span>EMA <b>' + v.ema + '</b></span>' +
          '<span>RSI <b>' + v.rsi.toFixed(0) + '</b></span>' +
          '<span>DOM <b>' + (v.dom || 'flat') + '</b></span>' +
          '<span>faixa <b>' + (v.pos == null ? '--' : v.pos + '%') + '</b></span>';
      }
    });

    /* selo e nota de origem */
    var sec = document.getElementById('vx-ciclo-estado');
    if (sec && !sec.dataset.motor) {
      sec.dataset.motor = '1';
      sec.insertAdjacentHTML('beforebegin',
        '<span class="vx-motor-selo" id="vx-motor-selo" title="Veredito calculado no painel, não pela IA">motor do código</span> ');
    }
    var box = document.getElementById('vx-agentes');
    if (box && !document.getElementById('vx-motor-nota')) {
      box.insertAdjacentHTML('afterend',
        '<div class="vx-motor-nota" id="vx-motor-nota"></div>');
    }
    var nota = document.getElementById('vx-motor-nota');
    if (nota) {
      nota.innerHTML = 'O consenso vem daqui: cada tempo vota pelo que o painel calcula — ' +
        'cascata EMA 8/16/50 (peso 2), RSI 14 (peso 1) e dominância do indicador (peso 1). ' +
        'Soma +2 ou mais é compra, −2 ou menos é venda, o resto é neutro. ' +
        'Agora: <b>' + r.multi + '</b>' + (r.n ? ' com ' + r.n + ' de ' + r.votos.length : '') + '. ' +
        'A IA só escreve a frase, não muda o voto.';
    }
    return r;
  }

  function ciclo() { try { pintar(); } catch (e) {} }

  window.vxMotor = { ler: ler, pintar: pintar, votarTempo: votarTempo };

  /* o painel carrega os tempos em ondas: repinta algumas vezes e depois fica no relogio */
  [1500, 4000, 8000, 14000, 22000].forEach(function (t) { setTimeout(ciclo, t); });
  setInterval(ciclo, 30000);
})();
