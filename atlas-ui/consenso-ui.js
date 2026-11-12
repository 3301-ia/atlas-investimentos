// Consenso de microtempo na tela.
//
// Le 30s, 1m e 15m direto da exchange, roda o FIB automatico em cada um e
// mostra o que os tres concordam. O calculo todo mora em core/consenso.js e
// core/fibonacci.js; aqui so tem leitura, desenho e o botao de sinais.

(function () {
  'use strict';

  var CARD = null, CORPO = null, TIMER = null, ULTIMO = null;
  var ABERTO = false, MOSTRAR_SINAIS = false;
  var TEMPOS = ['30s', '1m', '15m'];
  var CACHE = {};
  var VERDE = '#2ECC8F', VERMELHO = '#E2564D', OURO = '#D9B45B', CINZA = '#8a97a8';
  var core = null, fib = null;

  function carregar() {
    if (core) return Promise.resolve(core);
    return Promise.all([import('./core/consenso.js'), import('./core/fibonacci.js')])
      .then(function (m) { core = m[0]; fib = m[1]; return core; })
      .catch(function () { return null; });
  }

  function velas(tempo) {
    return CACHE[tempo] || [];
  }

  function buscar(tempo) {
    var bar = tempo === '30s' ? '30s' : tempo;
    return fetch('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=' + bar + '&limit=300', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var d = (j && j.data) || [];
        CACHE[tempo] = d.map(function (c) {
          return { t: +c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] };
        }).reverse();
        return CACHE[tempo];
      })
      .catch(function () { return CACHE[tempo] || []; });
  }

  function atualizar() {
    if (!ABERTO && !document.getElementById('consenso-chip')) return;
    carregar().then(function (c) {
      if (!c) return;
      return Promise.all(TEMPOS.map(buscar)).then(function () {
        var series = {};
        TEMPOS.forEach(function (t) { if (velas(t).length > 40) series[t] = velas(t); });
        if (!Object.keys(series).length) return;
        var r = null;
        try { r = c.consenso(series); } catch (e) { r = null; }
        ULTIMO = r;
        pintar(r);
      });
    });
  }

  function linha(rotulo, valor, cor) {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:5px 0;' +
      'border-bottom:1px solid rgba(255,255,255,.04);font:11px/1.35 ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums';
    var a = document.createElement('span');
    a.textContent = rotulo; a.style.color = '#76818f'; a.style.letterSpacing = '.04em';
    var b = document.createElement('span');
    b.textContent = valor; b.style.color = cor || '#e6edf3'; b.style.fontWeight = '600';
    d.appendChild(a); d.appendChild(b);
    return d;
  }

  function fmt(v, casas) {
    if (v == null || !isFinite(v)) return '--';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas == null ? 2 : casas, maximumFractionDigits: casas == null ? 2 : casas });
  }

  function pintar(r) {
    if (!CORPO) return;
    CORPO.innerHTML = '';
    if (!r) { CORPO.appendChild(linha('ESTADO', 'sem dados', CINZA)); return; }

    var cor = r.lado === 'compra' ? VERDE : (r.lado === 'venda' ? VERMELHO : CINZA);
    var faixa = document.createElement('div');
    faixa.style.cssText = 'margin-bottom:10px;padding:7px 8px;border-radius:7px;text-align:center;letter-spacing:.08em;' +
      'font:700 11px ui-monospace,Consolas,monospace;background:' +
      (r.lado === 'compra' ? 'rgba(46,204,143,.10)' : (r.lado === 'venda' ? 'rgba(226,86,77,.10)' : 'rgba(138,151,168,.10)')) + ';color:' + cor;
    faixa.textContent = (r.lado ? r.lado.toUpperCase() : 'SEM CONSENSO') + ' · ' + String(r.estado).toUpperCase();
    CORPO.appendChild(faixa);

    CORPO.appendChild(linha('FORÇA', r.forca + ' de 6 · ' + r.acordo + '/' + r.temposLidos + ' tempos', cor));
    if (r.gatilho) {
      CORPO.appendChild(linha('GATILHO (' + r.gatilho.tempo + ')', fmt(r.gatilho.entrada), cor));
      CORPO.appendChild(linha('STOP', fmt(r.gatilho.stop), VERMELHO));
      CORPO.appendChild(linha('ALVO', fmt(r.gatilho.alvo) + (r.gatilho.rr ? ' · ' + r.gatilho.rr + 'R' : ''), VERDE));
    }
    CORPO.appendChild(linha('MOTIVO', r.motivo, CINZA));

    var sep = document.createElement('div');
    sep.style.cssText = 'margin:8px 0 4px;font:9px ui-monospace,Consolas,monospace;color:#4e5866;letter-spacing:.12em';
    sep.textContent = 'POR TEMPO';
    CORPO.appendChild(sep);

    r.leituras.forEach(function (l) {
      var corL = l.lado === 'compra' ? VERDE : VERMELHO;
      var txt = l.valido ? (l.lado.toUpperCase() + ' · ' + l.estado) : 'sem perna';
      var extra = l.estado === 'aguardando' && l.distPct != null ? ' (a ' + l.distPct + '%)' : '';
      var row = linha(l.tempo, txt + extra, l.relevante ? corL : CINZA);
      if (!l.relevante) row.style.opacity = '.55';
      CORPO.appendChild(row);
    });

    if (MOSTRAR_SINAIS) {
      var cab = document.createElement('div');
      cab.style.cssText = 'margin:10px 0 2px;font:9px ui-monospace,Consolas,monospace;color:#4e5866;letter-spacing:.12em';
      cab.textContent = 'ULTIMAS VIRADAS';
      CORPO.appendChild(cab);
      var ev = [];
      try { ev = core.eventosRecentes(CACHE, 5); } catch (e) { ev = []; }
      if (!ev.length) CORPO.appendChild(linha('—', 'nenhuma', CINZA));
      ev.forEach(function (e) {
        var h = new Date(e.t);
        var hora = ('0' + h.getHours()).slice(-2) + ':' + ('0' + h.getMinutes()).slice(-2) + ':' + ('0' + h.getSeconds()).slice(-2);
        CORPO.appendChild(linha(e.tempo + ' ' + hora, e.lado.toUpperCase(), e.lado === 'compra' ? VERDE : VERMELHO));
      });
    }

    var nota = document.createElement('div');
    nota.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid rgba(217,180,91,.12);font:9px ui-monospace,Consolas,monospace;color:#4e5866;letter-spacing:.06em';
    nota.textContent = 'consenso ' + r.versao + ' · fib ' + r.fib + ' · peso 30s 1 · 1m 1,5 · 15m 2,5';
    CORPO.appendChild(nota);
  }

  function botao(txt, fn) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = txt;
    b.style.cssText = 'min-height:40px;flex:1;padding:0 10px;background:transparent;border:1px solid rgba(217,180,91,.45);' +
      'border-radius:6px;color:' + OURO + ';font:600 11px ui-monospace,Consolas,monospace;letter-spacing:.05em;cursor:pointer';
    b.addEventListener('click', fn);
    return b;
  }

  function montar() {
    if (CARD) return CARD;
    CARD = document.createElement('div');
    CARD.id = 'consenso-card';
    CARD.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9997;width:262px;max-width:calc(100vw - 28px);' +
      'background:linear-gradient(180deg,rgba(16,22,31,.97),rgba(11,15,21,.97));' +
      'border:1px solid rgba(217,180,91,.28);border-radius:12px;' +
      'box-shadow:0 18px 40px -12px rgba(0,0,0,.65),inset 0 1px 0 rgba(217,180,91,.10);display:none;' +
      'backdrop-filter:blur(8px);overflow:hidden';

    var cab = document.createElement('div');
    cab.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px 4px 12px;border-bottom:1px solid rgba(217,180,91,.16)';
    cab.innerHTML = '<b style="color:' + OURO + ';letter-spacing:.16em;font:700 10px ui-monospace,Consolas,monospace">CONSENSO</b>';
    var x = document.createElement('button');
    x.type = 'button'; x.textContent = '\u00d7';
    x.style.cssText = 'margin-left:auto;min-width:40px;min-height:40px;background:transparent;border:none;color:' + CINZA + ';font-size:18px;cursor:pointer';
    x.addEventListener('click', function () { CARD.style.display = 'none'; ABERTO = false; });
    cab.appendChild(x);
    CARD.appendChild(cab);

    CORPO = document.createElement('div');
    CORPO.style.cssText = 'padding:12px 12px 10px';
    CARD.appendChild(CORPO);

    var acoes = document.createElement('div');
    acoes.style.cssText = 'display:flex;gap:8px;padding:0 12px 12px';
    acoes.appendChild(botao('SINAIS', function () { MOSTRAR_SINAIS = !MOSTRAR_SINAIS; pintar(ULTIMO); }));
    acoes.appendChild(botao('AGORA', function () { atualizar(); }));
    CARD.appendChild(acoes);
    document.body.appendChild(CARD);
    return CARD;
  }

  // O Imperial e o Consenso nascem no mesmo canto. Em vez de deixar um cobrir
  // o outro, quem estiver aberto vira uma pilha: cada cartao sobe pelo altura
  // do que esta abaixo dele. Roda tambem quando o outro cartao abre ou fecha.
  function empilhar() {
    var c = document.getElementById('consenso-card');
    var i = document.getElementById('imperial-card');
    var base = 14;
    if (c && c.style.display !== 'none' && c.offsetHeight) { c.style.bottom = base + 'px'; base += c.offsetHeight + 10; }
    if (i && i.style.display !== 'none' && i.offsetHeight) { i.style.bottom = base + 'px'; }
  }

  function vigiarPilha() {
    try {
      var obs = new MutationObserver(function () { empilhar(); });
      obs.observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true, childList: true });
      window.addEventListener('resize', empilhar);
      [400, 1200, 2600, 5000].forEach(function (ms) { setTimeout(empilhar, ms); });
    } catch (e) {}
  }

  function abrir() {
    montar().style.display = 'block';
    ABERTO = true;
    pintar(ULTIMO);
    atualizar();
    setTimeout(empilhar, 60);
  }

  function alternar() {
    if (ABERTO) { CARD.style.display = 'none'; ABERTO = false; }
    else abrir();
  }

  function adicionarNav() {
    if (document.getElementById('nav-consenso')) return true;
    var pai = document.querySelector('.nav-item');
    if (!pai || !pai.parentNode) return false;
    var item = document.createElement('div');
    item.className = 'nav-item';
    item.id = 'nav-consenso';
    item.title = 'Consenso de microtempo: FIB automatico em 30s, 1m e 15m';
    item.innerHTML = '<span class="nav-icon">\u25c8</span><span class="nav-lbl">Consenso</span>';
    item.addEventListener('click', alternar);
    var irmao = document.getElementById('nav-imperial') || document.getElementById('nav-vigia');
    pai.parentNode.insertBefore(item, irmao && irmao.nextSibling ? irmao.nextSibling : (pai.parentNode.children[2] || null));
    return true;
  }

  window.AtlasConsenso = {
    abrir: abrir,
    empilhar: empilhar,
    fechar: function () { if (CARD) CARD.style.display = 'none'; ABERTO = false; },
    alternar: alternar,
    atualizar: atualizar,
    estado: function () { return ULTIMO; },
    series: function () { return CACHE; }
  };

  function iniciar() {
    var tentativas = 0;
    var t = setInterval(function () {
      tentativas++;
      if (adicionarNav() || tentativas > 40) clearInterval(t);
    }, 250);
    vigiarPilha();
    setTimeout(empilhar, 800);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
