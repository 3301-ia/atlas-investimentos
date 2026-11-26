// VECTRA · Robô de ciclos: modo de teste (operação em papel)
//
// A aba roda o motor de verdade, vela por vela, como se estivesse operando:
// abre a posição, coloca as travas da escada, mostra o livro de ordens vivo,
// marca cada giro no gráfico e acumula o resultado do dia.
//
// Regras do motor (relatório técnico de 20/11/2026):
//   entrada  cruzamento EMA8 x EMA16 com RSI (>55 compra, <45 venda)
//   stop     1,0 ATR
//   alvo     2,0 R
//   escada   travas em 1/3, 2/3, 3/3, 4/3 e 5/3 de R, fator 0,60
//   trava    alvo +0,5 R, corte -0,5 R
(function () {
  'use strict';
  if (document.getElementById('robo-ciclos-card')) return;

  var PONTE = (function () {
    try { return (localStorage.getItem('vx_velas_url') || 'https://vectra-velas.onrender.com/velas').replace(/\/velas.*$/, ''); }
    catch (e) { return 'https://vectra-velas.onrender.com'; }
  })();

  var CFG = { ativo: 'BTCUSDT', tf: '15m', lote: 0.01, fator: 0.6, alvo: 2, stop: 1, corte: 0.5, alvoTrava: 0.5,
              sinal: 'ciclos', alvos: 'atr', filtro: 'base', hedge: 'auto', niveis: [1 / 3, 2 / 3, 1, 4 / 3, 5 / 3] };

  var S = {
    velas: [], ind: null, dir: null, motor: null,
    chart: null, serie: null, linhas: [], marcadores: [],
    teste: null, timer: null, ms: 220, indice: 0
  };
  var el = {};
  var C = { tinta: '#1c1c1e', fraco: '#8a8f98', linha: '#e4e4e6', vermelho: '#c8102e', verde: '#1f7a4d', ouro: '#c8a000' };

  function n(v, c) { var x = Number(v); if (!isFinite(x)) return '--'; return x.toLocaleString('pt-BR', { minimumFractionDigits: c == null ? 2 : c, maximumFractionDigits: c == null ? 2 : c }); }
  function usd(v) { return (v >= 0 ? '+' : '') + n(v, 2); }
  function hhmm(t) { var d = new Date(t * 1000); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function diahora(t) { var d = new Date(t * 1000); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' + hhmm(t); }
  function segTf(tf) {
    var mapa = { '1s': 1, '5s': 5, '15s': 15, '30s': 30, '1m': 60, '3m': 180, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 };
    return mapa[tf] || 900;
  }

  /* ── indicadores ─────────────────────────────────────────────────── */
  function ema(src, p) { var k = 2 / (p + 1), o = [], s = null; for (var i = 0; i < src.length; i++) { s = s === null ? src[i] : src[i] * k + s * (1 - k); o.push(s); } return o; }
  function rsiCalc(src, p) {
    var o = new Array(src.length).fill(50), g = 0, l = 0;
    for (var i = 1; i < src.length; i++) {
      var d = src[i] - src[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i === 1) { g = up; l = dn; } else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; }
      o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return o;
  }
  function atrCalc(v, p) {
    var tr = [0], o = new Array(v.length).fill(null), s = null;
    for (var i = 1; i < v.length; i++) tr[i] = Math.max(v[i].high - v[i].low, Math.abs(v[i].high - v[i - 1].close), Math.abs(v[i].low - v[i - 1].close));
    for (var j = p; j < v.length; j++) {
      if (s === null) { var q = 0; for (var k = j - p + 1; k <= j; k++) q += tr[k]; s = q / p; }
      else s = (s * (p - 1) + tr[j]) / p;
      o[j] = s;
    }
    return o;
  }
  function smaCalc(src, p) {
    var o = new Array(src.length).fill(null), s = 0;
    for (var i = 0; i < src.length; i++) {
      s += src[i];
      if (i >= p) s -= src[i - p];
      if (i >= p - 1) o[i] = s / p;
    }
    return o;
  }
  function indicadores(v) {
    var cl = v.map(function (x) { return x.close; });
    var e55 = ema(cl, 55), m56 = smaCalc(cl, 56), m89 = smaCalc(cl, 89), e98 = ema(cl, 98), e200 = ema(cl, 200);
    var e8 = ema(cl, 8), e16 = ema(cl, 16);
    var cruzes = [];
    for (var i = 1; i < cl.length; i++) {
      if (e8[i - 1] <= e16[i - 1] && e8[i] > e16[i]) cruzes.push({ i: i, dir: 'alta' });
      else if (e8[i - 1] >= e16[i - 1] && e8[i] < e16[i]) cruzes.push({ i: i, dir: 'baixa' });
    }
    return {
      e8: e8, e16: e16, rsi: rsiCalc(cl, 14), atr: atrCalc(v, 14), cruzes: cruzes,
      // base de médias do painel, na ordem em que elas seguram o preço
      ma55: e55, ma56: m56, ma89: m89, ma98: e98, ma200: e200,
      base: [
        { nome: 'EMA 55', s: e55 }, { nome: 'MA 56', s: m56 }, { nome: 'MA 89', s: m89 },
        { nome: 'EMA 98', s: e98 }, { nome: 'EMA 200', s: e200 }
      ]
    };
  }

  // ALVO PELA BASE DE MÉDIAS: o alvo é o nível mais alto da pilha de médias
  // (8/16 no gatilho, 55/56/89/98/200 como estrutura) que está à frente do
  // preço, na direção da operação. Antes o alvo era 2R de ATR — curto demais:
  // ele parava antes da primeira média e não seguia a base. Regras:
  //   · precisa pagar pelo menos o risco (1 ATR), senão não é alvo, é ruído;
  //   · teto de 8R para uma média perdida não virar alvo absurdo;
  //   · sem nenhum nível à frente, cai no 2R de ATR (piso antigo).
  function alvoPorMedias(i, entrada, lado) {
    var m = S.ind, risco = (m.atr[i] || entrada * 0.01);
    var niveis = [];
    m.base.forEach(function (b) {
      var v = b.s[i];
      if (v == null || !isFinite(v)) return;
      var dist = (v - entrada) * lado;   // > 0 = nível à frente, na direção
      if (dist > 0) niveis.push({ dist: dist, nivel: v, nome: b.nome });
    });
    var pagam = niveis.filter(function (n) { return n.dist >= risco * 0.999; });
    var dentroDoTeto = pagam.filter(function (n) { return n.dist <= risco * 8; });
    if (dentroDoTeto.length) {
      // o mais distante que ainda cabe no teto = topo da pilha na direção
      return dentroDoTeto[dentroDoTeto.length - 1];
    }
    if (pagam.length) return pagam[0];
    // Em tendência as médias ficam ATRÁS do preço: não existe nível à frente.
    // Aí o alvo sai da própria pilha — metade da largura que ela ocupa (distância
    // entre a média mais curta e a mais longa da base), com piso de 2R.
    var vals = m.base.map(function (b) { return b.s[i]; }).filter(function (v) { return v != null && isFinite(v); });
    var largura = vals.length > 1 ? Math.abs(Math.max.apply(null, vals) - Math.min.apply(null, vals)) : 0;
    // 'medias' projeta meia pilha; 'pilha' usa a largura inteira da base
    var fator = CFG.alvos === 'pilha' ? 1 : 0.5;
    var proj = Math.max(CFG.alvo * risco, largura * fator);
    return { dist: proj, nivel: entrada + lado * proj,
             nome: largura * fator > CFG.alvo * risco * 1.2 ? (fator === 1 ? 'pilha inteira' : 'meia pilha') : 'ATR ' + CFG.alvo + 'R' };
  }
  // FILTRO DA BASE: a operação só nasce a favor da pilha de médias — compra
  // quando a EMA 55 está acima da EMA 200, venda quando está abaixo. É o que o
  // usuário pediu: alvo segue o ATR (2R), a base serve para não operar contra
  // a estrutura.
  function passaFiltroBase(i, lado) {
    if (CFG.filtro === 'livre') return true;
    var m = S.ind;
    if (!m || !m.ma55 || !m.ma200) return true;
    var a = m.ma55[i], b = m.ma200[i];
    if (a == null || b == null) return true;
    return lado === 1 ? a >= b : a <= b;
  }

  // ALVO PELO FIBO: mesma régua do painel (perna pelo cruzamento EMA 8x16,
  // p0 = extremo antes do cruzamento, p1 = extremo até a vela atual). O alvo é
  // o nível 1,666 da perna (o "alvo" que o cartão do fibo mostra); 2,333 e
  // 1,333 entram como alternativas quando o nível padrão já ficou para trás.
  // p1 usa só velas até i: nada de ler o futuro.
  function alvoFibo(i, entrada, lado, risco) {
    var cz = (S.ind && S.ind.cruzes) || [], k = -1;
    for (var j = 0; j < cz.length; j++) { if (cz[j].i <= i) k = j; else break; }
    if (k < 0) return null;
    var cr = cz[k], ini = k > 0 ? cz[k - 1].i : Math.max(0, cr.i - 96);
    var p0, p1, z;
    if (cr.dir === 'baixa') {
      p0 = -Infinity; for (z = ini; z <= cr.i; z++) p0 = Math.max(p0, S.velas[z].high);
      p1 = Infinity; for (z = cr.i; z <= i; z++) p1 = Math.min(p1, S.velas[z].low);
    } else {
      p0 = Infinity; for (z = ini; z <= cr.i; z++) p0 = Math.min(p0, S.velas[z].low);
      p1 = -Infinity; for (z = cr.i; z <= i; z++) p1 = Math.max(p1, S.velas[z].high);
    }
    if (!isFinite(p0) || !isFinite(p1) || p0 === p1) return null;
    var niveis = [1.666, 2.333, 1.333];
    for (z = 0; z < niveis.length; z++) {
      var preco = p0 + (p1 - p0) * niveis[z];
      var dist = (preco - entrada) * lado;
      if (dist >= risco * 0.5) return { dist: dist, nivel: preco, nome: 'fibo ' + String(niveis[z]).replace('.', ',') };
    }
    return null;
  }

  function sinalEm(i) {
    var m = S.ind;
    if (i < 1 || m.atr[i] == null) return 0;
    // Com sinal escolhido (SuperTrend, Imperial ou a confluência arbitrada) o
    // gatilho é a virada de lado; o resto do motor — stop, alvo, escada de
    // travas e o resultado em dólar — continua idêntico ao modo dos ciclos.
    if (S.dir && S.dir.length > i) {
      var a = S.dir[i], b = S.dir[i - 1];
      if (a === 1 && b !== 1) return 1;
      if (a === -1 && b !== -1) return -1;
      return 0;
    }
    if (m.e8[i - 1] <= m.e16[i - 1] && m.e8[i] > m.e16[i] && m.rsi[i] > 55) return 1;
    if (m.e8[i - 1] >= m.e16[i - 1] && m.e8[i] < m.e16[i] && m.rsi[i] < 45) return -1;
    return 0;
  }

  // A série de direção do sinal escolhido. Reaproveita o motor do painel
  // (window.supertrendDir / window.confluenciaDir, do main.js) e o Imperial do
  // core, para o gatilho ser exatamente o mesmo indicador que está na tela.
  async function construirDirecao(v) {
    if (!CFG.sinal || CFG.sinal === 'ciclos') return null;
    var dirImperial = null;
    try {
      var mod = await import('./core/imperial.js');
      var imp = mod && mod.imperial ? mod.imperial(v) : null;
      dirImperial = imp && imp.series && Array.isArray(imp.series.dir) ? imp.series.dir : null;
    } catch (e) { dirImperial = null; }
    if (CFG.sinal === 'supertrend2' && typeof window.supertrendDir === 'function') return window.supertrendDir(v, 14, 2);
    if (CFG.sinal === 'supertrend3' && typeof window.supertrendDir === 'function') return window.supertrendDir(v, 14, 3);
    if (CFG.sinal === 'imperial') return dirImperial;
    if (CFG.sinal === 'confluencia' && typeof window.confluenciaDir === 'function') return window.confluenciaDir(v, { nivel: 3 }, dirImperial);
    // CASCATA: quem governa é o cruzamento das EMA 8 x 16 no tempo base, e o
    // mesmo cruzamento precisa estar vivo nos micro-tempos abaixo dele. É o
    // desenho do CONFLUATOR: as EMAs 8/16 andam entre as médias maiores e o
    // cruzamento delas é o gatilho; o micro-tempo é a confirmação.
    if (CFG.sinal === 'cascata') {
      var base = typeof window.emaDir === 'function' ? window.emaDir(v, 8, 16)
        : (typeof window.confluenciaDir === 'function' ? window.confluenciaDir(v, { nivel: 3 }, dirImperial) : null);
      if (!base) return null;
      // 5m/1m vêm do histórico normal; segundos dependem do livro de ticks ao
      // vivo e só entram com a aba visível (em segundo plano o navegador
      // estrangula os timers e a espera estourava)
      var alvos = ['5m', '1m'];
      if (document.visibilityState === 'visible') alvos = alvos.concat(['30s', '15s', '5s']);
      alvos = alvos.filter(function (t) { return segTf(t) < segTf(CFG.tf); });
      // uma leitura por micro-tempo em paralelo, cada uma com teto de tempo: a
      // fonte de segundos pode simplesmente não responder, e a cascata não
      // pode ficar parada esperando por ela.
      var comTeto = function (p, ms) {
        return Promise.race([
          p.catch(function () { return null; }),
          new Promise(function (r) { setTimeout(function () { r(null); }, ms); })
        ]);
      };
      var pedidos = alvos.map(function (t) {
        return comTeto(window.fetchCandles(CFG.ativo, t, 1200), t.indexOf('s') > 0 && t.indexOf('m') < 0 ? 6000 : 4000);
      });
      var respostas = await Promise.all(pedidos);
      var micros = [];
      respostas.forEach(function (mv) {
        if (Array.isArray(mv) && mv.length > 40 && typeof window.emaDir === 'function') {
          micros.push({ velas: mv, dir: window.emaDir(mv, 8, 16) });
        }
      });
      if (!micros.length || typeof window.cascataDir !== 'function') return base;
      return window.cascataDir(base, v, micros, Math.min(2, micros.length));
    }
    return null;
  }

  /* ── modo de teste: uma vela por passo ───────────────────────────── */
  function novoTeste(i0) {
    return { i: i0, pos: null, ciclos: [], equity: 0, aberto: 0, marcadores: [], inicio: i0 };
  }

  function abrir(ctx, i, lado) {
    var risco = CFG.stop * S.ind.atr[i];
    var ent = S.velas[i].close;
    // alvos: 'atr' é o 2R do relatório (padrão), 'fibo' usa a perna do painel,
    // 'medias'/'pilha' projetam a base de médias
    var alvo;
    if (CFG.alvos === 'atr') alvo = { dist: CFG.alvo * risco, nivel: ent + lado * CFG.alvo * risco, nome: 'ATR ' + CFG.alvo + 'R' };
    else if (CFG.alvos === 'fibo') alvo = alvoFibo(i, ent, lado, risco) || { dist: CFG.alvo * risco, nivel: ent + lado * CFG.alvo * risco, nome: 'ATR ' + CFG.alvo + 'R' };
    else alvo = alvoPorMedias(i, ent, lado);
    ctx.pos = {
      lado: lado, i: i, entrada: ent, risco: risco, tamanho: CFG.lote,
      stop: ent - lado * risco, alvo: alvo.nivel, alvoNome: alvo.nome,
      // unidade da escada: no modo relatório ela é o risco (passo de 1R, como
      // sempre foi); nos modos de base ela é a distância até o alvo, então a
      // escada sobe em direção às médias (1/3, 2/3, 3/3 do alvo).
      unidade: CFG.alvos === 'atr' ? risco : alvo.dist, travas: [], usados: {}, pnlTravas: 0
    };
  }

  function fechar(ctx, i, preco, motivo) {
    var p = ctx.pos;
    p.travas.forEach(function (t) {
      if (t.estado === 'aberta') {
        t.resultado = (t.preco - preco) * (-p.lado) * t.tamanho;
        t.estado = 'encerrada'; t.saida = i; p.pnlTravas += t.resultado;
      }
    });
    // principal pode ter sido realizado antes (ex.: travado no stop, virando
    // contra-ordem) — nesse caso o número já está fechado em p.principal
    var principal = p.principal != null ? p.principal : (preco - p.entrada) * p.lado * p.tamanho;
    var hedgeRes = p.hedge ? (p.hedge.resultado || 0) : 0;
    var total = principal + hedgeRes + p.pnlTravas;
    ctx.ciclos.push({
      i: p.i, saida: i, lado: p.lado, entrada: p.entrada, precoSaida: preco, motivo: motivo,
      risco: p.risco, stop: p.stop, alvo: p.alvo, alvoNome: p.alvoNome, unidade: p.unidade,
      principal: principal, travas: p.pnlTravas, hedge: hedgeRes,
      total: total, r: total / (p.risco * p.tamanho), lista: p.travas.slice()
    });
    ctx.equity += total;
    ctx.pos = null;
  }

  function passo(mudo) {
    var ctx = S.teste;
    if (!ctx) return false;
    if (ctx.i >= S.velas.length - 1) { parar(); return false; }
    ctx.i++;
    var i = ctx.i, v = S.velas[i], p = ctx.pos;

    var abriuAgora = false;
    if (!p) {
      var s = sinalEm(i);
      if (s && passaFiltroBase(i, s)) { abrir(ctx, i, s); abriuAgora = true; }
    }

    // a posicao nasce no fechamento desta vela: o range dela ja passou, entao
    // stop, alvo e travas so valem a partir da vela seguinte
    p = ctx.pos;
    if (p && !abriuAgora && p.hedge) {
      // ciclo travado: a contra-ordem é quem decide a saída. O alvo dela é 1R
      // além do stop (empata o prejuízo e começa a lucrar); se o preço voltar
      // ao preço da trava, ela sai no zero e o ciclo fecha no pior caso o stop.
      var h = p.hedge, saiuH = false, precoH = 0;
      if (h.lado === -1) {
        if (v.low <= h.alvo) { h.resultado = (h.preco - h.alvo) * h.tamanho; saiuH = true; precoH = h.alvo; }
        else if (v.high >= h.preco) { h.resultado = 0; saiuH = true; precoH = h.preco; }
      } else {
        if (v.high >= h.alvo) { h.resultado = (h.alvo - h.preco) * h.tamanho; saiuH = true; precoH = h.alvo; }
        else if (v.low <= h.preco) { h.resultado = 0; saiuH = true; precoH = h.preco; }
      }
      if (saiuH) fechar(ctx, i, precoH, h.resultado > 0 ? 'trava de proteção' : 'zero');
    } else if (p && !abriuAgora) {
      var d = p.risco;
      // stop e alvo primeiro: e a ordem conservadora do relatorio
      var stopPego = (p.lado === 1 && v.low <= p.stop) || (p.lado === -1 && v.high >= p.stop);
      if (stopPego && CFG.hedge === 'auto') {
        // TRAVA DE PROTEÇÃO: o stop não encerra no prejuízo, ele VIRA contra-ordem
        // (numa venda do principal, a trava é uma compra) com o mesmo tamanho. O
        // principal fica travado no stop e o ciclo só fecha no zero ou acima —
        // a trava assume o risco e lucra se o preço continuar contra.
        var precoStop = p.lado === 1 ? Math.min(p.stop, v.open) : Math.max(p.stop, v.open);
        p.principal = (precoStop - p.entrada) * p.lado * p.tamanho;
        p.hedge = { lado: -p.lado, preco: precoStop, tamanho: p.tamanho, alvo: precoStop - p.lado * p.risco, resultado: 0 };
      } else if (stopPego) {
        fechar(ctx, i, p.lado === 1 ? Math.min(p.stop, v.open) : Math.max(p.stop, v.open), 'stop');
      }
      else if (p.lado === 1 && v.high >= p.alvo) fechar(ctx, i, p.alvo, 'alvo');
      else if (p.lado === -1 && v.low <= p.alvo) fechar(ctx, i, p.alvo, 'alvo');
    }

    p = ctx.pos;
    if (p && !abriuAgora) {
      var d2 = p.unidade || p.risco;
      CFG.niveis.forEach(function (niv, k) {
        if (p.usados[k]) return;
        var nivel = p.entrada + p.lado * niv * d2;
        if ((p.lado === 1 && v.high >= nivel) || (p.lado === -1 && v.low <= nivel)) {
          p.travas.push({ nivel: niv, preco: nivel, lado: -p.lado, tamanho: CFG.fator * CFG.lote,
                          alvo: nivel - p.lado * CFG.alvoTrava * d2, corte: nivel + p.lado * CFG.corte * d2,
                          aberta: i, estado: 'aberta', resultado: 0 });
          p.usados[k] = 1;
        }
      });
      p.travas.forEach(function (t) {
        if (t.estado !== 'aberta') return;
        if (p.lado === 1) {
          if (v.low <= t.alvo) { t.resultado = (t.preco - t.alvo) * t.tamanho; t.estado = 'alvo'; t.saida = i; p.pnlTravas += t.resultado; }
          else if (v.high >= t.corte) { t.resultado = (t.preco - t.corte) * t.tamanho; t.estado = 'corte'; t.saida = i; p.pnlTravas += t.resultado; }
        } else {
          if (v.high >= t.alvo) { t.resultado = (t.alvo - t.preco) * t.tamanho; t.estado = 'alvo'; t.saida = i; p.pnlTravas += t.resultado; }
          else if (v.low <= t.corte) { t.resultado = (t.corte - t.preco) * t.tamanho; t.estado = 'corte'; t.saida = i; p.pnlTravas += t.resultado; }
        }
      });
    }
    if (!mudo) pintarTeste();
    return true;
  }

  /* ── gráfico ────────────────────────────────────────────────────── */
  function criarGrafico() {
    if (S.chart || !window.LightweightCharts) return;
    // o cartao nasce escondido na gaveta: criar o grafico com 0 de largura
    // deixava os canvas presos em style.width:0px mesmo depois de abrir
    if (!el.graf || el.graf.clientWidth < 60) return;
    S.chart = LightweightCharts.createChart(el.graf, {
      layout: { background: { color: '#ffffff' }, textColor: '#5c6068', fontSize: 10 },
      grid: { vertLines: { color: '#f4f4f6' }, horzLines: { color: '#f4f4f6' } },
      rightPriceScale: { borderColor: C.linha, scaleMargins: { top: 0.14, bottom: 0.14 } },
      timeScale: { borderColor: C.linha, timeVisible: true, secondsVisible: false },
      handleScroll: false, handleScale: false
    });
    S.serie = S.chart.addCandlestickSeries({ upColor: C.verde, downColor: C.vermelho, borderVisible: false, wickUpColor: C.verde, wickDownColor: C.vermelho });
  }
  function limpar() { S.linhas.forEach(function (l) { try { S.serie.removePriceLine(l); } catch (e) {} }); S.linhas = []; }
  function linha(preco, cor, titulo, tracejado) {
    try {
      S.linhas.push(S.serie.createPriceLine({ price: preco, color: cor, lineWidth: 1, lineStyle: tracejado ? 2 : 0, axisLabelVisible: true, title: titulo }));
    } catch (e) {}
  }

  function desenhar() {
    // O cartao abre e fecha (e no celular ele nasce dentro da gaveta): o
    // observer entra antes de criar, senao a criacao adiada nunca seria
    // retomada quando o cartao ganhasse largura.
    var host = el.graf;
    if (typeof ResizeObserver !== 'undefined' && host && !el._rxObs) {
      el._rxObs = new ResizeObserver(function () { try { desenhar(); } catch (e) {} });
      el._rxObs.observe(host);
    }
    criarGrafico();
    if (!S.serie) return;
    var larg = host ? host.clientWidth : 0, alt = host ? host.clientHeight : 0;
    if (S.chart && larg > 0 && alt > 0) {
      // resize() em vez de applyOptions condicional: o grafico nascido com 0 de
      // largura reportava o tamanho certo em options() mas deixava os canvas em
      // style.width:0px — medido aqui, 7 canvas com 0px de largura.
      try {
        if (typeof S.chart.resize === 'function') S.chart.resize(larg, alt);
        else S.chart.applyOptions({ width: larg, height: alt });
      } catch (e) {}
    }
    var ctx = S.teste;
    var ate = ctx ? ctx.i : S.velas.length - 1;
    var de = Math.max(0, ate - 260);
    S.serie.setData(S.velas.slice(de, ate + 1).map(function (x) { return { time: x.time, open: x.open, high: x.high, low: x.low, close: x.close }; }));
    limpar();
    var marcas = [];
    if (ctx) {
      ctx.ciclos.forEach(function (c) {
        if (c.i < de) return;
        marcas.push({ time: S.velas[c.i].time, position: c.lado === 1 ? 'belowBar' : 'aboveBar', color: C.tinta, shape: c.lado === 1 ? 'arrowUp' : 'arrowDown', text: (c.lado === 1 ? 'C ' : 'V ') + n(c.entrada, 0) });
        marcas.push({ time: S.velas[c.saida].time, position: 'aboveBar', color: c.total >= 0 ? C.verde : C.vermelho, shape: 'circle', text: c.motivo + ' ' + usd(c.total) });
        c.lista.forEach(function (t) {
          if (t.aberta >= de) marcas.push({ time: S.velas[t.aberta].time, position: t.lado === 1 ? 'belowBar' : 'aboveBar', color: C.ouro, shape: 'square', text: Math.round(t.nivel * 100) / 100 + 'R' });
        });
      });
      var p = ctx.pos;
      if (p) {
        marcas.push({ time: S.velas[p.i].time, position: p.lado === 1 ? 'belowBar' : 'aboveBar', color: C.vermelho, shape: p.lado === 1 ? 'arrowUp' : 'arrowDown', text: (p.lado === 1 ? 'COMPRA ' : 'VENDA ') + n(p.entrada, 0) });
        linha(p.entrada, '#5c6068', 'entrada', true);
        linha(p.stop, C.vermelho, 'stop');
        linha(p.alvo, C.verde, 'alvo 2R');
        p.travas.forEach(function (t) { linha(t.preco, C.ouro, Math.round(t.nivel * 100) / 100 + 'R', true); });
      }
    }
    try { S.serie.setMarkers(marcas.sort(function (a, b) { return a.time - b.time; })); } catch (e) {}
    S.chart.timeScale().fitContent();
  }

  /* ── painéis ────────────────────────────────────────────────────── */
  function pintarTeste() {
    var ctx = S.teste;
    if (!ctx) { el.estado.innerHTML = '<i>modo de teste parado</i><b>--</b>'; return; }
    var p = ctx.pos, v = S.velas[ctx.i];
    var aberto = 0;
    if (p) {
      aberto = (v.close - p.entrada) * p.lado * p.tamanho;
      p.travas.forEach(function (t) { if (t.estado === 'aberta') aberto += (t.preco - v.close) * (-p.lado) * t.tamanho; });
    }
    var acertos = ctx.ciclos.filter(function (c) { return c.total > 0; }).length;
    var cls = function (x) { return x >= 0 ? 'rc-pos' : 'rc-neg'; };
    el.estado.innerHTML = [
      ['estado', p ? '<span class="' + (p.lado === 1 ? 'rc-pos' : 'rc-neg') + '">' + (p.lado === 1 ? 'COMPRADO' : 'VENDIDO') + '</span>' : 'fora do mercado'],
      ['vela', hhmm(v.time) + ' · ' + n(v.close, 1)],
      ['entrada', p ? n(p.entrada, 1) : '--'],
      ['stop / alvo', p ? n(p.stop, 1) + ' / ' + n(p.alvo, 1) + (p.alvoNome ? ' · ' + p.alvoNome : '') : '--'],
      ['travas abertas', p ? String(p.travas.filter(function (t) { return t.estado === 'aberta'; }).length) : '0'],
      ['resultado aberto', '<span class="' + cls(aberto) + '">' + usd(aberto) + '</span>'],
      ['ciclos fechados', String(ctx.ciclos.length)],
      ['acerto', ctx.ciclos.length ? Math.round(acertos / ctx.ciclos.length * 100) + '%' : '--'],
      ['resultado acumulado', '<span class="' + cls(ctx.equity + aberto) + '">' + usd(ctx.equity + aberto) + '</span>']
    ].map(function (l) { return '<i>' + l[0] + '</i><b>' + l[1] + '</b>'; }).join('');

    // livro de ordens vivo
    var linhas = ['<tr><th>ordem</th><th>lado</th><th class="n">preço</th><th class="n">tamanho</th><th>estado</th><th class="n">resultado</th></tr>'];
    if (p) {
      linhas.push('<tr class="principal"><td>principal</td><td>' + (p.lado === 1 ? 'compra' : 'venda') + '</td><td class="n">' + n(p.entrada, 1) + '</td><td class="n">' + n(p.tamanho, 2) + '</td><td><span class="rc-pill aberta">aberta</span></td><td class="n ' + cls(aberto) + '">' + usd(aberto) + '</td></tr>');
      if (p.hedge) {
        linhas.push('<tr class="principal"><td>trava de proteção</td><td>' + (p.hedge.lado === 1 ? 'compra' : 'venda') +
          '</td><td class="n">' + n(p.hedge.preco, 1) + '</td><td class="n">' + n(p.hedge.tamanho, 2) +
          '</td><td><span class="rc-pill aberta">aberta</span></td><td class="n">' + usd(p.hedge.resultado || 0) + '</td></tr>');
      }
      p.travas.forEach(function (t, k) {
        linhas.push('<tr><td>trava ' + (k + 1) + ' · ' + (Math.round(t.nivel * 100) / 100) + 'R</td><td>' + (t.lado === 1 ? 'compra' : 'venda') + '</td><td class="n">' + n(t.preco, 1) + '</td><td class="n">' + n(t.tamanho, 3) + '</td><td><span class="rc-pill ' + t.estado + '">' + t.estado + '</span></td><td class="n ' + cls(t.resultado) + '">' + usd(t.resultado) + '</td></tr>');
      });
    } else {
      var ult = ctx.ciclos[ctx.ciclos.length - 1];
      if (ult) {
        linhas.push('<tr class="principal"><td>último ciclo</td><td>' + (ult.lado === 1 ? 'compra' : 'venda') + '</td><td class="n">' + n(ult.entrada, 1) + '</td><td class="n">' + n(CFG.lote, 2) + '</td><td><span class="rc-pill ' + (ult.motivo === 'alvo' ? 'alvo' : 'corte') + '">' + ult.motivo + '</span></td><td class="n ' + cls(ult.total) + '">' + usd(ult.total) + '</td></tr>');
        ult.lista.forEach(function (t, k) {
          linhas.push('<tr><td>trava ' + (k + 1) + ' · ' + (Math.round(t.nivel * 100) / 100) + 'R</td><td>' + (t.lado === 1 ? 'compra' : 'venda') + '</td><td class="n">' + n(t.preco, 1) + '</td><td class="n">' + n(t.tamanho, 3) + '</td><td><span class="rc-pill ' + t.estado + '">' + t.estado + '</span></td><td class="n ' + cls(t.resultado) + '">' + usd(t.resultado) + '</td></tr>');
        });
      } else linhas.push('<tr><td colspan="6" style="color:#8a8f98">aguardando o próximo cruzamento</td></tr>');
    }
    el.livro.innerHTML = linhas.join('');

    // proximo disparo
    var i = ctx.i, m = S.ind;
    if (m && m.atr[i] != null) {
      var r = m.rsi[i], at = m.atr[i], preco = v.close;
      var ladoPrev = m.e8[i] > m.e16[i] ? 1 : -1;
      var alvoPrev = alvoPorMedias(i, preco, ladoPrev);
      var baseTxt = m.base.map(function (b) {
        return b.nome.replace('EMA ', 'e').replace('MA ', 'm') + ' ' + (b.s[i] != null ? n(b.s[i], 0) : '--');
      }).join(' · ');
      el.disparo.innerHTML = [
        ['cruzamento', m.e8[i] > m.e16[i] ? 'EMA8 acima' : 'EMA8 abaixo'],
        ['RSI 14', n(r, 1) + (r > 55 ? ' · força de compra' : r < 45 ? ' · força de venda' : ' · sem força')],
        ['ATR 14', n(at, 1)],
        ['base de médias', baseTxt],
        ['alvo pela base', n(alvoPrev.nivel, 1) + ' · ' + alvoPrev.nome],
        ['se entrar agora', 'stop ' + n(preco - ladoPrev * at, 1) + ' · risco 1 ATR']
      ].map(function (l) { return '<i>' + l[0] + '</i><b>' + l[1] + '</b>'; }).join('');
    }
    desenhar();
  }

  /* ── controles ──────────────────────────────────────────────────── */
  function serieDoPainel() {
    try {
      if (typeof candles !== 'undefined' && Array.isArray(candles) && candles.length > 80) {
        if (typeof currentSym !== 'undefined' && currentSym) CFG.ativo = currentSym;
        if (typeof currentTF !== 'undefined' && currentTF) CFG.tf = currentTF;
        return norm(candles);
      }
    } catch (e) {}
    return null;
  }

  async function carregarVelas() {
    // 1) a serie do proprio grafico: mesma fonte e mesma abertura de vela, sem deslocamento
    var p = serieDoPainel();
    if (p && p.length > 80) return p;
    try {
      if (typeof window.fetchCandles === 'function') {
        var v = await window.fetchCandles(CFG.ativo, CFG.tf, 1500);
        if (Array.isArray(v) && v.length > 80) return norm(v);
      }
    } catch (e) {}
    // 2) o deposito do impressor: o historico ja lido fica guardado no navegador
    // e vale mais que uma nova chamada de rede (funciona mesmo offline)
    try {
      if (window.ImpressorAtlas) {
        var dep = await window.ImpressorAtlas.serie(CFG.ativo, CFG.tf);
        if (Array.isArray(dep) && dep.length > 80) return norm(dep);
      }
    } catch (e) {}
    try {
      var r = await fetch(PONTE + '/velas?sym=' + encodeURIComponent(CFG.ativo) + '&tf=' + encodeURIComponent(CFG.tf) + '&alvo=1500', { cache: 'no-store' });
      var d = await r.json();
      if (d && d.velas && d.velas.length > 80) return norm(d.velas);
    } catch (e) {}
    // espelho: so segura a tela quando o principal nao responde
    try {
      var r2 = await fetch(PONTE + '/pacote?sym=' + encodeURIComponent(CFG.ativo) + '&tf=' + encodeURIComponent(CFG.tf) + '&alvo=1500', { cache: 'no-store' });
      var d2 = await r2.json();
      return norm(d2.velas || []);
    } catch (e) {
      try {
        var dep2 = window.ImpressorAtlas ? await window.ImpressorAtlas.serie(CFG.ativo, CFG.tf) : null;
        if (Array.isArray(dep2)) return norm(dep2);
      } catch (e2) {}
      return [];
    }
  }
  function norm(l) {
    var out = [], vistos = {};
    (l || []).forEach(function (c) {
      var o = Array.isArray(c)
        ? { time: Number(c[0]), open: Number(c[1]), close: Number(c[2]), high: Number(c[3]), low: Number(c[4]) }
        : { time: Number(c.time), open: Number(c.open), close: Number(c.close), high: Number(c.high), low: Number(c.low) };
      if (o.time > 1e11) o.time = Math.floor(o.time / 1000);
      if (!isFinite(o.time) || !isFinite(o.close) || o.high < o.low) return;
      if (vistos[o.time]) return;
      vistos[o.time] = 1; out.push(o);
    });
    out.sort(function (a, b) { return a.time - b.time; });
    return out;
  }

  // velasExternas: serie pronta (ex.: core/dados/m15_btcusdt_15m.json) para
  // estudar o robo em papel sem depender da ponte nem do modo ao vivo.
  async function preparar(velasExternas) {
    el.rodar.textContent = 'lendo...'; el.rodar.disabled = true;
    var externa = Array.isArray(velasExternas) && velasExternas.length > 80;
    try {
      S.velas = externa ? norm(velasExternas) : await carregarVelas();
      if (S.velas.length < 80) throw new Error('série curta');
      S.ind = indicadores(S.velas);
      S.dir = await construirDirecao(S.velas);
      // serie externa e a serie inteira do estudo: o teste comeca no primeiro
      // ponto valido para estudar todos os ciclos, e nao na janela dos ultimos
      // 900 que o acompanhamento ao vivo usa
      S.teste = novoTeste(externa ? 20 : Math.max(20, S.velas.length - 900));
      pintarTeste();
      el.aviso.textContent = externa
        ? 'Série do estudo · ' + S.velas.length + ' velas de ' + CFG.tf + ' em ' + CFG.ativo + '. O robô opera vela por vela sobre ela: ▶ testar segue de onde parou.'
        : 'Série real de ' + S.velas.length + ' velas de ' + CFG.tf + ' em ' + CFG.ativo + '. Teste posicionado no início da janela: toque em ▶ para o robô operar vela por vela, como se fosse ao vivo.';
    } catch (e) {
      el.aviso.textContent = 'Não consegui ler a série agora. Toque em Rodar de novo em alguns segundos.';
    } finally { el.rodar.textContent = 'Rodar'; el.rodar.disabled = false; }
  }

  function tocar() {
    if (S.timer) { parar(); return; }
    if (!S.teste) { preparar().then(tocar); return; }
    el.play.classList.add('on'); el.play.textContent = '❚❚';
    S.timer = setInterval(function () { if (!passo()) parar(); }, S.ms);
  }
  function parar() {
    if (S.timer) clearInterval(S.timer);
    S.timer = null;
    if (el.play) { el.play.classList.remove('on'); el.play.textContent = '▶'; }
  }
  function avancar(k) {
    parar();
    if (!S.teste) { preparar().then(function () { avancar(k); }); return; }
    for (var i = 0; i < (k || 1); i++) { if (!passo()) break; }
  }
  /* ── modo ao vivo: o robo acompanha a vela que esta formando ─────── */
  var CHAVE = 'vx.robo.vivo.v1';
  function lerPref() { try { return JSON.parse(localStorage.getItem(CHAVE) || '{}'); } catch (e) { return {}; } }
  function gravarPref(o) { try { localStorage.setItem(CHAVE, JSON.stringify(o)); } catch (e) {} }
  function chaveInicio() { return CFG.ativo + '|' + CFG.tf; }

  function inicioDoTeste(v) {
    var p = lerPref(), ts = p[chaveInicio()];
    if (!ts) {
      ts = v[Math.max(20, v.length - 1200)].time;
      p[chaveInicio()] = ts; gravarPref(p);
    }
    for (var i = 0; i < v.length; i++) if (v[i].time >= ts) return Math.max(20, i);
    return Math.max(20, v.length - 1200);
  }

  async function vivoRodar() {
    if (!S.vivo) return;
    try {
      el.vivoLinha.textContent = 'lendo a série...';
      var v = await carregarVelas();
      if (!Array.isArray(v) || v.length < 80) throw new Error('serie curta');
      S.velas = v; S.ind = indicadores(v);
      S.dir = await construirDirecao(v);
      S.teste = novoTeste(inicioDoTeste(v));
      S.silencioso = true;
      var guarda = 0;
      while (S.teste.i < v.length - 1 && guarda++ < 6000) passo(true);
      S.silencioso = false;
      pintarTeste();
      var ult = v[v.length - 1], ctx = S.teste;
      var aberto = 0;
      if (ctx.pos) {
        aberto = (ult.close - ctx.pos.entrada) * ctx.pos.lado * ctx.pos.tamanho;
        ctx.pos.travas.forEach(function (t) { if (t.estado === 'aberta') aberto += (t.preco - ult.close) * (-ctx.pos.lado) * t.tamanho; });
      }
      el.vivoLinha.innerHTML = '<b>● AO VIVO</b> · vela ' + hhmm(ult.time) + ' · ' + n(ult.close, 1) +
        ' · ciclos ' + ctx.ciclos.length + ' · acumulado <span class="' + ((ctx.equity + aberto) >= 0 ? 'rc-pos' : 'rc-neg') + '">' + usd(ctx.equity + aberto) + '</span>' +
        ' · atualizado ' + hhmm(Math.floor(Date.now() / 1000));
    } catch (e) {
      el.vivoLinha.textContent = 'sem leitura agora, tento de novo em 20s';
    }
  }

  function vivoLigar() {
    S.vivo = true;
    el.vivo.classList.add('on'); el.vivo.textContent = '● ao vivo';
    if (S.timer) parar();
    vivoRodar();
    S.vivoTimer = setInterval(vivoRodar, 20000);
  }
  function vivoDesligar() {
    S.vivo = false;
    if (S.vivoTimer) clearInterval(S.vivoTimer);
    S.vivoTimer = null;
    el.vivo.classList.remove('on'); el.vivo.textContent = '● ao vivo';
    el.vivoLinha.textContent = 'modo ao vivo desligado';
  }
  function alternarVivo() { if (S.vivo) vivoDesligar(); else vivoLigar(); }

  function reiniciar() {
    parar();
    if (!S.velas.length) { preparar(); return; }
    S.teste = novoTeste(Math.max(20, S.velas.length - 900));
    pintarTeste();
  }

  /* ── interface ──────────────────────────────────────────────────── */
  function estilo() {
    if (document.getElementById('rc-estilo')) return;
    var s = document.createElement('style'); s.id = 'rc-estilo';
    s.textContent = [
      // a media query olha a janela, mas o cartao vive numa gaveta de ~300px:
      // sem container query ele continuava em duas colunas e o grafico ficava
      // com 128px de largura
      '#robo-ciclos-card{background:#fff;border:1px solid ' + C.linha + ';border-radius:12px;padding:10px 11px;font-family:Inter,system-ui,sans-serif;color:' + C.tinta + ';font-size:11px;container-type:inline-size}',
      '#robo-ciclos-card *{box-sizing:border-box}',
      '.rc-topo{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;margin-bottom:8px}',
      '.rc-campo{display:flex;flex-direction:column;gap:2px}',
      '.rc-campo span{font-size:8px;letter-spacing:.6px;text-transform:uppercase;color:' + C.fraco + '}',
      'select.rc-sel{border:1px solid ' + C.linha + ';border-radius:7px;padding:4px 6px;font-size:11px;font-family:inherit;background:#fff;color:' + C.tinta + '}',
      '.rc-btn{border:1px solid ' + C.linha + ';background:#fff;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;color:' + C.tinta + ';min-height:32px;font-family:inherit}',
      '.rc-btn.on{background:' + C.vermelho + ';border-color:' + C.vermelho + ';color:#fff}',
      '.rc-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:8px}',
      '@media(max-width:820px){.rc-grid{grid-template-columns:1fr}}',
      '@container (max-width:560px){.rc-grid{grid-template-columns:minmax(0,1fr)}.rc-graf{height:200px}}',
      '.rc-bloco{border:1px solid ' + C.linha + ';border-radius:10px;padding:8px;background:#fff}',
      '.rc-bloco h4{margin:0 0 6px;font-size:8.5px;letter-spacing:1px;text-transform:uppercase;color:' + C.fraco + ';font-weight:700}',
      '.rc-graf{height:250px;width:100%;border-radius:8px;overflow:hidden}',
      '@media(max-width:820px){.rc-graf{height:200px}}',
      '.rc-kv{display:grid;grid-template-columns:1fr auto;gap:3px 8px;font-size:11px;font-variant-numeric:tabular-nums}',
      '.rc-kv i{font-style:normal;color:' + C.fraco + '}',
      '.rc-kv b{font-weight:600;text-align:right}',
      '.rc-livro{width:100%;border-collapse:collapse;font-size:10.5px;font-variant-numeric:tabular-nums}',
      '.rc-livro th{text-align:left;font-size:8px;letter-spacing:.5px;text-transform:uppercase;color:' + C.fraco + ';border-bottom:1px solid ' + C.linha + ';padding:3px 2px;font-weight:700}',
      '.rc-livro td{border-bottom:1px solid #f2f2f4;padding:3px 2px;white-space:nowrap}',
      '.rc-livro td.n,.rc-livro th.n{text-align:right}',
      '.rc-livro tr.principal td{background:#fbfbfc;font-weight:600}',
      '.rc-pos{color:' + C.verde + ';font-weight:700}', '.rc-neg{color:' + C.vermelho + ';font-weight:700}',
      '.rc-pill{display:inline-block;padding:1px 6px;border-radius:99px;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}',
      '.rc-pill.alvo{background:#eaf6ef;color:' + C.verde + '}', '.rc-pill.corte{background:#fdecec;color:' + C.vermelho + '}',
      '.rc-pill.aberta{background:#fff4e0;color:#8a6200}', '.rc-pill.encerrada{background:#f0f0f2;color:' + C.fraco + '}',
      '.rc-vivo-linha{font-size:10px;color:' + C.fraco + ';margin:0 0 8px;font-variant-numeric:tabular-nums}',
      '.rc-vivo-linha b{color:' + C.vermelho + ';letter-spacing:.5px}',
      '.rc-aviso{font-size:9.5px;color:' + C.fraco + ';line-height:1.45;margin-top:7px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function montar() {
    estilo();
    var card = document.createElement('div');
    card.id = 'robo-ciclos-card'; card.style.display = 'none';
    card.innerHTML = [
      '<div class="rc-topo">',
      ' <label class="rc-campo"><span>ativo</span><select class="rc-sel" id="rc-ativo"><option value="BTCUSDT">BTC</option><option value="ETHUSDT">ETH</option><option value="ZECUSDT">ZEC</option></select></label>',
      ' <label class="rc-campo"><span>tempo</span><select class="rc-sel" id="rc-tf"><option>1m</option><option>3m</option><option>5m</option><option selected>15m</option><option>1h</option><option>4h</option></select></label>',
      ' <label class="rc-campo"><span>lote</span><select class="rc-sel" id="rc-lote"><option value="0.01">0,01</option><option value="0.03">0,03</option><option value="0.06">0,06</option></select></label>',
      ' <label class="rc-campo"><span>sinal</span><select class="rc-sel" id="rc-sinal"><option value="ciclos">Ciclos (EMA 8×16 + RSI)</option><option value="supertrend2">SuperTrend ATR ×2</option><option value="supertrend3">SuperTrend ATR ×3</option><option value="imperial">Imperial (ZEMA+KAMA)</option><option value="confluencia">Confluência (9 votos)</option><option value="cascata">Cascata EMA 8×16 + micro</option></select></label>',
      ' <label class="rc-campo"><span>alvos</span><select class="rc-sel" id="rc-alvos"><option value="atr" selected>ATR 2R (relatório)</option><option value="fibo">Fibo (alvo da perna)</option><option value="medias">Base: meia pilha</option><option value="pilha">Base: pilha inteira</option></select></label>',
      ' <label class="rc-campo"><span>filtro</span><select class="rc-sel" id="rc-filtro"><option value="base">Base a favor</option><option value="livre">Livre</option></select></label>',
      ' <label class="rc-campo"><span>proteção</span><select class="rc-sel" id="rc-hedge"><option value="auto">Stop vira trava</option><option value="nada">Stop normal</option></select></label>',
      ' <label class="rc-campo"><span>ritmo</span><select class="rc-sel" id="rc-ms"><option value="500">lento</option><option value="220" selected>normal</option><option value="80">rápido</option></select></label>',
      ' <button type="button" class="rc-btn" id="rc-rodar">Rodar</button>',
      ' <button type="button" class="rc-btn" id="rc-play">▶ testar</button>',
      ' <button type="button" class="rc-btn" id="rc-prox">+1 vela</button>',
      ' <button type="button" class="rc-btn" id="rc-ciclo">+1 ciclo</button>',
      ' <button type="button" class="rc-btn" id="rc-reset">reiniciar</button>',
      ' <button type="button" class="rc-btn" id="rc-vivo">● ao vivo</button>',
      ' <button type="button" class="rc-btn" id="rc-abrir-vivo">abrir ao vivo ›</button>',
      '</div>',
      '<div class="rc-vivo-linha" id="rc-vivo-linha">modo ao vivo desligado</div>',
      '<div class="rc-grid">',
      ' <div class="rc-bloco"><h4>Operação em papel · vela por vela</h4><div class="rc-graf" id="rc-graf"></div></div>',
      ' <div class="rc-bloco"><h4>Conta do teste</h4><div class="rc-kv" id="rc-estado"></div>',
      '  <h4 style="margin-top:10px">Próximo disparo</h4><div class="rc-kv" id="rc-disparo"></div></div>',
      '</div>',
      '<div class="rc-bloco" style="margin-top:8px"><h4>Livro de ordens</h4><div style="max-height:200px;overflow:auto"><table class="rc-livro" id="rc-livro"></table></div></div>',
      '<div class="rc-aviso" id="rc-aviso">Toque em Rodar para carregar a série real. Depois ▶ testar: o robô entra no cruzamento com RSI, coloca stop de 1,0 ATR, alvo de 2R e as travas da escada em 1/3, 2/3, 3/3, 4/3 e 5/3 de R, mostrando cada ordem no livro e cada giro no gráfico.</div>'
    ].join('');
    document.body.appendChild(card);

    el.card = card;
    el.ativo = card.querySelector('#rc-ativo'); el.tf = card.querySelector('#rc-tf');
    el.lote = card.querySelector('#rc-lote'); el.ms = card.querySelector('#rc-ms');
    el.sinal = card.querySelector('#rc-sinal');
    el.sinal.value = CFG.sinal;
    el.alvos = card.querySelector('#rc-alvos');
    el.alvos.value = CFG.alvos;
    el.filtro = card.querySelector('#rc-filtro');
    el.filtro.value = CFG.filtro;
    el.hedge = card.querySelector('#rc-hedge');
    el.hedge.value = CFG.hedge;
    el.hedge.addEventListener('change', function () {
      CFG.hedge = el.hedge.value;
      var velas = S.velas.slice();
      parar();
      if (velas.length > 80) preparar(velas); else preparar();
    });
    el.filtro.addEventListener('change', function () {
      CFG.filtro = el.filtro.value;
      var velas = S.velas.slice();
      parar();
      if (velas.length > 80) preparar(velas); else preparar();
    });
    el.alvos.addEventListener('change', function () {
      CFG.alvos = el.alvos.value;
      var velas = S.velas.slice();
      parar();
      if (velas.length > 80) preparar(velas); else preparar();
    });
    el.sinal.addEventListener('change', function () {
      CFG.sinal = el.sinal.value;
      var velas = S.velas.slice();
      parar();
      if (velas.length > 80) preparar(velas); else preparar();
    });
    el.rodar = card.querySelector('#rc-rodar'); el.play = card.querySelector('#rc-play');
    el.prox = card.querySelector('#rc-prox'); el.ciclo = card.querySelector('#rc-ciclo');
    el.reset = card.querySelector('#rc-reset');
    el.vivo = card.querySelector('#rc-vivo');
    el.vivoLinha = card.querySelector('#rc-vivo-linha');
    el.graf = card.querySelector('#rc-graf'); el.estado = card.querySelector('#rc-estado');
    el.disparo = card.querySelector('#rc-disparo'); el.livro = card.querySelector('#rc-livro');
    el.aviso = card.querySelector('#rc-aviso');

    el.rodar.addEventListener('click', preparar);
    el.play.addEventListener('click', tocar);
    el.prox.addEventListener('click', function () { avancar(1); });
    el.ciclo.addEventListener('click', function () { avancar(40); });
    el.reset.addEventListener('click', reiniciar);
    el.vivo.addEventListener('click', alternarVivo);
    var bv = card.querySelector('#rc-abrir-vivo');
    if (bv) bv.addEventListener('click', function () { var b = document.querySelector('.vx-aba[data-aba="robo-vivo-card"]'); if (b) b.click(); });
    el.ms.addEventListener('change', function () { S.ms = Number(el.ms.value); if (S.timer) { parar(); tocar(); } });
    el.ativo.addEventListener('change', function () { CFG.ativo = el.ativo.value; reiniciar(); });
    el.tf.addEventListener('change', function () { CFG.tf = el.tf.value; reiniciar(); });
    el.lote.addEventListener('change', function () { CFG.lote = Number(el.lote.value); });
  }

  function iniciar() { if (!document.getElementById('robo-ciclos-card')) montar(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else setTimeout(iniciar, 60);

  // pintar/desenhar expostos para quem conduz o teste por fora (painel da
  // escada), que avanca as velas em silencio e repinta uma vez no fim
  window.RoboCiclos = { preparar: preparar, passo: passo, estado: S, config: CFG, pintar: pintarTeste, desenhar: desenhar,
    direcao: function () { return S.dir; }, definirSinal: function (s) { CFG.sinal = s; }, construirDirecao: construirDirecao };
})();
