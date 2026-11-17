/* VECTRA · CONTEXTO E DISTÂNCIAS
   O topo para de ser um mural de números soltos. Duas coisas passam a existir:
   1) uma faixa de contexto — o estado do mercado em uma frase, tirada do motor
      do código, com o nível que confirma e o que cancela;
   2) uma faixa de distâncias — quanto o preço está de cada referência que
      importa: EMA 16, EMA 50, borda da faixa e o gatilho do ativo.
   Na coluna lateral, os blocos viram sanfona: abre o que se quer ler. */

(function () {
  'use strict';

  function num(v) { return (v == null || isNaN(v)) ? null : v; }
  function f(v, d) {
    if (v == null || isNaN(v)) return '--';
    return v.toLocaleString('pt-BR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  }
  function sinal(v) { return v >= 0 ? '+' : '−'; }
  function pct(base, alvo) { return base ? (alvo - base) / base * 100 : 0; }

  function tfAtual() {
    var s = document.getElementById('tf-select');
    var v = s ? String(s.value) : '15m';
    // o seletor fala 15m/1h/4h/1D; o snapshot fala 15/60/240/D
    var mapa = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '1D': 'D', '1d': 'D' };
    return mapa[v] || v.replace(/m$/, '') || '15';
  }
  function tfNome() {
    var s = document.getElementById('tf-select');
    return s ? String(s.value) : '15m';
  }
  function simboloAtual() {
    var s = document.getElementById('sym-select');
    return s ? String(s.value) : 'BTCUSDT';
  }
  function gatilhoDoAtivo() {
    var curto = simboloAtual().replace('USDT', '');
    try {
      var s = JSON.parse(localStorage.getItem('vx_niveis') || '{}');
      if (s[curto] && typeof s[curto].gatilho === 'number') return s[curto].gatilho;
    } catch (e) {}
    var padrao = { BTCUSDT: 74100 };
    return padrao[simboloAtual()] || null;
  }

  /* ---------- faixa de contexto ---------- */
  function montarFaixa() {
    var pagina = document.querySelector('.page-col');
    if (!pagina || document.getElementById('vx-contexto')) return;
    var ancora = document.getElementById('vx-assets') || document.getElementById('vx-head');
    var bloco = document.createElement('section');
    bloco.id = 'vx-contexto';
    bloco.innerHTML =
      '<div class="vx-ctx-estado" id="vx-ctx-estado">lendo o motor do código…</div>' +
      '<div class="vx-ctx-dist" id="vx-ctx-dist"></div>';
    if (ancora && ancora.parentNode) ancora.insertAdjacentElement('afterend', bloco);
    else pagina.insertBefore(bloco, pagina.firstChild);
  }

  function pintarFaixa() {
    var estado = document.getElementById('vx-ctx-estado');
    var dist = document.getElementById('vx-ctx-dist');
    if (!estado || !dist) return;
    var s = null;
    try { s = window.vxSnapshot ? window.vxSnapshot({ tf: tfAtual() }) : null; } catch (e) { s = null; }
    if (!s || num(s.preco) == null) { estado.textContent = 'ainda sem leitura deste tempo'; dist.innerHTML = ''; return; }

    var r = null;
    try { r = window.vxMotor ? window.vxMotor.ler() : null; } catch (e) {}

    /* frase de contexto: estado + o que confirma + o que cancela */
    var rot = r ? r.multi : 'LEITURA';
    if (rot === 'CONFLITO') rot = 'SEM CONSENSO';
    var txt = '<b>' + rot + '</b>';
    if (r && r.n) {
      var total = r.votos.length;
      txt += ' <span class="vx-ctx-n">' + r.n + ' de ' + total + ' tempos concordam' +
        (r.lado ? '' : ' — o sinal só fecha com ' + Math.ceil(total * 0.84) + ' de ' + total) + '</span>';
    }
    var vies = s.e8 > s.e16 ? 'acima da EMA 16' : 'abaixo da EMA 16';
    txt += ' <span class="vx-ctx-sep">·</span> no ' + tfNome() + ' o preço está ' + vies;
    if (r && r.lado === 'VENDA') {
      txt += ' <span class="vx-ctx-sep">·</span> confirmando perde <b>' + f(s.lo) + '</b>';
      txt += ' <span class="vx-ctx-sep">·</span> cancela acima de <b>' + f(s.hi) + '</b>';
    } else if (r && r.lado === 'COMPRA') {
      txt += ' <span class="vx-ctx-sep">·</span> confirmando rompe <b>' + f(s.hi) + '</b>';
      txt += ' <span class="vx-ctx-sep">·</span> cancela abaixo de <b>' + f(s.lo) + '</b>';
    }
    estado.innerHTML = txt;

    /* distâncias: quanto falta para cada referência */
    var g = gatilhoDoAtivo();
    var itens = [
      { r: 'EMA 16', v: s.preco - s.e16, base: s.e16 },
      { r: 'EMA 50', v: s.preco - s.e50, base: s.e50 },
      { r: 'suporte', v: s.preco - s.lo, base: s.lo },
      { r: 'resistência', v: s.hi - s.preco, base: s.hi }
    ];
    if (g) itens.push({ r: 'gatilho', v: g - s.preco, base: g, alvo: true });

    dist.innerHTML = itens.map(function (i) {
      var pontos = Math.abs(i.v);
      var perc = Math.abs(pct(i.base, s.preco));
      var cls = 'vx-dist' + (i.alvo ? ' vx-dist-alvo' : '');
      var valor = pontos < 1 ? 'no nível' : f(pontos, 0);
      var sub = pontos < 1 ? 'encostado' : perc.toFixed(2) + '%';
      return '<span class="' + cls + '"><u>' + i.r + '</u>' +
        '<b>' + valor + '</b><s>' + sub + '</s></span>';
    }).join('');
  }

  /* ---------- sanfona dos blocos laterais ---------- */
  function sanfona() {
    ['body-analise', 'body-ia'].forEach(function (id) {
      var corpo = document.getElementById(id);
      if (!corpo || corpo.dataset.acc) return;
      corpo.dataset.acc = '1';
      var secoes = [].slice.call(corpo.querySelectorAll('.sp-sec'));
      secoes.forEach(function (sec, i) {
        var caixa = sec.nextElementSibling;
        if (!caixa || caixa.classList.contains('sp-sec')) return;
        var env = document.createElement('div');
        env.className = 'vx-acc';
        sec.parentNode.insertBefore(env, sec);
        env.appendChild(sec);
        env.appendChild(caixa);
        if (i === 0) env.classList.add('aberto');
        sec.addEventListener('click', function () {
          env.classList.toggle('aberto');
        });
      });
    });
  }

  function ciclo() {
    try { montarFaixa(); pintarFaixa(); sanfona(); } catch (e) {}
  }

  window.vxContexto = { pintar: pintarFaixa };

  [1200, 3500, 7000, 12000, 20000, 30000].forEach(function (t) { setTimeout(ciclo, t); });
  setInterval(function () { try { pintarFaixa(); sanfona(); } catch (e) {} }, 20000);

  ['tf-select', 'sym-select'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', function () { setTimeout(pintarFaixa, 900); });
  });
})();

