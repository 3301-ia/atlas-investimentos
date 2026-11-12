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
  var nuvemPrim = null;
  var ligado = false;
  var visivel = true;
  var ultimo = null;
  var ultimaContagem = -1;
  var ultimaAssinatura = '';
  var ultimoBom = null;
  var ultimoBomEm = 0;
  var timer = null;

  var VERDE = '#2ECC8F', VERMELHO = '#E2564D';
  var NUVEM_ALTA = 'rgba(46,204,143,0.11)', NUVEM_BAIXA = 'rgba(226,86,77,0.11)';
  var ROSA = 'rgba(217,180,91,0.65)', CINZA = 'rgba(139,148,158,0.35)', CIANO = 'rgba(90,180,205,0.55)';

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

  // A leitura de velas era o ponto fraco: se uma unica vela viesse com preco
  // invalido, tempo repetido ou fora de ordem, o nucleo devolvia nulo e o
  // cartao travava em "sem velas suficientes" com o grafico cheio. Agora a
  // serie e limpa antes de sair daqui.
  function serieLimpa(arr) {
    if (!Array.isArray(arr) || !arr.length) return null;
    var porTempo = {}, saida = [];
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i];
      if (!c || typeof c !== 'object') continue;
      var t = c.time != null ? c.time : (c.t != null ? c.t : c.openTime);
      var h = Number(c.high != null ? c.high : c.h);
      var l = Number(c.low != null ? c.low : c.l);
      var fe = Number(c.close != null ? c.close : c.c);
      var vo = Number(c.volume != null ? c.volume : c.v);
      if (!isFinite(t) || !isFinite(h) || !isFinite(l) || !isFinite(fe)) continue;
      if (h < l) continue;
      porTempo[t] = { time: t, h: h, l: l, c: fe, v: isFinite(vo) ? vo : 0 };
    }
    for (var k in porTempo) saida.push(porTempo[k]);
    saida.sort(function (a, b) { return a.time - b.time; });
    return saida.length ? saida : null;
  }

  function velas() {
    var candidatos = [];
    try { if (typeof candles !== 'undefined' && Array.isArray(candles)) candidatos.push(candles); } catch (e) {}
    try { if (Array.isArray(window.__velas)) candidatos.push(window.__velas); } catch (e) {}
    try {
      var tf = null;
      try { tf = typeof currentTF !== 'undefined' ? currentTF : null; } catch (e) {}
      var mapa = window.__velasPorTf || window.candlesPorTf;
      if (mapa && tf && Array.isArray(mapa[tf])) candidatos.push(mapa[tf]);
      if (mapa && Array.isArray(mapa[window.__tfAtual])) candidatos.push(mapa[window.__tfAtual]);
    } catch (e) {}
    for (var i = 0; i < candidatos.length; i++) {
      var limpa = serieLimpa(candidatos[i]);
      if (limpa && limpa.length > 30) return limpa;
    }
    return [];
  }

  function assinatura(vs) {
    if (!vs || !vs.length) return '0';
    return vs.length + ':' + vs[0].time + ':' + vs[vs.length - 1].time;
  }

  function grafico() {
    try { if (typeof chart !== 'undefined' && chart && chart.addLineSeries) return chart; } catch (e) {}
    return null;
  }


  // Nuvem do SuperTrend: o Pine faz fill(p_st, p_cl), ou seja, pinta a zona
  // entre a linha do trailing e o preco. O lightweight-charts nao tem fill
  // entre duas series, entao a area e desenhada por uma primitiva propria,
  // presa a serie do SuperTrend: ela recebe as coordenadas ja calculadas do
  // grafico, entao acompanha zoom, arrasto e troca de tempo sem recalcular.
  function Nuvem() {
    this._dados = [];
    this._serie = null;
    this._grafico = null;
    this._pedirDesenho = null;
  }
  Nuvem.prototype.attached = function (p) {
    this._serie = p.series; this._grafico = p.chart; this._pedirDesenho = p.requestUpdate;
  };
  Nuvem.prototype.detached = function () { this._serie = null; this._grafico = null; };
  Nuvem.prototype.updateAllViews = function () {};
  Nuvem.prototype.paneViews = function () {
    var eu = this;
    // o lightweight-charts chama view.renderer() como funcao e espera um
    // objeto com draw(); declarar renderer como objeto derrubava o quadro.
    return [{ renderer: function () { return { draw: function (alvo) { eu._pintar(alvo); } }; } }];
  };
  Nuvem.prototype.setDados = function (d) {
    this._dados = d || [];
    if (this._pedirDesenho) { try { this._pedirDesenho(); } catch (e) {} }
  };
  Nuvem.prototype._pintar = function (alvo) {
    var eu = this;
    if (!this._serie || !this._grafico || !this._dados.length) return;
    if (!alvo || !alvo.useMediaCoordinateSpace) return;
    alvo.useMediaCoordinateSpace(function (escopo) {
      var ctx = escopo.context, escala = eu._grafico.timeScale(), serie = eu._serie;
      var trechos = [], atual = null;
      for (var i = 0; i < eu._dados.length; i++) {
        var d = eu._dados[i];
        var x = escala.timeToCoordinate(d.time);
        if (x == null) { atual = null; continue; }
        var ySt = serie.priceToCoordinate(d.st), yPreco = serie.priceToCoordinate(d.c);
        if (ySt == null || yPreco == null) { atual = null; continue; }
        if (!atual || atual.dir !== d.dir) { atual = { dir: d.dir, pts: [] }; trechos.push(atual); }
        atual.pts.push({ x: x, ys: ySt, yc: yPreco });
      }
      for (var t = 0; t < trechos.length; t++) {
        var pts = trechos[t].pts;
        if (pts.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].ys);
        for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].ys);
        for (var j = pts.length - 1; j >= 0; j--) ctx.lineTo(pts[j].x, pts[j].yc);
        ctx.closePath();
        ctx.fillStyle = trechos[t].dir === 1 ? NUVEM_ALTA : NUVEM_BAIXA;
        ctx.fill();
      }
    });
  };

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
    series.st = linha(VERDE, 2, 0, 'ST');
    series.a70 = linha(ROSA, 1, 2, 'RSI70');
    series.a50 = linha(CINZA, 1, 3, 'RSI50');
    series.a30 = linha(CIANO, 1, 2, 'RSI30');
    if (series.st && typeof series.st.attachPrimitive === 'function') {
      try {
        nuvemPrim = new Nuvem();
        series.st.attachPrimitive(nuvemPrim);
      } catch (e) { nuvemPrim = null; }
    }
    return series;
  }

  function apagarSeries() {
    var g = grafico();
    if (nuvemPrim) { try { if (series.st && series.st.detachPrimitive) series.st.detachPrimitive(nuvemPrim); } catch (e) {} nuvemPrim = null; }
    if (!g || !g.removeSeries) return;
    Object.keys(series).forEach(function (k) {
      if (series[k]) { try { g.removeSeries(series[k]); } catch (e) {} series[k] = null; }
    });
  }

  function desenhar(vs, r) {
    if (!ligado || !visivel) return;
    var s = criarSeries();
    if (!s) return;
    var st = [], a70 = [], a50 = [], a30 = [], nuvem = [];
    var sr = r.series;
    for (var i = 0; i < vs.length; i++) {
      var t = vs[i].time;
      if (!isFinite(t)) continue;
      if (sr.linha[i] != null && isFinite(sr.linha[i])) {
        st.push({ time: t, value: sr.linha[i], color: sr.dir[i] === 1 ? VERDE : VERMELHO });
        if (isFinite(vs[i].c)) nuvem.push({ time: t, st: sr.linha[i], c: vs[i].c, dir: sr.dir[i] });
      }
      if (sr.alvoTopo[i] != null && isFinite(sr.alvoTopo[i])) a70.push({ time: t, value: sr.alvoTopo[i] });
      if (sr.alvoMeio[i] != null && isFinite(sr.alvoMeio[i])) a50.push({ time: t, value: sr.alvoMeio[i] });
      if (sr.alvoFundo[i] != null && isFinite(sr.alvoFundo[i])) a30.push({ time: t, value: sr.alvoFundo[i] });
    }
    try {
      s.st.setData(st); s.a70.setData(a70); s.a50.setData(a50); s.a30.setData(a30);
      if (nuvemPrim) nuvemPrim.setDados(nuvem);
    } catch (e) { apagarSeries(); }
  }

  function avaliar(forcar) {
    try {
      var vs = velas();
      if (!vs.length) {
        // sem serie ainda: mostra progresso em vez de erro e segue tentando
        pintar(ultimoBom, null, { antigo: !!ultimoBom, semDados: true, tem: 0 });
        return;
      }
      var sig = assinatura(vs);
      if (!forcar && sig === ultimaAssinatura && (ultimo || ultimoBom)) return;
      obterCore().then(function (m) {
        if (!m) { pintar(ultimoBom, null, { antigo: !!ultimoBom, semDados: true, tem: vs.length }); return; }
        var r = null;
        try { r = m.imperial(vs); } catch (e) { r = null; }
        ultimaAssinatura = sig;
        ultimo = r;
        if (r) {
          ultimoBom = r;
          ultimoBomEm = Date.now();
          pintar(r, m, { antigo: false, tem: vs.length });
          try { desenhar(vs, r); } catch (e) {}
        } else {
          // poucas velas ou conta recusada: mantem a ultima leitura valida
          pintar(ultimoBom, m, { antigo: !!ultimoBom, tem: vs.length });
        }
      }).catch(function () {
        pintar(ultimoBom, null, { antigo: !!ultimoBom, tem: vs.length });
      });
    } catch (e) {
      pintar(ultimoBom, null, { antigo: !!ultimoBom, tem: 0 });
    }
  }

  function linha2(rotulo, valor, cor) {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:5px 0;' +
      'border-bottom:1px solid rgba(255,255,255,.04);font:11px/1.35 ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums';
    var a = document.createElement('span');
    a.textContent = rotulo;
    a.style.color = '#76818f'; a.style.letterSpacing = '.04em';
    var b = document.createElement('span');
    b.textContent = valor;
    b.style.color = cor || '#e6edf3';
    b.style.fontWeight = '600';
    d.appendChild(a); d.appendChild(b);
    return d;
  }

  function pintar(r, m, ctx) {
    if (!corpo) return;
    ctx = ctx || {};
    corpo.innerHTML = '';
    if (!r) {
      // cartao nunca fica morto: diz o que esta faltando e quanto falta
      var precisa = (m && typeof m.minimoVelas === 'function') ? m.minimoVelas() : 29;
      var faltam = ctx.tem ? Math.max(0, precisa - ctx.tem) : precisa;
      corpo.appendChild(linha2('ESTADO', ctx.semDados ? 'aguardando dados' : 'poucas velas', CINZA));
      corpo.appendChild(linha2('VELAS', (ctx.tem || 0) + ' de ' + precisa + (faltam ? ' · faltam ' + faltam : ''), CINZA));
      var av = document.createElement('div');
      av.style.cssText = 'margin-top:8px;font:9px ui-monospace,Consolas,monospace;color:#4e5866;letter-spacing:.06em;text-align:center';
      av.textContent = 'tentando de novo a cada 2s';
      corpo.appendChild(av);
      return;
    }
    var e = r.estado;
    var corLado = e.dir === 1 ? VERDE : VERMELHO;
    var faixa = document.createElement('div');
    faixa.style.cssText = 'margin-bottom:10px;padding:7px 8px;border-radius:7px;text-align:center;letter-spacing:.08em;font:700 11px ui-monospace,Consolas,monospace;' +
      'background:' + (e.dir === 1 ? 'rgba(0,230,118,.10)' : 'rgba(255,23,68,.10)') + ';color:' + corLado;
    faixa.textContent = (e.dir === 1 ? 'ALTA' : 'BAIXA') + ' · ' + (e.anguloForte ? 'ANGULO FORTE' : 'ANGULO FRACO');
    corpo.appendChild(faixa);

    if (ctx.antigo) {
      var velho = document.createElement('div');
      var h = new Date(ultimoBomEm);
      velho.style.cssText = 'margin:-6px 0 8px;padding:4px 6px;border-radius:5px;text-align:center;font:9px ui-monospace,Consolas,monospace;' +
        'background:rgba(217,180,91,.10);color:#b99a4e;letter-spacing:.06em';
      velho.textContent = 'leitura anterior ' + ('0' + h.getHours()).slice(-2) + ':' + ('0' + h.getMinutes()).slice(-2) + ':' + ('0' + h.getSeconds()).slice(-2);
      corpo.appendChild(velho);
    }

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
    nota.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid rgba(217,180,91,.12);' +
      'font:9px ui-monospace,Consolas,monospace;color:#4e5866;letter-spacing:.06em';
    var lido = ultimoBomEm ? new Date(ultimoBomEm) : null;
    var hhmm = lido ? ('0' + lido.getHours()).slice(-2) + ':' + ('0' + lido.getMinutes()).slice(-2) : '--:--';
    nota.textContent = 'v' + r.versao + ' · ' + (ligado ? 'linhas no gráfico' : 'linhas ocultas') + ' · lido ' + hhmm;
    corpo.appendChild(nota);
  }

  function botao(txt, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = txt;
    b.style.cssText = 'min-height:40px;flex:1 1 0;min-width:0;padding:0 8px;background:transparent;border:1px solid rgba(217,180,91,.45);' +
      'border-radius:6px;color:#D9B45B;font:600 10px ui-monospace,Consolas,monospace;letter-spacing:.04em;cursor:pointer;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    b.addEventListener('click', fn);
    return b;
  }

  function montar() {
    if (card) return card;
    card = document.createElement('div');
    card.id = 'imperial-card';
    card.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;width:262px;max-width:calc(100vw - 28px);' +
      'background:linear-gradient(180deg,rgba(16,22,31,.97) 0%,rgba(11,15,21,.97) 100%);' +
      'border:1px solid rgba(217,180,91,.28);border-radius:12px;' +
      'box-shadow:0 18px 40px -12px rgba(0,0,0,.65),inset 0 1px 0 rgba(217,180,91,.10);' +
      'display:none;backdrop-filter:blur(8px);overflow:hidden';

    var cab = document.createElement('div');
    cab.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px 4px 12px;border-bottom:1px solid rgba(217,180,91,.16)';
    cab.innerHTML = '<b style="color:#D9B45B;letter-spacing:.16em;font:700 10px ui-monospace,Consolas,monospace">IMPERIAL</b>';
    var fechar = document.createElement('button');
    fechar.type = 'button'; fechar.textContent = '\u00d7';
    fechar.style.cssText = 'margin-left:auto;min-width:40px;min-height:40px;background:transparent;border:none;color:#8a97a8;font-size:18px;cursor:pointer';
    fechar.addEventListener('click', function () { card.style.display = 'none'; });
    cab.appendChild(fechar);
    card.appendChild(cab);

    corpo = document.createElement('div');
    corpo.style.cssText = 'padding:12px 12px 10px';
    card.appendChild(corpo);

    var acoes = document.createElement('div');
    acoes.style.cssText = 'display:flex;gap:8px;padding:0 10px 10px';
    acoes.appendChild(botao('LINHAS', function () {
      ligado = !ligado;
      salvarEstado();
      if (!ligado) { apagarSeries(); }
      ultimaContagem = -1;
      ultimaAssinatura = '';
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
