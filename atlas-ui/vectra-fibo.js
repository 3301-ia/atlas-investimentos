/* VECTRA · FIBO DO CRUZAMENTO (regra do Lucas)
   A Fibonacci não nasce de um topo e fundo quaisquer: nasce do cruzamento
   das médias 8 e 16.

     antes do cruzamento o preço deixa a máxima (queda) ou a mínima (alta)  -> ponto 0
     depois do cruzamento ele deixa a mínima (queda) ou a máxima (alta)     -> ponto 1

   A perna vai de 0 a 1. Dentro dela ficam 0,382 / 0,5 / 0,618 / 0,786
   (retração, o preço voltando contra o movimento). Acima de 1 vem a
   progressão: 1,272 e 1,618, que é onde o movimento costuma mirar.
   Se o preço rejeita a progressão simétrica e volta para dentro de 1, a
   perna perdeu força; se ele surfa acima de 1, está perseguindo o 1,618. */
(function () {
  'use strict';

  var NIVEIS = [-0.618, -0.272, 0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
  var DESENHA = [0, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
  var DESENHA_NEG = [-0.272, -0.618];
  var linhas = [], assinatura = '', ultimo = null;
  var ligado = localStorage.getItem('vx_fibo_linhas') !== '0';

  function ema(v, n) {
    if (!v || v.length < n) return null;
    var a = 2 / (n + 1), e = 0, i;
    for (i = 0; i < n; i++) e += v[i];
    e /= n;
    var out = new Array(v.length).fill(null);
    out[n - 1] = e;
    for (i = n; i < v.length; i++) { e = v[i] * a + e * (1 - a); out[i] = e; }
    return out;
  }

  /* acha os cruzamentos e monta a perna de cada um */
  function pernas(velas) {
    var c = velas.map(function (v) { return v.close; });
    var e8 = ema(c, 8), e16 = ema(c, 16);
    if (!e8 || !e16) return [];
    var cruzes = [], i;
    for (i = 1; i < c.length; i++) {
      if (e8[i] == null || e16[i] == null || e8[i - 1] == null || e16[i - 1] == null) continue;
      if (e8[i - 1] <= e16[i - 1] && e8[i] > e16[i]) cruzes.push({ i: i, dir: 'alta' });
      else if (e8[i - 1] >= e16[i - 1] && e8[i] < e16[i]) cruzes.push({ i: i, dir: 'baixa' });
    }
    return cruzes.map(function (cr, k) {
      var inicio = k > 0 ? cruzes[k - 1].i : Math.max(0, cruzes[k].i - 96);
      var fim = k < cruzes.length - 1 ? cruzes[k + 1].i : velas.length - 1;
      var p0, p1, j;
      if (cr.dir === 'baixa') {
        p0 = -Infinity;
        for (j = inicio; j <= cr.i; j++) p0 = Math.max(p0, velas[j].high);
        p1 = Infinity;
        for (j = cr.i; j <= fim; j++) p1 = Math.min(p1, velas[j].low);
      } else {
        p0 = Infinity;
        for (j = inicio; j <= cr.i; j++) p0 = Math.min(p0, velas[j].low);
        p1 = -Infinity;
        for (j = cr.i; j <= fim; j++) p1 = Math.max(p1, velas[j].high);
      }
      if (!isFinite(p0) || !isFinite(p1) || p0 === p1) return null;
      return { dir: cr.dir, i: cr.i, tempo: velas[cr.i].time, p0: p0, p1: p1, aberta: k === cruzes.length - 1 };
    }).filter(Boolean);
  }

  function preco(perna, nivel) {
    var d = perna.p1 - perna.p0;
    return perna.p0 + d * nivel;
  }

  /* onde o preço está na perna (0 = início, 1 = fim, >1 = progressão) */
  function posicao(perna, p) {
    var d = perna.p1 - perna.p0;
    return d === 0 ? 0 : (p - perna.p0) / d;
  }

  function faixaTexto(perna, pos) {
    if (pos < 0) return 'perdeu o zero — a perna virou, agora joga nos pontos negativos';
    if (pos <= 0.236) return 'no 0,236 — voltando para o início da perna';
    if (pos <= 0.382) return 'no 0,382';
    if (pos <= 0.5) return 'entre 0,382 e 0,5';
    if (pos <= 0.618) return 'no 0,5–0,618 — a região que decide';
    if (pos <= 0.786) return 'no 0,786 — retração profunda';
    if (pos <= 1) return 'entre 0,786 e 1 — retração quase completa';
    if (pos <= 1.272) return 'acima de 1 — surfando na progressão, mirando 1,618';
    if (pos <= 1.618) return 'na progressão 1,272–1,618';
    return 'passou de 1,618 — progressão estendida';
  }

  function leitura() {
    var velas = (typeof candles !== 'undefined' && candles && candles.length) ? candles : null;
    if (!velas || velas.length < 40) return null;
    var ps = pernas(velas);
    if (!ps.length) return null;
    var perna = ps[ps.length - 1];
    var p = velas[velas.length - 1].close;
    var pos = posicao(perna, p);
    var seq = ps.slice(-4).map(function (x) { return { dir: x.dir, tempo: x.tempo }; });
    return {
      dir: perna.dir, tempo: perna.tempo, tf: (typeof currentTF !== 'undefined' ? currentTF : ''),
      p0: perna.p0, p1: perna.p1, preco: p, pos: pos,
      alvo: preco(perna, 1.618), invalida: perna.dir === 'baixa' ? perna.p0 : perna.p0,
      niveis: NIVEIS.map(function (n) { return { n: n, v: preco(perna, n) }; }),
      texto: faixaTexto(perna, pos), pernas: ps.length,
      seq: seq,
      zero: perna.p0,
      perdeuZero: pos < 0,
    };
  }

  /* ---------- desenho no gráfico ---------- */
  function limpar() {
    try {
      linhas.forEach(function (l) { try { candleSeries.removePriceLine(l); } catch (e) {} });
    } catch (e) {}
    linhas = [];
  }

  function desenhar(r) {
    if (typeof candleSeries === 'undefined' || !candleSeries) return;
    limpar();
    if (!ligado || !r) return;
    var cor = r.dir === 'baixa' ? 'rgba(239,83,80,.75)' : 'rgba(38,166,154,.75)';
    if (r.perdeuZero) {
      DESENHA_NEG.forEach(function (n) {
        try {
          linhas.push(candleSeries.createPriceLine({
            price: preco(r, n), color: 'rgba(140,150,165,.85)', lineWidth: 1, lineStyle: 2,
            axisLabelVisible: true, title: 'fib ' + String(n).replace('.', ',')
          }));
        } catch (e) {}
      });
    }
    DESENHA.forEach(function (n) {
      var v = preco(r, n), forte = (n === 0 || n === 1 || n === 0.618);
      try {
        linhas.push(candleSeries.createPriceLine({
          price: v,
          color: forte ? '#d9b45b' : cor,
          lineWidth: forte ? 2 : 1,
          lineStyle: n === 1 ? 0 : 2,
          axisLabelVisible: true,
          title: 'fib ' + String(n).replace('.', ',')
        }));
      } catch (e) {}
    });
  }

  /* ---------- cartão de leitura ---------- */
  function formatar(v) {
    return (v >= 1000 ? v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                      : v.toFixed(2));
  }

  function cartao(r) {
    var host = document.getElementById('vx-work');
    if (!host) return null;
    var el = document.getElementById('vx-fibo');
    if (!el) {
      el = document.createElement('section');
      el.id = 'vx-fibo';
      el.className = 'vx-fibo';
      var antes = document.getElementById('vx-avisos');
      if (antes && antes.parentNode === host) host.insertBefore(el, antes); else host.appendChild(el);
    }
    if (!r) { el.innerHTML = '<div class="vx-fibo-h"><h3>Fibo do cruzamento</h3><span>sem leitura</span></div>'; return el; }
    var cor = r.dir === 'baixa' ? '#ef5350' : '#26a69a';
    var niveis = [0.382, 0.5, 0.618, 1, 1.618].map(function (n) {
      var v = preco(r, n), perto = Math.abs(r.pos - n) < 0.06;
      return '<span class="vx-fibo-niv' + (perto ? ' perto' : '') + '">' + String(n).replace('.', ',') +
             ' <b>' + formatar(v) + '</b></span>';
    }).join('');
    if (r.perdeuZero) {
      niveis += [-0.272, -0.618].map(function (n) {
        return '<span class="vx-fibo-niv negativo">' + String(n).replace('.', ',') +
               ' <b>' + formatar(preco(r, n)) + '</b></span>';
      }).join('');
    }
    var hora = function (t) {
      var d = new Date(t * 1000);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', timeZone: 'America/Sao_Paulo' }) + '/' +
             d.toLocaleDateString('pt-BR', { month: '2-digit', timeZone: 'America/Sao_Paulo' }) + ' ' +
             d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    };
    var seq = (r.seq || []).map(function (x) {
      return '<span class="vx-fibo-cz ' + x.dir + '">' + x.dir.slice(0, 1).toUpperCase() + ' ' + hora(x.tempo) + '</span>';
    }).join('');
    var nomeZero = r.dir === 'baixa' ? 'máxima anterior ao cruzamento' : 'fundo anterior ao cruzamento';
    var nomeUm = r.dir === 'baixa' ? 'mínima depois do cruzamento' : 'topo depois do cruzamento';
    el.innerHTML =
      '<div class="vx-fibo-h"><h3>Fibo do cruzamento</h3>' +
        '<button id="vx-fibo-olho" title="mostrar ou esconder as linhas">' + (ligado ? 'linhas on' : 'linhas off') + '</button></div>' +
      '<div class="vx-fibo-corpo">' +
        '<div class="vx-fibo-perna" style="border-left:3px solid ' + cor + '">' +
          '<span>perna de <b style="color:' + cor + '">' + r.dir + '</b> · ' + r.tf + '</span>' +
          '<span>0 <b>' + formatar(r.p0) + '</b> <i>' + nomeZero + '</i></span>' +
          '<span>1 <b>' + formatar(r.p1) + '</b> <i>' + nomeUm + '</i></span>' +
        '</div>' +
        '<div class="vx-fibo-pos">' + r.texto + '</div>' +
        '<div class="vx-fibo-niveis">' + niveis + '</div>' +
        '<div class="vx-fibo-rule">a perna só morre quando perde o <b>0</b> em ' + formatar(r.p0) + '</div>' +
        (seq ? '<div class="vx-fibo-seq">' + seq + '</div>' : '') +
      '</div>';
    var olho = document.getElementById('vx-fibo-olho');
    if (olho) olho.onclick = function () {
      ligado = !ligado;
      try { localStorage.setItem('vx_fibo_linhas', ligado ? '1' : '0'); } catch (e) {}
      olho.textContent = ligado ? 'linhas on' : 'linhas off';
      desenhar(ultimo);
    };
    return el;
  }

  function ciclo() {
    try {
      var r = leitura();
      ultimo = r;
      var assinaturaNova = r ? [r.tf, r.dir, Math.round(r.p0), Math.round(r.p1), Math.round(r.preco)].join('|') : 'vazio';
      if (assinaturaNova !== assinatura) {
        assinatura = assinaturaNova;
        desenhar(r);
        cartao(r);
      }
    } catch (e) {}
  }

  [1500, 4000, 8000, 14000, 22000, 32000, 45000].forEach(function (t) { setTimeout(ciclo, t); });
  setInterval(ciclo, 5000);

  window.vxFibo = {
    ler: leitura,
    pernas: function () {
      return (typeof candles !== 'undefined' && candles && candles.length) ? pernas(candles) : [];
    },
    linhas: function () { return linhas.length; },
    alternar: function () { ligado = !ligado; try { localStorage.setItem('vx_fibo_linhas', ligado ? '1' : '0'); } catch (e) {} desenhar(ultimo); return ligado; }
  };
})();
