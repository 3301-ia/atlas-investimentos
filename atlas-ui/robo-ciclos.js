// VECTRA · Robô de ciclos com escada de travas
//
// Aba nova do painel: o robô roda o fluxo de giro sobre a série real de velas e
// mostra, ciclo por ciclo, o livro de ordens (principal + travas da escada), o
// ponto exato de cada disparo e o gráfico desenhado igual ao que o motor fez.
//
// Regras (validadas no relatório técnico de 20/11/2026):
//   entrada   cruzamento EMA8 x EMA16 confirmado por RSI (>55 compra, <45 venda)
//   stop      1,0 ATR
//   alvo      2,0 R
//   escada    travas em 1/3, 2/3, 3/3, 4/3 e 5/3 de R, fator 0,60
//   trava     alvo +0,5 R e corte -0,5 R
(function () {
  'use strict';
  if (document.getElementById('robo-ciclos-card')) return;

  var PONTE = (function () {
    try { return (localStorage.getItem('vx_velas_url') || 'https://vectra-velas.onrender.com/velas').replace(/\/velas.*$/, ''); }
    catch (e) { return 'https://vectra-velas.onrender.com'; }
  })();

  var CFG = {
    ativo: 'BTCUSDT',
    tf: '15m',
    lote: 0.01,
    fator: 0.6,
    niveis: [1 / 3, 2 / 3, 1, 4 / 3, 5 / 3],
    alvo: 2,
    stop: 1,
    corte: 0.5,
    alvoTrava: 0.5
  };

  var estado = {
    velas: [],
    ciclos: [],
    indice: -1,          // ciclo em exibição
    tocando: false,
    timer: null,
    chart: null,
    series: null,
    linhas: [],
    marcadores: []
  };

  var el = {};
  var cores = { tinta: '#1c1c1e', fraco: '#8a8f98', linha: '#e4e4e6', vermelho: '#c8102e', verde: '#1f7a4d', ouro: '#c8a000', fundo: '#ffffff' };

  /* ── utilidades ─────────────────────────────────────────────────── */
  function n(v, casas) {
    var x = Number(v);
    if (!isFinite(x)) return '--';
    return x.toLocaleString('pt-BR', { minimumFractionDigits: casas == null ? 2 : casas, maximumFractionDigits: casas == null ? 2 : casas });
  }
  function usd(v) { return (v >= 0 ? '+' : '') + n(v, 2); }
  function hhmm(seg) {
    var d = new Date(seg * 1000);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function dia(seg) {
    var d = new Date(seg * 1000);
    return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' + hhmm(seg);
  }
  function segundosTf(tf) {
    var m = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 };
    return m[tf] || 900;
  }

  /* ── motor ──────────────────────────────────────────────────────── */
  function ema(src, p) {
    var k = 2 / (p + 1), out = [], s = null;
    for (var i = 0; i < src.length; i++) { s = s === null ? src[i] : src[i] * k + s * (1 - k); out.push(s); }
    return out;
  }
  function rsiCalc(src, p) {
    var out = new Array(src.length).fill(50), g = 0, l = 0;
    for (var i = 1; i < src.length; i++) {
      var d = src[i] - src[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i === 1) { g = up; l = dn; } else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; }
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function atrCalc(v, p) {
    var tr = [0], out = new Array(v.length).fill(null), s = null;
    for (var i = 1; i < v.length; i++) tr[i] = Math.max(v[i].high - v[i].low, Math.abs(v[i].high - v[i - 1].close), Math.abs(v[i].low - v[i - 1].close));
    for (var j = p; j < v.length; j++) {
      if (s === null) { var soma = 0; for (var k = j - p + 1; k <= j; k++) soma += tr[k]; s = soma / p; }
      else s = (s * (p - 1) + tr[j]) / p;
      out[j] = s;
    }
    return out;
  }

  function rodarMotor(velas, cfg) {
    var closes = velas.map(function (c) { return c.close; });
    var e8 = ema(closes, 8), e16 = ema(closes, 16), rsi = rsiCalc(closes, 14), atr = atrCalc(velas, 14);
    var ciclos = [], i = 1;
    while (i < velas.length - 1) {
      if (atr[i] == null) { i++; continue; }
      var lado = 0;
      if (e8[i - 1] <= e16[i - 1] && e8[i] > e16[i] && rsi[i] > 55) lado = 1;
      else if (e8[i - 1] >= e16[i - 1] && e8[i] < e16[i] && rsi[i] < 45) lado = -1;
      if (!lado) { i++; continue; }

      var risco = cfg.stop * atr[i], entrada = closes[i];
      var stop = entrada - lado * risco, alvoP = entrada + lado * cfg.alvo * risco;
      var j = i + 1, saida = null, motivo = '', travas = [], usados = {}, pnlT = 0, picoConc = 0;

      while (j < velas.length) {
        var v = velas[j];
        if (lado === 1 && v.low <= stop) { saida = Math.min(stop, v.open) ; motivo = 'stop'; break; }
        if (lado === -1 && v.high >= stop) { saida = Math.max(stop, v.open); motivo = 'stop'; break; }
        if (lado === 1 && v.high >= alvoP) { saida = alvoP; motivo = 'alvo'; break; }
        if (lado === -1 && v.low <= alvoP) { saida = alvoP; motivo = 'alvo'; break; }

        for (var k = 0; k < cfg.niveis.length; k++) {
          if (usados[k]) continue;
          var nivel = entrada + lado * cfg.niveis[k] * risco;
          if ((lado === 1 && v.high >= nivel) || (lado === -1 && v.low <= nivel)) {
            travas.push({
              nivel: cfg.niveis[k], preco: nivel, lado: -lado,
              tamanho: cfg.fator * cfg.lote,
              alvo: nivel - lado * cfg.alvoTrava * risco,
              corte: nivel + lado * cfg.corte * risco,
              aberta: i, estado: 'aberta', saida: null, resultado: 0
            });
            usados[k] = 1;
          }
        }
        picoConc = Math.max(picoConc, travas.filter(function (t) { return t.estado === 'aberta'; }).length);

        for (var t = 0; t < travas.length; t++) {
          var tv = travas[t];
          if (tv.estado !== 'aberta') continue;
          var fechou = false;
          if (lado === 1) {
            if (v.low <= tv.alvo) { tv.resultado = (tv.preco - tv.alvo) * tv.tamanho; tv.estado = 'alvo'; fechou = true; }
            else if (v.high >= tv.corte) { tv.resultado = (tv.preco - tv.corte) * tv.tamanho; tv.estado = 'corte'; fechou = true; }
          } else {
            if (v.high >= tv.alvo) { tv.resultado = (tv.alvo - tv.preco) * tv.tamanho; tv.estado = 'alvo'; fechou = true; }
            else if (v.low <= tv.corte) { tv.resultado = (tv.corte - tv.preco) * tv.tamanho; tv.estado = 'corte'; fechou = true; }
          }
          if (fechou) { tv.saida = j; pnlT += tv.resultado; }
        }
        j++;
      }
      if (saida == null) break;

      for (var q = 0; q < travas.length; q++) {
        var ab = travas[q];
        if (ab.estado === 'aberta') {
          ab.resultado = (ab.preco - saida) * (-lado) * ab.tamanho;
          ab.estado = 'encerrada'; ab.saida = j; pnlT += ab.resultado;
        }
      }

      var principal = (saida - entrada) * lado * cfg.lote;
      ciclos.push({
        entrada: i, saida: j, lado: lado, precoEntrada: entrada, risco: risco,
        stop: stop, alvo: alvoP, saida: saida, motivo: motivo, travas: travas,
        resultadoPrincipal: principal, resultadoTravas: pnlT,
        resultado: principal + pnlT, concorrencia: picoConc,
        rsi: rsi[i], atr: atr[i], ema8: e8[i], ema16: e16[i],
        r: (principal + pnlT) / (risco * cfg.lote)
      });
      i = j + 1;
    }
    return { ciclos: ciclos, e8: e8, e16: e16, rsi: rsi, atr: atr };
  }

  /* ── dados ──────────────────────────────────────────────────────── */
  function normalizar(lista) {
    if (!Array.isArray(lista) || !lista.length) return [];
    return lista.map(function (c) {
      if (Array.isArray(c)) return { time: Number(c[0]), open: Number(c[1]), close: Number(c[2]), high: Number(c[3]), low: Number(c[4]) };
      return { time: Number(c.time), open: Number(c.open), close: Number(c.close), high: Number(c.high), low: Number(c.low) };
    }).filter(function (c) { return isFinite(c.time) && isFinite(c.close) && c.high >= c.low; });
  }

  async function carregarVelas() {
    // 1) usa o carregador do painel, que já sabe falar com a ponte e as corretoras
    try {
      if (typeof window.fetchCandles === 'function') {
        var v = await window.fetchCandles(CFG.ativo, CFG.tf, 1200);
        var ok = normalizar(v);
        if (ok.length > 50) return ok;
      }
    } catch (e) {}
    // 2) direto na ponte
    var url = PONTE + '/velas?sym=' + encodeURIComponent(CFG.ativo) + '&tf=' + encodeURIComponent(CFG.tf) + '&alvo=1200';
    var r = await fetch(url, { cache: 'no-store' });
    var d = await r.json();
    return normalizar(d.velas || []);
  }

  /* ── interface ──────────────────────────────────────────────────── */
  function estilo() {
    if (document.getElementById('rc-estilo')) return;
    var s = document.createElement('style');
    s.id = 'rc-estilo';
    s.textContent = [
      '#robo-ciclos-card{background:#fff;border:1px solid ' + cores.linha + ';border-radius:12px;padding:10px 11px;font-family:Inter,system-ui,sans-serif;color:' + cores.tinta + ';font-size:11px}',
      '#robo-ciclos-card *{box-sizing:border-box}',
      '.rc-topo{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px}',
      '.rc-topo b{font-size:12px;letter-spacing:-.2px}',
      '.rc-tag{font-size:8px;letter-spacing:1.2px;text-transform:uppercase;color:' + cores.fraco + '}',
      '.rc-campo{display:flex;flex-direction:column;gap:2px}',
      '.rc-campo span{font-size:8px;letter-spacing:.6px;text-transform:uppercase;color:' + cores.fraco + '}',
      'select.rc-sel,input.rc-num{border:1px solid ' + cores.linha + ';border-radius:7px;padding:4px 6px;font-size:11px;font-family:inherit;color:' + cores.tinta + ';background:#fff;font-variant-numeric:tabular-nums}',
      '.rc-btn{border:1px solid ' + cores.linha + ';background:#fff;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;color:' + cores.tinta + ';min-height:32px}',
      '.rc-btn.on{background:' + cores.vermelho + ';border-color:' + cores.vermelho + ';color:#fff}',
      '.rc-btn:active{transform:translateY(1px)}',
      '.rc-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '@media(max-width:820px){.rc-grid{grid-template-columns:1fr}}',
      '.rc-bloco{border:1px solid ' + cores.linha + ';border-radius:10px;padding:8px;background:#fff}',
      '.rc-bloco h4{margin:0 0 6px;font-size:8.5px;letter-spacing:1px;text-transform:uppercase;color:' + cores.fraco + ';font-weight:700}',
      '.rc-graf{height:230px;width:100%;border-radius:8px;overflow:hidden}',
      '@media(max-width:820px){.rc-graf{height:190px}}',
      '.rc-kv{display:grid;grid-template-columns:1fr auto;gap:2px 8px;font-size:11px;font-variant-numeric:tabular-nums}',
      '.rc-kv i{font-style:normal;color:' + cores.fraco + '}',
      '.rc-kv b{font-weight:600;text-align:right}',
      '.rc-livro{width:100%;border-collapse:collapse;font-size:10.5px;font-variant-numeric:tabular-nums}',
      '.rc-livro th{text-align:left;font-size:8px;letter-spacing:.5px;text-transform:uppercase;color:' + cores.fraco + ';border-bottom:1px solid ' + cores.linha + ';padding:3px 2px;font-weight:700}',
      '.rc-livro td{border-bottom:1px solid #f2f2f4;padding:3px 2px;white-space:nowrap}',
      '.rc-livro td.n,.rc-livro th.n{text-align:right}',
      '.rc-livro tr.principal td{background:#fbfbfc;font-weight:600}',
      '.rc-livro tr.aberta td{background:#fff8f8}',
      '.rc-pos{color:' + cores.verde + ';font-weight:700}',
      '.rc-neg{color:' + cores.vermelho + ';font-weight:700}',
      '.rc-neutro{color:' + cores.fraco + ';font-weight:700}',
      '.rc-pill{display:inline-block;padding:1px 6px;border-radius:99px;font-size:8.5px;font-weight:700;letter-spacing:.4px;text-transform:uppercase}',
      '.rc-pill.alvo{background:#eaf6ef;color:' + cores.verde + '}',
      '.rc-pill.corte{background:#fdecec;color:' + cores.vermelho + '}',
      '.rc-pill.aberta{background:#fff4e0;color:#8a6200}',
      '.rc-pill.encerrada{background:#f0f0f2;color:' + cores.fraco + '}',
      '.rc-trilha{display:flex;gap:4px;flex-wrap:wrap;margin:6px 0}',
      '.rc-trilha button{flex:1 1 auto;min-width:44px}',
      '.rc-aviso{font-size:9.5px;color:' + cores.fraco + ';line-height:1.4;margin-top:6px}',
      '.rc-tot{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 0;font-variant-numeric:tabular-nums}',
      '.rc-tot div{border-top:2px solid ' + cores.tinta + ';padding-top:3px;min-width:74px}',
      '.rc-tot b{display:block;font-size:14px;letter-spacing:-.4px}',
      '.rc-tot span{font-size:7.5px;letter-spacing:.6px;text-transform:uppercase;color:' + cores.fraco + '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function montar() {
    estilo();
    var card = document.createElement('div');
    card.id = 'robo-ciclos-card';
    card.style.display = 'none';
    card.innerHTML = [
      '<div class="rc-topo">',
      '  <div style="flex:1 1 100%;display:flex;align-items:baseline;gap:8px"><b>Robô de ciclos</b><span class="rc-tag">escada de travas</span></div>',
      '  <label class="rc-campo"><span>ativo</span><select class="rc-sel" id="rc-ativo">',
      '    <option value="BTCUSDT">BTC</option><option value="ETHUSDT">ETH</option><option value="ZECUSDT">ZEC</option></select></label>',
      '  <label class="rc-campo"><span>tempo</span><select class="rc-sel" id="rc-tf">',
      '    <option>1m</option><option>3m</option><option>5m</option><option selected>15m</option><option>1h</option><option>4h</option></select></label>',
      '  <label class="rc-campo"><span>lote</span><select class="rc-sel" id="rc-lote">',
      '    <option value="0.01">0,01</option><option value="0.03">0,03</option><option value="0.06">0,06</option></select></label>',
      '  <button type="button" class="rc-btn" id="rc-rodar">Rodar</button>',
      '  <button type="button" class="rc-btn" id="rc-play">▶</button>',
      '  <button type="button" class="rc-btn" id="rc-prox">Ciclo ›</button>',
      '</div>',
      '<div class="rc-trilha" id="rc-trilha"></div>',
      '<div class="rc-grid">',
      '  <div class="rc-bloco">',
      '    <h4>Simulação idêntica ao motor</h4>',
      '    <div class="rc-graf" id="rc-graf"></div>',
      '    <div class="rc-tot" id="rc-tot"></div>',
      '  </div>',
      '  <div class="rc-bloco">',
      '    <h4>Próximo disparo</h4>',
      '    <div class="rc-kv" id="rc-disparo"></div>',
      '    <h4 style="margin-top:10px">Ciclo em exibição</h4>',
      '    <div class="rc-kv" id="rc-ciclo"></div>',
      '  </div>',
      '</div>',
      '<div class="rc-bloco" style="margin-top:8px">',
      '  <h4>Livro de ordens do ciclo</h4>',
      '  <div style="max-height:230px;overflow:auto"><table class="rc-livro" id="rc-livro"></table></div>',
      '</div>',
      '<div class="rc-aviso" id="rc-aviso">Escolha o ativo e o tempo e toque em Rodar. O robô lê a série real, monta cada ciclo com a escada de travas em 1/3, 2/3, 3/3, 4/3 e 5/3 de R (fator 0,60), stop de 1,0 ATR e alvo de 2R.</div>'
    ].join('');
    document.body.appendChild(card);

    el.card = card;
    el.ativo = card.querySelector('#rc-ativo');
    el.tf = card.querySelector('#rc-tf');
    el.lote = card.querySelector('#rc-lote');
    el.rodar = card.querySelector('#rc-rodar');
    el.play = card.querySelector('#rc-play');
    el.prox = card.querySelector('#rc-prox');
    el.trilha = card.querySelector('#rc-trilha');
    el.graf = card.querySelector('#rc-graf');
    el.tot = card.querySelector('#rc-tot');
    el.disparo = card.querySelector('#rc-disparo');
    el.ciclo = card.querySelector('#rc-ciclo');
    el.livro = card.querySelector('#rc-livro');
    el.aviso = card.querySelector('#rc-aviso');

    el.rodar.addEventListener('click', rodar);
    el.play.addEventListener('click', alternarPlay);
    el.prox.addEventListener('click', function () { mostrarCiclo(estado.indice + 1); });
    el.ativo.addEventListener('change', function () { CFG.ativo = el.ativo.value; });
    el.tf.addEventListener('change', function () { CFG.tf = el.tf.value; });
    el.lote.addEventListener('change', function () { CFG.lote = Number(el.lote.value); });
  }

  /* ── gráfico ────────────────────────────────────────────────────── */
  function criarGrafico() {
    if (estado.chart || !window.LightweightCharts) return;
    estado.chart = LightweightCharts.createChart(el.graf, {
      layout: { background: { color: '#ffffff' }, textColor: '#5c6068', fontSize: 10 },
      grid: { vertLines: { color: '#f2f2f4' }, horzLines: { color: '#f2f2f4' } },
      rightPriceScale: { borderColor: '#e4e4e6', scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: '#e4e4e6', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      handleScroll: false, handleScale: false
    });
    estado.series = estado.chart.addCandlestickSeries({
      upColor: '#1f7a4d', downColor: '#c8102e', borderVisible: false,
      wickUpColor: '#1f7a4d', wickDownColor: '#c8102e'
    });
  }

  function limparLinhas() {
    estado.linhas.forEach(function (l) { try { estado.series.removePriceLine(l); } catch (e) {} });
    estado.linhas = [];
  }

  function linha(preco, cor, titulo, estilo) {
    try {
      var l = estado.series.createPriceLine({
        price: preco, color: cor, lineWidth: 1,
        lineStyle: estilo === 'tracejado' ? 2 : 0,
        axisLabelVisible: true, title: titulo
      });
      estado.linhas.push(l);
    } catch (e) {}
  }

  function desenhar() {
    criarGrafico();
    if (!estado.series) { el.aviso.textContent = 'Gráfico do painel não carregou ainda. Toque em Rodar de novo em alguns segundos.'; return; }
    var v = estado.velas;
    if (!v.length) return;
    var c = estado.ciclos[estado.indice];
    var ini = Math.max(0, (c ? c.entrada : v.length) - 120);
    var fim = Math.min(v.length, (c ? c.saida : v.length) + 40);
    var janela = v.slice(ini, fim);
    estado.series.setData(janela.map(function (x) { return { time: x.time, open: x.open, high: x.high, low: x.low, close: x.close }; }));

    limparLinhas();
    var marcas = [];
    if (c) {
      marcas.push({ time: v[c.entrada].time, position: c.lado === 1 ? 'belowBar' : 'aboveBar', color: cores.tinta, shape: c.lado === 1 ? 'arrowUp' : 'arrowDown', text: (c.lado === 1 ? 'compra ' : 'venda ') + n(c.precoEntrada, 1) });
      marcas.push({ time: v[c.saida].time, position: 'aboveBar', color: c.motivo === 'alvo' ? cores.verde : cores.vermelho, shape: 'circle', text: c.motivo + ' ' + n(c.saida, 1) });
      c.travas.forEach(function (t) {
        marcas.push({ time: v[t.aberta].time, position: t.lado === 1 ? 'belowBar' : 'aboveBar', color: cores.ouro, shape: 'square', text: 'trava ' + (Math.round(t.nivel * 100) / 100) + 'R' });
      });
      linha(c.precoEntrada, '#5c6068', 'entrada', 'tracejado');
      linha(c.stop, cores.vermelho, 'stop');
      linha(c.alvo, cores.verde, 'alvo 2R');
      c.travas.forEach(function (t) { linha(t.preco, cores.ouro, 'trava ' + (Math.round(t.nivel * 100) / 100) + 'R', 'tracejado'); });
    }
    try { estado.series.setMarkers(marcas.sort(function (a, b) { return a.time - b.time; })); } catch (e) {}
    estado.chart.timeScale().fitContent();
  }

  /* ── painéis de texto ───────────────────────────────────────────── */
  function pintarTotais() {
    var c = estado.ciclos;
    if (!c.length) { el.tot.innerHTML = ''; return; }
    var total = c.reduce(function (a, x) { return a + x.resultado; }, 0);
    var trava = c.reduce(function (a, x) { return a + x.resultadoTravas; }, 0);
    var acertos = c.filter(function (x) { return x.resultado > 0; }).length;
    el.tot.innerHTML = [
      '<div><b class="' + (total >= 0 ? 'rc-pos' : 'rc-neg') + '">' + usd(total) + '</b><span>resultado</span></div>',
      '<div><b>' + c.length + '</b><span>ciclos</span></div>',
      '<div><b>' + Math.round(acertos / c.length * 100) + '%</b><span>acerto</span></div>',
      '<div><b class="rc-pos">' + usd(trava) + '</b><span>das travas</span></div>'
    ].join('');
  }

  function pintarDisparo() {
    var v = estado.velas, i = v.length - 1;
    if (i < 20) { el.disparo.innerHTML = '<i>sem série suficiente</i><b>--</b>'; return; }
    var m = estado.motor;
    var ultima = v[i], anterior = v[i - 1];
    var dist = function (a) { return n(a, 1); };
    var cruz = m.e8[i] > m.e16[i] ? 'EMA8 acima da EMA16' : 'EMA8 abaixo da EMA16';
    var r = m.rsi[i], at = m.atr[i];
    var faltaRSI = r > 55 ? 'força de compra confirmada' : (r < 45 ? 'força de venda confirmada' : 'sem força: precisa passar de 55 ou cair abaixo de 45');
    var linhas = [
      ['preço', dist(ultima.close)],
      ['EMA8 / EMA16', dist(m.e8[i]) + ' / ' + dist(m.e16[i])],
      ['cruzamento', cruz],
      ['RSI 14', n(r, 1) + ' · ' + faltaRSI],
      ['ATR 14', n(at, 1)],
      ['risco por lote', 'US$ ' + n(at * CFG.lote, 2)],
      ['se entrar agora · stop', dist(ultima.close - at) + ' / ' + dist(ultima.close + at)],
      ['alvo 2R', dist(ultima.close - 2 * at) + ' / ' + dist(ultima.close + 2 * at)]
    ];
    el.disparo.innerHTML = linhas.map(function (l) { return '<i>' + l[0] + '</i><b>' + l[1] + '</b>'; }).join('');
  }

  function pintarCiclo() {
    var c = estado.ciclos[estado.indice];
    if (!c) { el.ciclo.innerHTML = '<i>nenhum ciclo em exibição</i><b>--</b>'; el.livro.innerHTML = ''; return; }
    var cls = c.resultado >= 0 ? 'rc-pos' : 'rc-neg';
    el.ciclo.innerHTML = [
      ['ciclo', '#' + (estado.indice + 1) + ' de ' + estado.ciclos.length],
      ['lado', c.lado === 1 ? 'compra' : 'venda'],
      ['abertura', dia(estado.velas[c.entrada].time)],
      ['fechamento', dia(estado.velas[c.saida].time)],
      ['duração', Math.round((c.saida - c.entrada) * segundosTf(CFG.tf) / 60) + ' min'],
      ['motivo', c.motivo],
      ['travas abertas', String(c.travas.length) + ' (pico ' + c.concorrencia + ')'],
      ['resultado', '<span class="' + cls + '">' + usd(c.resultado) + ' (' + n(c.r, 2) + 'R)</span>']
    ].map(function (l) { return '<i>' + l[0] + '</i><b>' + l[1] + '</b>'; }).join('');
    pintarLivro(c);
  }

  function pintarLivro(c) {
    var linhas = [
      '<tr class="principal"><th>ordem</th><th>lado</th><th class="n">preço</th><th class="n">tamanho</th><th>estado</th><th class="n">resultado</th></tr>',
      '<tr class="principal"><td>principal</td><td>' + (c.lado === 1 ? 'compra' : 'venda') + '</td><td class="n">' + n(c.precoEntrada, 1) + '</td><td class="n">' + n(CFG.lote, 2) + '</td><td><span class="rc-pill ' + (c.motivo === 'alvo' ? 'alvo' : 'corte') + '">' + c.motivo + '</span></td><td class="n ' + (c.resultadoPrincipal >= 0 ? 'rc-pos' : 'rc-neg') + '">' + usd(c.resultadoPrincipal) + '</td></tr>'
    ];
    c.travas.forEach(function (t, k) {
      linhas.push('<tr class="' + (t.estado === 'aberta' ? 'aberta' : '') + '"><td>trava ' + (k + 1) + ' · ' + (Math.round(t.nivel * 100) / 100) + 'R</td><td>' + (t.lado === 1 ? 'compra' : 'venda') + '</td><td class="n">' + n(t.preco, 1) + '</td><td class="n">' + n(t.tamanho, 3) + '</td><td><span class="rc-pill ' + t.estado + '">' + t.estado + '</span></td><td class="n ' + (t.resultado >= 0 ? 'rc-pos' : 'rc-neg') + '">' + usd(t.resultado) + '</td></tr>');
    });
    el.livro.innerHTML = linhas.join('');
  }

  function pintarTrilha() {
    var c = estado.ciclos;
    if (!c.length) { el.trilha.innerHTML = ''; return; }
    var passo = Math.max(1, Math.ceil(c.length / 12));
    var html = [];
    for (var i = 0; i < c.length; i += passo) {
      var x = c[i];
      html.push('<button type="button" class="rc-btn' + (i === estado.indice ? ' on' : '') + '" data-i="' + i + '">' + (i + 1) + '</button>');
    }
    el.trilha.innerHTML = html.join('');
    [].forEach.call(el.trilha.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { parar(); mostrarCiclo(Number(b.getAttribute('data-i'))); });
    });
  }

  function mostrarCiclo(i) {
    if (!estado.ciclos.length) return;
    estado.indice = Math.max(0, Math.min(estado.ciclos.length - 1, i));
    pintarCiclo(); pintarTrilha(); desenhar();
  }

  /* ── execução ───────────────────────────────────────────────────── */
  async function rodar() {
    el.rodar.textContent = 'lendo...';
    el.rodar.disabled = true;
    try {
      estado.velas = await carregarVelas();
      if (estado.velas.length < 60) throw new Error('série curta');
      estado.motor = rodarMotor(estado.velas, CFG);
      estado.ciclos = estado.motor.ciclos;
      estado.indice = estado.ciclos.length ? 0 : -1;
      pintarTotais(); pintarDisparo(); pintarCiclo(); pintarTrilha(); desenhar();
      el.aviso.textContent = 'Série real de ' + estado.velas.length + ' velas de ' + CFG.tf + ' em ' + CFG.ativo + '. ' + estado.ciclos.length + ' ciclos montados com a escada. Toque em ▶ para ver o robô operando ciclo por ciclo.';
    } catch (e) {
      el.aviso.textContent = 'Não consegui ler a série agora (' + (e && e.message ? e.message : 'erro') + '). Toque em Rodar de novo.';
    } finally {
      el.rodar.textContent = 'Rodar';
      el.rodar.disabled = false;
    }
  }

  function alternarPlay() {
    if (estado.tocando) return parar();
    if (!estado.ciclos.length) return rodar();
    estado.tocando = true;
    el.play.classList.add('on'); el.play.textContent = '❚❚';
    if (estado.indice >= estado.ciclos.length - 1) estado.indice = 0;
    estado.timer = setInterval(function () {
      if (estado.indice >= estado.ciclos.length - 1) return parar();
      mostrarCiclo(estado.indice + 1);
    }, 900);
  }
  function parar() {
    estado.tocando = false;
    if (estado.timer) clearInterval(estado.timer);
    estado.timer = null;
    if (el.play) { el.play.classList.remove('on'); el.play.textContent = '▶'; }
  }

  /* ── nascimento ─────────────────────────────────────────────────── */
  function iniciar() {
    if (document.getElementById('robo-ciclos-card')) return;
    montar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else setTimeout(iniciar, 60);

  window.RoboCiclos = { rodar: rodar, config: CFG, estado: estado };
})();
