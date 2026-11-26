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
              niveis: [1 / 3, 2 / 3, 1, 4 / 3, 5 / 3] };

  var S = {
    velas: [], ind: null, motor: null,
    chart: null, serie: null, linhas: [], marcadores: [],
    teste: null, timer: null, ms: 220, indice: 0
  };
  var el = {};
  var C = { tinta: '#1c1c1e', fraco: '#8a8f98', linha: '#e4e4e6', vermelho: '#c8102e', verde: '#1f7a4d', ouro: '#c8a000' };

  function n(v, c) { var x = Number(v); if (!isFinite(x)) return '--'; return x.toLocaleString('pt-BR', { minimumFractionDigits: c == null ? 2 : c, maximumFractionDigits: c == null ? 2 : c }); }
  function usd(v) { return (v >= 0 ? '+' : '') + n(v, 2); }
  function hhmm(t) { var d = new Date(t * 1000); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function diahora(t) { var d = new Date(t * 1000); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' + hhmm(t); }
  function segTf(tf) { return ({ '1m': 60, '3m': 180, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 })[tf] || 900; }

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
  function indicadores(v) {
    var cl = v.map(function (x) { return x.close; });
    return { e8: ema(cl, 8), e16: ema(cl, 16), rsi: rsiCalc(cl, 14), atr: atrCalc(v, 14) };
  }
  function sinalEm(i) {
    var m = S.ind;
    if (i < 1 || m.atr[i] == null) return 0;
    if (m.e8[i - 1] <= m.e16[i - 1] && m.e8[i] > m.e16[i] && m.rsi[i] > 55) return 1;
    if (m.e8[i - 1] >= m.e16[i - 1] && m.e8[i] < m.e16[i] && m.rsi[i] < 45) return -1;
    return 0;
  }

  /* ── modo de teste: uma vela por passo ───────────────────────────── */
  function novoTeste(i0) {
    return { i: i0, pos: null, ciclos: [], equity: 0, aberto: 0, marcadores: [], inicio: i0 };
  }

  function abrir(ctx, i, lado) {
    var risco = CFG.stop * S.ind.atr[i];
    var ent = S.velas[i].close;
    ctx.pos = {
      lado: lado, i: i, entrada: ent, risco: risco, tamanho: CFG.lote,
      stop: ent - lado * risco, alvo: ent + lado * CFG.alvo * risco,
      travas: [], usados: {}, pnlTravas: 0
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
    var principal = (preco - p.entrada) * p.lado * p.tamanho;
    var total = principal + p.pnlTravas;
    ctx.ciclos.push({
      i: p.i, saida: i, lado: p.lado, entrada: p.entrada, precoSaida: preco, motivo: motivo,
      risco: p.risco, stop: p.stop, alvo: p.alvo, principal: principal, travas: p.pnlTravas,
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
      if (s) { abrir(ctx, i, s); abriuAgora = true; }
    }

    // a posicao nasce no fechamento desta vela: o range dela ja passou, entao
    // stop, alvo e travas so valem a partir da vela seguinte
    p = ctx.pos;
    if (p && !abriuAgora) {
      var d = p.risco;
      // stop e alvo primeiro: e a ordem conservadora do relatorio
      if (p.lado === 1 && v.low <= p.stop) fechar(ctx, i, Math.min(p.stop, v.open), 'stop');
      else if (p.lado === -1 && v.high >= p.stop) fechar(ctx, i, Math.max(p.stop, v.open), 'stop');
      else if (p.lado === 1 && v.high >= p.alvo) fechar(ctx, i, p.alvo, 'alvo');
      else if (p.lado === -1 && v.low <= p.alvo) fechar(ctx, i, p.alvo, 'alvo');
    }

    p = ctx.pos;
    if (p && !abriuAgora) {
      var d2 = p.risco;
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
    criarGrafico();
    if (!S.serie) return;
    // O cartao abre e fecha (e no celular ele nasce dentro da gaveta): se o
    // grafico foi criado escondido, ele fica com 0 de largura e nao se ajusta
    // sozinho quando aparece. Aqui ele e redimensionado para o container atual
    // antes de pintar, senao a serie e as marcas somem.
    var host = el.graf;
    // quando o cartao aparece (aba aberta, gaveta do celular), o tamanho muda:
    // repinta para o grafico ocupar a largura real
    if (typeof ResizeObserver !== 'undefined' && host && !el._rxObs) {
      el._rxObs = new ResizeObserver(function () { try { desenhar(); } catch (e) {} });
      el._rxObs.observe(host);
    }
    var larg = host ? host.clientWidth : 0, alt = host ? host.clientHeight : 0;
    if (S.chart && larg > 0 && alt > 0) {
      try {
        var atual = S.chart.options ? S.chart.options() : null;
        if (!atual || atual.width !== larg || atual.height !== alt) S.chart.applyOptions({ width: larg, height: alt });
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
      ['stop / alvo', p ? n(p.stop, 1) + ' / ' + n(p.alvo, 1) : '--'],
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
      el.disparo.innerHTML = [
        ['cruzamento', m.e8[i] > m.e16[i] ? 'EMA8 acima' : 'EMA8 abaixo'],
        ['RSI 14', n(r, 1) + (r > 55 ? ' · força de compra' : r < 45 ? ' · força de venda' : ' · sem força')],
        ['ATR 14', n(at, 1)],
        ['risco por lote', 'US$ ' + n(at * CFG.lote, 2)],
        ['se entrar agora', 'stop ' + n(preco - at, 1) + ' · alvo ' + n(preco + 2 * at, 1)]
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
    try {
      var r = await fetch(PONTE + '/velas?sym=' + encodeURIComponent(CFG.ativo) + '&tf=' + encodeURIComponent(CFG.tf) + '&alvo=1500', { cache: 'no-store' });
      var d = await r.json();
      if (d && d.velas && d.velas.length > 80) return norm(d.velas);
    } catch (e) {}
    // espelho: so segura a tela quando o principal nao responde
    var r2 = await fetch(PONTE + '/pacote?sym=' + encodeURIComponent(CFG.ativo) + '&tf=' + encodeURIComponent(CFG.tf) + '&alvo=1500', { cache: 'no-store' });
    var d2 = await r2.json();
    return norm(d2.velas || []);
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
      '#robo-ciclos-card{background:#fff;border:1px solid ' + C.linha + ';border-radius:12px;padding:10px 11px;font-family:Inter,system-ui,sans-serif;color:' + C.tinta + ';font-size:11px}',
      '#robo-ciclos-card *{box-sizing:border-box}',
      '.rc-topo{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;margin-bottom:8px}',
      '.rc-campo{display:flex;flex-direction:column;gap:2px}',
      '.rc-campo span{font-size:8px;letter-spacing:.6px;text-transform:uppercase;color:' + C.fraco + '}',
      'select.rc-sel{border:1px solid ' + C.linha + ';border-radius:7px;padding:4px 6px;font-size:11px;font-family:inherit;background:#fff;color:' + C.tinta + '}',
      '.rc-btn{border:1px solid ' + C.linha + ';background:#fff;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;color:' + C.tinta + ';min-height:32px;font-family:inherit}',
      '.rc-btn.on{background:' + C.vermelho + ';border-color:' + C.vermelho + ';color:#fff}',
      '.rc-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:8px}',
      '@media(max-width:820px){.rc-grid{grid-template-columns:1fr}}',
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
  window.RoboCiclos = { preparar: preparar, passo: passo, estado: S, config: CFG, pintar: pintarTeste, desenhar: desenhar };
})();
