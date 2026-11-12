// Imperial SuperTrend na tela do Atlas.
//
// A conta toda mora em core/imperial.js (ZEMA + KAMA, banda ATR que so aperta,
// angulo normalizado, alvo projetado do RSI e absorcao por delta). Este arquivo
// so faz tres coisas: desenha as linhas no grafico, mostra o cartao e liga ou
// desliga. Nada de calculo aqui, para o mesmo numero valer no painel e no robo.

(function () {
  'use strict';

  var CHAVE = 'atlas.imperial.v1';
  var card = null;
  var corpo = null;
  var core = null;
  var series = { st: null, a70: null, a50: null, a30: null };
  var ligado = false;
  var visivel = true;
  var ultimo = null;
  var ultimaContagem = -1;
  var timer = null;

  var VERDE = '#00E676', VERMELHO = '#FF1744';
  var ROSA = 'rgba(255,0,127,0.55)', CINZA = 'rgba(139,148,158,0.45)', CIANO = 'rgba(0,229,255,0.55)';

  function texto(v, casas) {
    if (v == null || !isFinite(v)) return '--';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas || 2, maximumFractionDigits: casas || 2 });
  }

  function obterCore() {
    if (core) return Promise.resolve(core);
    if (window.AtlasImperialCore) { core = window.AtlasImperialCore; return Promise.resolve(core); }
    return import('./core/imperial.js').then(function (m) {
      core = m; window.AtlasImperialCore = m; return m;
    }).catch(function () { return null; });
  }

  function velas() {
    try {
      if (typeof candles !== 'undefined' && Array.isArray(candles) && candles.length > 30) {
        return candles.map(function (c) {
          return { time: c.time, h: c.high != null ? c.high : c.h, l: c.low != null ? c.low : c.l, c: c.close != null ? c.close : c.c, v: c.volume != null ? c.volume : c.v };
        });
      }
    } catch (e) {}
    try {
      if (Array.isArray(window.__velas) && window.__velas.length > 30) return window.__velas.slice();
    } catch (e) {}
    return [];
  }

  function grafico() {
    try { if (typeof chart !== 'undefined' && chart && chart.addLineSeries) return chart; } catch (e) {}
    return null;
  }

  function criarSeries() {
    var g = grafico();
    if (!g) return null;
    if (series.st) return series;
    function linha(cor, largura, estilo, titulo) {
      return g.addLineSeries({
        color: cor, lineWidth: largura || 2, lineStyle: estilo || 0,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: titulo
      });
    }
    series.st = linha(VERDE, 3, 0, 'ST');
    series.a70 = linha(ROSA, 1, 0, 'RSI70');
    series.a50 = linha(CINZA, 1, 2, 'RSI50');
    series.a30 = linha(CIANO, 1, 0, 'RSI30');
    return series;
  }

  function apagarSeries() {
    var g = grafico();
    if (!g || !g.removeSeries) return;
    Object.keys(series).forEach(function (k) {
      if (series[k]) { try { g.removeSeries(series[k]); } catch (e) {} series[k] = null; }
    });
  }

  function desenhar(vs, r) {
    if (!ligado || !visivel) return;
    var s = criarSeries();
    if (!s) return;
    var st = [], a70 = [], a50 = [], a30 = [];
    var sr = r.series;
    for (var i = 0; i < vs.length; i++) {
      var t = vs[i].time;
      if (sr.linha[i] != null) st.push({ time: t, value: sr.linha[i], color: sr.dir[i] === 1 ? VERDE : VERMELHO });
      if (sr.alvoTopo[i] != null) a70.push({ time: t, value: sr.alvoTopo[i] });
      if (sr.alvoMeio[i] != null) a50.push({ time: t, value: sr.alvoMeio[i] });
      if (sr.alvoFundo[i] != null) a30.push({ time: t, value: sr.alvoFundo[i] });
    }
    try {
      s.st.setData(st); s.a70.setData(a70); s.a50.setData(a50); s.a30.setData(a30);
    } catch (e) { apagarSeries(); }
  }

  function avaliar(forcar) {
    var vs = velas();
    if (!vs.length) { pintar(null); return; }
    if (!forcar && vs.length === ultimaContagem && ultimo) { return; }
    obterCore().then(function (m) {
      if (!m) { pintar(null); return; }
      var r = null;
      try { r = m.imperial(vs); } catch (e) { r = null; }
      ultimaContagem = vs.length;
      ultimo = r;
      pintar(r, m);
      if (r) desenhar(vs, r);
    });
  }

  function linha2(rotulo, valor, cor) {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;justify-content:space-between;gap:10px;padding:3px 0;font:11px ui-monospace,Consolas,monospace';
    var a = document.createElement('span');
    a.textContent = rotulo;
    a.style.color = '#8a97a8';
    var b = document.createElement('span');
    b.textContent = valor;
    b.style.color = cor || '#e6edf3';
    b.style.fontWeight = '600';
    d.appendChild(a); d.appendChild(b);
    return d;
  }

  function pintar(r, m) {
    if (!corpo) return;
    corpo.innerHTML = '';
    if (!r) {
      corpo.appendChild(linha2('ESTADO', 'sem velas suficientes', '#8a97a8'));
      return;
    }
    var e = r.estado;
    var corLado = e.dir === 1 ? VERDE : VERMELHO;
    var faixa = document.createElement('div');
    faixa.style.cssText = 'margin-bottom:8px;padding:6px 8px;border-radius:6px;text-align:center;font:700 12px ui-monospace,Consolas,monospace;' +
      'background:' + (e.dir === 1 ? 'rgba(0,230,118,.10)' : 'rgba(255,23,68,.10)') + ';color:' + corLado;
    faixa.textContent = (e.dir === 1 ? 'ALTA' : 'BAIXA') + ' · ' + (e.anguloForte ? 'ANGULO FORTE' : 'ANGULO FRACO');
    corpo.appendChild(faixa);

    corpo.appendChild(linha2('ANGULO', e.angulo == null ? '--' : e.angulo.toFixed(1) + '°', e.anguloForte ? '#FFEB3B' : '#8a97a8'));
    corpo.appendChild(linha2('LINHA (STOP)', texto(e.linha) + (e.distLinhaPct == null ? '' : ' · ' + e.distLinhaPct.toFixed(2) + '%'), corLado));
    corpo.appendChild(linha2('ALVO 70', texto(e.alvoTopo) + (e.distAlvoTopo == null ? '' : ' · ' + texto(e.distAlvoTopo, 0)), ROSA));
    corpo.appendChild(linha2('EQUILIBRIO 50', texto(e.alvoMeio), '#8a97a8'));
    corpo.appendChild(linha2('ALVO 30', texto(e.alvoFundo) + (e.distAlvoFundo == null ? '' : ' · ' + texto(e.distAlvoFundo, 0)), CIANO));
    corpo.appendChild(linha2('RSI AGORA', e.rsi == null ? '--' : e.rsi.toFixed(1),
      e.rsi == null ? '#8a97a8' : (e.rsi >= 70 ? ROSA : (e.rsi <= 30 ? CIANO : '#e6edf3'))));

    var macro = e.macroAlinhado === 1 ? 'ALINHADO ALTA' : (e.macroAlinhado === -1 ? 'ALINHADO BAIXA' : 'DIVERGENTE');
    var corMacro = e.macroAlinhado === 1 ? VERDE : (e.macroAlinhado === -1 ? VERMELHO : '#FF9100');
    corpo.appendChild(linha2('FLUXO 1H/1D', macro, corMacro));

    if (e.absorcaoTopo || e.absorcaoFundo) {
      var al = document.createElement('div');
      al.style.cssText = 'margin-top:8px;padding:5px 8px;border-radius:6px;font:600 10px ui-monospace,Consolas,monospace;text-align:center;' +
        (e.absorcaoTopo
          ? 'background:rgba(255,0,127,.12);border:1px solid rgba(255,0,127,.45);color:#ff7ab8'
          : 'background:rgba(0,229,255,.12);border:1px solid rgba(0,229,255,.45);color:#7fe9ff');
      al.textContent = e.absorcaoTopo ? 'ABSORÇÃO NO TOPO' : 'ABSORÇÃO NO FUNDO';
      corpo.appendChild(al);
    }

    var nota = document.createElement('div');
    nota.style.cssText = 'margin-top:8px;font:10px ui-monospace,Consolas,monospace;color:#5b6675';
    nota.textContent = 'versao ' + r.versao + ' · ' + (ligado ? 'linhas no gráfico' : 'linhas ocultas');
    corpo.appendChild(nota);
  }

  function botao(txt, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = txt;
    b.style.cssText = 'min-height:40px;padding:0 12px;background:transparent;border:1px solid rgba(217,180,91,.45);' +
      'border-radius:6px;color:#D9B45B;font:600 11px ui-monospace,Consolas,monospace;letter-spacing:.05em;cursor:pointer';
    b.addEventListener('click', fn);
    return b;
  }

  function montar() {
    if (card) return card;
    card = document.createElement('div');
    card.id = 'imperial-card';
    card.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9998;width:268px;' +
      'background:rgba(13,17,23,.96);border:1px solid rgba(217,180,91,.35);border-radius:10px;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.45);display:none;backdrop-filter:blur(6px)';

    var cab = document.createElement('div');
    cab.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(217,180,91,.2)';
    cab.innerHTML = '<b style="color:#D9B45B;letter-spacing:.1em;font:700 11px ui-monospace,Consolas,monospace">IMPERIAL</b>';
    var fechar = document.createElement('button');
    fechar.type = 'button'; fechar.textContent = '\u00d7';
    fechar.style.cssText = 'margin-left:auto;min-width:40px;min-height:40px;background:transparent;border:none;color:#8a97a8;font-size:18px;cursor:pointer';
    fechar.addEventListener('click', function () { card.style.display = 'none'; });
    cab.appendChild(fechar);
    card.appendChild(cab);

    corpo = document.createElement('div');
    corpo.style.cssText = 'padding:10px';
    card.appendChild(corpo);

    var acoes = document.createElement('div');
    acoes.style.cssText = 'display:flex;gap:8px;padding:0 10px 10px';
    acoes.appendChild(botao('LINHAS', function () {
      ligado = !ligado;
      salvarEstado();
      if (!ligado) { apagarSeries(); }
      ultimaContagem = -1;
      avaliar(true);
    }));
    acoes.appendChild(botao('LIVRO', function () { celulas(); }));
    card.appendChild(acoes);

    document.body.appendChild(card);
    return card;
  }

  // Leitura celula por celula da serie, para conferir contra o TradingView.
  function celulas() {
    if (!ultimo) return;
    var e = ultimo.estado;
    var linhas = [
      'dir=' + e.dir,
      'linha=' + (e.linha == null ? 'na' : e.linha.toFixed(2)),
      'nucleo=' + (e.nucleo == null ? 'na' : e.nucleo.toFixed(2)),
      'zema=' + (e.zema == null ? 'na' : e.zema.toFixed(2)),
      'kama=' + (e.kama == null ? 'na' : e.kama.toFixed(2)),
      'atr=' + (e.atr == null ? 'na' : e.atr.toFixed(2)),
      'angulo=' + (e.angulo == null ? 'na' : e.angulo.toFixed(2)),
      'alvo70=' + (e.alvoTopo == null ? 'na' : e.alvoTopo.toFixed(2)),
      'alvo50=' + (e.alvoMeio == null ? 'na' : e.alvoMeio.toFixed(2)),
      'alvo30=' + (e.alvoFundo == null ? 'na' : e.alvoFundo.toFixed(2)),
      'rsi=' + (e.rsi == null ? 'na' : e.rsi.toFixed(2))
    ];
    console.log('[imperial] ' + linhas.join(' | '));
  }

  function lerEstado() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch (e) { return {}; }
  }
  function salvarEstado() {
    try { localStorage.setItem(CHAVE, JSON.stringify({ ligado: ligado })); } catch (e) {}
  }

  function abrir() {
    montar();
    card.style.display = 'block';
    ligado = lerEstado().ligado === true;
    avaliar(true);
    if (!timer) timer = setInterval(function () { avaliar(false); }, 2000);
  }

  function fechar() { if (card) card.style.display = 'none'; }
  function alternar() { if (card && card.style.display === 'block') fechar(); else abrir(); }

  function adicionarNav() {
    if (document.getElementById('nav-imperial')) return;
    var pai = document.querySelector('.nav-item');
    if (!pai || !pai.parentNode) return;
    var item = document.createElement('div');
    item.className = 'nav-item';
    item.id = 'nav-imperial';
    item.title = 'Imperial SuperTrend: ZEMA + KAMA com alvo projetado do RSI';
    item.innerHTML = '<span class="nav-icon">\u2694</span><span class="nav-lbl">Imperial</span>';
    item.addEventListener('click', alternar);
    var irmao = document.getElementById('nav-vigia');
    pai.parentNode.insertBefore(item, irmao ? irmao.nextSibling : (pai.parentNode.children[2] || null));
  }

  window.AtlasImperial = {
    abrir: abrir,
    fechar: fechar,
    alternar: alternar,
    avaliar: function () { avaliar(true); },
    estado: function () { return ultimo ? ultimo.estado : null; },
    ligarLinhas: function (v) { ligado = !!v; salvarEstado(); ultimaContagem = -1; avaliar(true); },
    linhasLigadas: function () { return !!ligado; },
    linhasVisiveis: function () { return !!visivel; },
    mostrarLinhas: function (v) {
      visivel = !!v;
      if (!visivel) apagarSeries();
      ultimaContagem = -1; avaliar(true);
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', adicionarNav);
  else adicionarNav();
})();