/* ---------- redutores das duas faixas ---------- */
(function () {
  'use strict';
  var alvos = {
    ativos: { id: 'vx-toggle-ativos', classe: 'vx-sem-ativos', chave: 'vx_faixa_ativos' },
    sinal: { id: 'vx-toggle-sinal', classe: 'vx-sem-sinal', chave: 'vx_faixa_sinal' }
  };

  function aplicar(chaveAlvo, ligado) {
    var cfg = alvos[chaveAlvo];
    document.body.classList.toggle(cfg.classe, !ligado);
    var b = document.getElementById(cfg.id);
    if (b) { b.classList.toggle('vx-off', !ligado); b.setAttribute('aria-pressed', ligado ? 'true' : 'false'); }
    try { localStorage.setItem(cfg.chave, ligado ? 'on' : 'off'); } catch (e) {}
    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 180);
  }

  function ligar() {
    Object.keys(alvos).forEach(function (k) {
      var cfg = alvos[k], b = document.getElementById(cfg.id);
      if (!b || b.dataset.pronto) return;
      b.dataset.pronto = '1';
      var estado = true;
      try { estado = localStorage.getItem(cfg.chave) !== 'off'; } catch (e) {}
      aplicar(k, estado);
      b.addEventListener('click', function () {
        var agora = b.getAttribute('aria-pressed') === 'true';
        aplicar(k, !agora);
      });
    });
  }

  [1500, 3000, 6000, 10000].forEach(function (t) { setTimeout(ligar, t); });
})();
