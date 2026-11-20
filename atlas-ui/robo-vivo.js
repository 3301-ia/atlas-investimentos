// VECTRA · Operação ao vivo (aba própria)
//
// Esta aba existe só para acompanhar o processo: o robô roda em papel sobre a
// série real e se atualiza sozinho a cada 20 segundos, mostrando a posição
// aberta, as travas da escada, o livro de ordens e o resultado acumulado.
//
// Regras: entrada no cruzamento EMA8 x EMA16 com RSI (>55 compra, <45 venda),
// stop 1,0 ATR, alvo 2R, travas em 1/3, 2/3, 3/3, 4/3 e 5/3 de R com fator 0,60.
(function () {
  'use strict';
  if (document.getElementById('robo-vivo-card')) return;

  var PONTE = (function () {
    try { return (localStorage.getItem('vx_velas_url') || 'https://vectra-velas.onrender.com/velas').replace(/\/velas.*$/, ''); }
    catch (e) { return 'https://vectra-velas.onrender.com'; }
  })();

  var CFG = { ativo: 'BTCUSDT', tf: '15m', lote: 0.01, fator: 0.6, alvo: 2, stop: 1, corte: 0.5, alvoTrava: 0.5,
              niveis: [1 / 3, 2 / 3, 1, 4 / 3, 5 / 3] };
  var S = { velas: [], ind: null, ctx: null, vivo: false, timer: null, chart: null, serie: null, linhas: [] };
  var el = {};
  var C = { tinta: '#1c1c1e', fraco: '#8a8f98', linha: '#e4e4e6', vermelho: '#c8102e', verde: '#1f7a4d', ouro: '#c8a000' };
  var CHAVE = 'vx.robo.vivo.v1';

  function n(v, c) { var x = Number(v); if (!isFinite(x)) return '--'; return x.toLocaleString('pt-BR', { minimumFractionDigits: c == null ? 2 : c, maximumFractionDigits: c == null ? 2 : c }); }
  function usd(v) { return (v >= 0 ? '+' : '') + n(v, 2); }
  function hhmm(t) { var d = new Date(t * 1000); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function agora() { return hhmm(Math.floor(Date.now() / 1000)); }

  /* ── motor ─────────────────────────────────────────────────────── */
  function ema(s, p) { var k = 2 / (p + 1), o = [], x = null; for (var i = 0; i < s.length; i++) { x = x === null ? s[i] : s[i] * k + x * (1 - k); o.push(x); } return o; }
  function rsiCalc(s, p) {
    var o = new Array(s.length).fill(50), g = 0, l = 0;
    for (var i = 1; i < s.length; i++) {
      var d = s[i] - s[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
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
    var c = v.map(function (x) { return x.close; });
    return { e8: ema(c, 8), e16: ema(c, 16), rsi: rsiCalc(c, 14), atr: atrCalc(v, 14) };
  }
  function sinalEm(i) {
    var m = S.ind;
    if (i < 1 || m.atr[i] == null) return 0;
    if (m.e8[i - 1] <= m.e16[i - 1] && m.e8[i] > m.e16[i] && m.rsi[i] > 55) return 1;
    if (m.e8[i - 1] >= m.e16[i - 1] && m.e8[i] < m.e16[i] && m.rsi[i] < 45) return -1;
    return 0;
  }
  function novoCtx(i) { return { i: i, pos: null, ciclos: [], equity: 0 }; }
  function abrir(ctx, i, lado) {
    var d = CFG.stop * S.ind.atr[i], ent = S.velas[i].close;
    ctx.pos = { lado: lado, i: i, entrada: ent, risco: d, tamanho: CFG.lote,
                stop: ent - lado * d, alvo: ent + lado * CFG.alvo * d, travas: [], usados: {}, pnlT: 0 };
  }
  function fechar(ctx, i, preco, motivo) {
    var p = ctx.pos;
    p.travas.forEach(function (t) {
      if (t.estado === 'aberta') { t.resultado = (t.preco - preco) * (-p.lado) * t.tamanho; t.estado = 'encerrada'; p.pnlT += t.resultado; }
    });
    var principal = (preco - p.entrada) * p.lado * p.tamanho;
    ctx.ciclos.push({ i: p.i, saida: i, lado: p.lado, entrada: p.entrada, saida_: preco, motivo: motivo,
                      principal: principal, travas: p.pnlT, total: principal + p.pnlT,
                      r: (principal + p.pnlT) / (p.risco * p.tamanho), lista: p.travas.slice() });
    ctx.equity += principal + p.pnlT;
    ctx.pos = null;
  }
  function passo(ctx) {
    if (ctx.i >= S.velas.length - 1) return false;
    ctx.i++;
    var i = ctx.i, v = S.velas[i], abriu = false;
    if (!ctx.pos) { var s = sinalEm(i); if (s) { abrir(ctx, i, s); abriu = true; } }
    var p = ctx.pos;
    if (p && !abriu) {
      if (p.lado === 1 && v.low <= p.stop) return fechar(ctx, i, Math.min(p.stop, v.open), 'stop'), true;
      if (p.lado === -1 && v.high >= p.stop) return fechar(ctx, i, Math.max(p.stop, v.open), 'stop'), true;
      if (p.lado === 1 && v.high >= p.alvo) return fechar(ctx, i, p.alvo, 'alvo'), true;
      if (p.lado === -1 && v.low <= p.alvo) return fechar(ctx, i, p.alvo, 'alvo'), true;
      var d = p.risco;
      CFG.niveis.forEach(function (nv, k) {
        if (p.usados[k]) return;
        var nivel = p.entrada + p.lado * nv * d;
        if ((p.lado === 1 && v.high >= nivel) || (p.lado === -1 && v.low <= nivel)) {
          p.travas.push({ nivel: nv, preco: nivel, lado: -p.lado, tamanho: CFG.fator * CFG.lote, aberta: i,
                          alvo: nivel - p.lado * CFG.alvoTrava * d, corte: nivel + p.lado * CFG.corte * d, estado: 'aberta', resultado: 0 });
          p.usados[k] = 1;
        }
      });
      p.travas.forEach(function (t) {
        if (t.estado !== 'aberta') return;
        if (p.lado === 1) {
          if (v.low <= t.alvo) { t.resultado = (t.preco - t.alvo) * t.tamanho; t.estado = 'alvo'; p.pnlT += t.resultado; }
          else if (v.high >= t.corte) { t.resultado = (t.preco - t.corte) * t.tamanho; t.estado = 'corte'; p.pnlT += t.resultado; }
        } else {
          if (v.high >= t.alvo) { t.resultado = (t.alvo - t.preco) * t.tamanho; t.estado = 'alvo'; p.pnlT += t.resultado; }
          else if (v.low <= t.corte) { t.resultado = (t.corte - t.preco) * t.tamanho; t.estado = 'corte'; p.pnlT += t.resultado; }
        }
      });
    }
    return true;
  }

  /* ── gráfico ───────────────────────────────────────────────────── */
  function grafico() {
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
  function linha(p, cor, t, trace) { try { S.linhas.push(S.serie.createPriceLine({ price: p, color: cor, lineWidth: 1, lineStyle: trace ? 2 : 0, axisLabelVisible: true, title: t })); } catch (e) {} }

  function desenhar() {
    grafico();
    if (!S.serie || !S.ctx) return;
    var ctx = S.ctx, ate = ctx.i, de = Math.max(0, ate - 220);
    S.serie.setData(S.velas.slice(de, ate + 1).map(function (x) { return { time: x.time, open: x.open, high: x.high, low: x.low, close: x.close }; }));
    limpar();
    var mk = [];
    ctx.ciclos.forEach(function (c) {
      if (c.i < de) return;
      mk.push({ time: S.velas[c.i].time, position: c.lado === 1 ? 'belowBar' : 'aboveBar', color: C.tinta, shape: c.lado === 1 ? 'arrowUp' : 'arrowDown', text: (c.lado === 1 ? 'C ' : 'V ') + n(c.entrada, 0) });
      mk.push({ time: S.velas[c.saida].time, position: 'aboveBar', color: c.total >= 0 ? C.verde : C.vermelho, shape: 'circle', text: c.motivo + ' ' + usd(c.total) });
    });
    var p = ctx.pos;
    if (p) {
      mk.push({ time: S.velas[p.i].time, position: p.lado === 1 ? 'belowBar' : 'aboveBar', color: C.vermelho, shape: p.lado === 1 ? 'arrowUp' : 'arrowDown', text: (p.lado === 1 ? 'COMPRA ' : 'VENDA ') + n(p.entrada, 0) });
      linha(p.entrada, '#5c6068', 'entrada', true);
      linha(p.stop, C.vermelho, 'stop');
      linha(p.alvo, C.verde, 'alvo 2R');
      p.travas.forEach(function (t) { linha(t.preco, C.ouro, (Math.round(t.nivel * 100) / 100) + 'R', true); });
    }
    try { S.serie.setMarkers(mk.sort(function (a, b) { return a.time - b.time; })); } catch (e) {}
    S.chart.timeScale().fitContent();
  }

  /* ── painéis ───────────────────────────────────────────────────── */
  function pintar() {
    var ctx = S.ctx;
    if (!ctx) { el.estado.innerHTML = '<i>aguardando a leitura</i><b>--</b>'; return; }
    var v = S.velas[ctx.i], p = ctx.pos, aberto = 0;
    if (p) {
      aberto = (v.close - p.entrada) * p.lado * p.tamanho;
      p.travas.forEach(function (t) { if (t.estado === 'aberta') aberto += (t.preco - v.close) * (-p.lado) * t.tamanho; });
    }
    var ac = ctx.ciclos.filter(function (c) { return c.total > 0; }).length;
    var cls = function (x) { return x >= 0 ? 'rc-pos' : 'rc-neg'; };
    el.estado.innerHTML = [
      ['estado', p ? '<span class="' + (p.lado === 1 ? 'rc-pos' : 'rc-neg') + '">' + (p.lado === 1 ? 'COMPRADO' : 'VENDIDO') + '</span>' : 'fora do mercado'],
      ['vela', hhmm(v.time) + ' · ' + n(v.close, 1)],
      ['entrada', p ? n(p.entrada, 1) : '--'],
      ['stop / alvo', p ? n(p.stop, 1) + ' / ' + n(p.alvo, 1) : '--'],
      ['travas abertas', p ? String(p.travas.filter(function (t) { return t.estado === 'aberta'; }).length) : '0'],
      ['resultado aberto', '<span class="' + cls(aberto) + '">' + usd(aberto) + '</span>'],
      ['ciclos fechados', String(ctx.ciclos.length)],
      ['acerto', ctx.ciclos.length ? Math.round(ac / ctx.ciclos.length * 100) + '%' : '--'],
      ['acumulado', '<span class="' + cls(ctx.equity + aberto) + '">' + usd(ctx.equity + aberto) + '</span>']
    ].map(function (l) { return '<i>' + l[0] + '</i><b>' + l[1] + '</b>'; }).join('');

    var rows = ['<tr><th>ordem</th><th>lado</th><th class="n">preço</th><th class="n">tamanho</th><th>estado</th><th class="n">resultado</th></tr>'];
    if (p) {
      rows.push('<tr class="principal"><td>principal</td><td>' + (p.lado === 1 ? 'compra' : 'venda') + '</td><td class="n">' + n(p.entrada, 1) + '</td><td class="n">' + n(p.tamanho, 2) + '</td><td><span class="rc-pill aberta">aberta</span></td><td class="n ' + cls(aberto) + '">' + usd(aberto) + '</td></tr>');
      p.travas.forEach(function (t, k) {
        rows.push('<tr><td>trava ' + (k + 1) + ' · ' + (Math.round(t.nivel * 100) / 100) + 'R</td><td>' + (t.lado === 1 ? 'compra' : 'venda') + '</td><td class="n">' + n(t.preco, 1) + '</td><td class="n">' + n(t.tamanho, 3) + '</td><td><span class="rc-pill ' + t.estado + '">' + t.estado + '</span></td><td class="n ' + cls(t.resultado) + '">' + usd(t.resultado) + '</td></tr>');
      });
    } else {
      var u = ctx.ciclos[ctx.ciclos.length - 1];
      if (u) {
        rows.push('<tr class="principal"><td>último ciclo</td><td>' + (u.lado === 1 ? 'compra' : 'venda') + '</td><td class="n">' + n(u.entrada, 1) + '</td><td class="n">' + n(CFG.lote, 2) + '</td><td><span class="rc-pill ' + (u.motivo === 'alvo' ? 'alvo' : 'corte') + '">' + u.motivo + '</span></td><td class="n ' + cls(u.total) + '">' + usd(u.total) + '</td></tr>');
        u.lista.forEach(function (t, k) {
          rows.push('<tr><td>trava ' + (k + 1) + ' · ' + (Math.round(t.nivel * 100) / 100) + 'R</td><td>' + (t.lado === 1 ? 'compra' : 'venda') + '</td><td class="n">' + n(t.preco, 1) + '</td><td class="n">' + n(t.tamanho, 3) + '</td><td><span class="rc-pill ' + t.estado + '">' + t.estado + '</span></td><td class="n ' + cls(t.resultado) + '">' + usd(t.resultado) + '</td></tr>');
        });
      } else rows.push('<tr><td colspan="6" style="color:#8a8f98">aguardando o próximo cruzamento</td></tr>');
    }
    el.livro.innerHTML = rows.join('');

    var m = S.ind, i = ctx.i;
    if (m && m.atr[i] != null) {
      el.disparo.innerHTML = [
        ['cruzamento', m.e8[i] > m.e16[i] ? 'EMA8 acima' : 'EMA8 abaixo'],
        ['RSI 14', n(m.rsi[i], 1) + (m.rsi[i] > 55 ? ' · força de compra' : m.rsi[i] < 45 ? ' · força de venda' : ' · sem força')],
        ['ATR 14', n(m.atr[i], 1)],
        ['risco por lote', 'US$ ' + n(m.atr[i] * CFG.lote, 2)]
      ].map(function (l) { return '<i>' + l[0] + '</i><b>' + l[1] + '</b>'; }).join('');
    }
    desenhar();
  }

  /* ── leitura e ciclo ao vivo ───────────────────────────────────── */
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

  async function carregar() {
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
  function pref() { try { return JSON.parse(localStorage.getItem(CHAVE) || '{}'); } catch (e) { return {}; } }
  function inicio(v) {
    var p = pref(), k = CFG.ativo + '|' + CFG.tf, ts = p[k];
    if (!ts) { ts = v[Math.max(20, v.length - 1200)].time; p[k] = ts; try { localStorage.setItem(CHAVE, JSON.stringify(p)); } catch (e) {} }
    for (var i = 0; i < v.length; i++) if (v[i].time >= ts) return Math.max(20, i);
    return Math.max(20, v.length - 1200);
  }

  async function rodar() {
    if (!S.vivo) return;
    try {
      el.linha.textContent = 'lendo a série...';
      var v = await carregar();
      if (!Array.isArray(v) || v.length < 80) throw new Error('série curta');
      S.velas = v; S.ind = indicadores(v);
      S.ctx = novoCtx(inicio(v));
      var g = 0;
      while (S.ctx.i < v.length - 1 && g++ < 6000) passo(S.ctx);
      pintar();
      var ult = v[v.length - 1], c = S.ctx, ab = 0;
      if (c.pos) {
        ab = (ult.close - c.pos.entrada) * c.pos.lado * c.pos.tamanho;
        c.pos.travas.forEach(function (t) { if (t.estado === 'aberta') ab += (t.preco - ult.close) * (-c.pos.lado) * t.tamanho; });
      }
      el.linha.innerHTML = '<b>● AO VIVO</b> · vela ' + hhmm(ult.time) + ' · ' + n(ult.close, 1) +
        ' · ciclos ' + c.ciclos.length + ' · acumulado <span class="' + ((c.equity + ab) >= 0 ? 'rc-pos' : 'rc-neg') + '">' + usd(c.equity + ab) + '</span> · lido ' + agora();
    } catch (e) {
      el.linha.textContent = 'sem leitura agora, tento de novo em 20s';
    }
  }

  function ligar() {
    S.vivo = true;
    el.btn.classList.add('on');
    rodar();
    if (S.timer) clearInterval(S.timer);
    S.timer = setInterval(rodar, 20000);
  }
  function desligar() {
    S.vivo = false;
    if (S.timer) clearInterval(S.timer);
    S.timer = null;
    el.btn.classList.remove('on');
    el.linha.textContent = 'ao vivo desligado';
  }

  /* ── interface ─────────────────────────────────────────────────── */
  function estilo() {
    if (document.getElementById('rv-estilo')) return;
    var s = document.createElement('style'); s.id = 'rv-estilo';
    s.textContent = [
      '#robo-vivo-card{background:#fff;border:1px solid ' + C.linha + ';border-radius:12px;padding:10px 11px;font-family:Inter,system-ui,sans-serif;color:' + C.tinta + ';font-size:11px}',
      '#robo-vivo-card *{box-sizing:border-box}',
      '.rv-topo{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;margin-bottom:8px}',
      '.rv-campo{display:flex;flex-direction:column;gap:2px}',
      '.rv-campo span{font-size:8px;letter-spacing:.6px;text-transform:uppercase;color:' + C.fraco + '}',
      'select.rv-sel{border:1px solid ' + C.linha + ';border-radius:7px;padding:4px 6px;font-size:11px;font-family:inherit;background:#fff;color:' + C.tinta + '}',
      '.rv-btn{border:1px solid ' + C.linha + ';background:#fff;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;color:' + C.tinta + ';min-height:32px;font-family:inherit}',
      '.rv-btn.on{background:' + C.vermelho + ';border-color:' + C.vermelho + ';color:#fff}',
      '.rv-linha{font-size:10px;color:' + C.fraco + ';margin:0 0 8px;font-variant-numeric:tabular-nums}',
      '.rv-linha b{color:' + C.vermelho + ';letter-spacing:.5px}',
      '.rv-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:8px}',
      '@media(max-width:820px){.rv-grid{grid-template-columns:1fr}}',
      '.rv-bloco{border:1px solid ' + C.linha + ';border-radius:10px;padding:8px;background:#fff}',
      '.rv-bloco h4{margin:0 0 6px;font-size:8.5px;letter-spacing:1px;text-transform:uppercase;color:' + C.fraco + ';font-weight:700}',
      '.rv-graf{height:270px;width:100%;border-radius:8px;overflow:hidden}',
      '@media(max-width:820px){.rv-graf{height:210px}}',
      '.rv-kv{display:grid;grid-template-columns:1fr auto;gap:3px 8px;font-size:11px;font-variant-numeric:tabular-nums}',
      '.rv-kv i{font-style:normal;color:' + C.fraco + '}', '.rv-kv b{font-weight:600;text-align:right}',
      '.rv-livro{width:100%;border-collapse:collapse;font-size:10.5px;font-variant-numeric:tabular-nums}',
      '.rv-livro th{text-align:left;font-size:8px;letter-spacing:.5px;text-transform:uppercase;color:' + C.fraco + ';border-bottom:1px solid ' + C.linha + ';padding:3px 2px;font-weight:700}',
      '.rv-livro td{border-bottom:1px solid #f2f2f4;padding:3px 2px;white-space:nowrap}',
      '.rv-livro td.n,.rv-livro th.n{text-align:right}',
      '.rv-livro tr.principal td{background:#fbfbfc;font-weight:600}',
      '.rc-pos{color:' + C.verde + ';font-weight:700}', '.rc-neg{color:' + C.vermelho + ';font-weight:700}',
      '.rc-pill{display:inline-block;padding:1px 6px;border-radius:99px;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}',
      '.rc-pill.alvo{background:#eaf6ef;color:' + C.verde + '}', '.rc-pill.corte{background:#fdecec;color:' + C.vermelho + '}',
      '.rc-pill.aberta{background:#fff4e0;color:#8a6200}', '.rc-pill.encerrada{background:#f0f0f2;color:' + C.fraco + '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function montar() {
    estilo();
    var card = document.createElement('div');
    card.id = 'robo-vivo-card'; card.style.display = 'none';
    card.innerHTML = [
      '<div class="rv-topo">',
      ' <label class="rv-campo"><span>ativo</span><select class="rv-sel" id="rv-ativo"><option value="BTCUSDT">BTC</option><option value="ETHUSDT">ETH</option><option value="ZECUSDT">ZEC</option></select></label>',
      ' <label class="rv-campo"><span>tempo</span><select class="rv-sel" id="rv-tf"><option>1m</option><option>3m</option><option>5m</option><option selected>15m</option><option>1h</option><option>4h</option></select></label>',
      ' <label class="rv-campo"><span>lote</span><select class="rv-sel" id="rv-lote"><option value="0.01">0,01</option><option value="0.03">0,03</option><option value="0.06">0,06</option></select></label>',
      ' <button type="button" class="rv-btn" id="rv-vivo">● acompanhar ao vivo</button>',
      ' <button type="button" class="rv-btn" id="rv-ir">ver o teste ›</button>',
      '</div>',
      '<div class="rv-linha" id="rv-linha">ao vivo desligado</div>',
      '<div class="rv-grid">',
      ' <div class="rv-bloco"><h4>Operação em papel · acompanhando o mercado</h4><div class="rv-graf" id="rv-graf"></div></div>',
      ' <div class="rv-bloco"><h4>Conta</h4><div class="rv-kv" id="rv-estado"></div><h4 style="margin-top:10px">Leitura do momento</h4><div class="rv-kv" id="rv-disparo"></div></div>',
      '</div>',
      '<div class="rv-bloco" style="margin-top:8px"><h4>Livro de ordens</h4><div style="max-height:190px;overflow:auto"><table class="rv-livro" id="rv-livro"></table></div></div>'
    ].join('');
    document.body.appendChild(card);

    el.card = card;
    el.ativo = card.querySelector('#rv-ativo'); el.tf = card.querySelector('#rv-tf'); el.lote = card.querySelector('#rv-lote');
    el.btn = card.querySelector('#rv-vivo'); el.ir = card.querySelector('#rv-ir');
    el.linha = card.querySelector('#rv-linha'); el.graf = card.querySelector('#rv-graf');
    el.estado = card.querySelector('#rv-estado'); el.disparo = card.querySelector('#rv-disparo'); el.livro = card.querySelector('#rv-livro');

    el.btn.addEventListener('click', function () { if (S.vivo) desligar(); else ligar(); });
    el.ir.addEventListener('click', function () {
      var b = document.querySelector('.vx-aba[data-aba="robo-ciclos-card"]');
      if (b) b.click();
    });
    el.ativo.addEventListener('change', function () { CFG.ativo = el.ativo.value; if (S.vivo) rodar(); });
    el.tf.addEventListener('change', function () { CFG.tf = el.tf.value; if (S.vivo) rodar(); });
    el.lote.addEventListener('change', function () { CFG.lote = Number(el.lote.value); if (S.vivo) rodar(); });
  }

  function iniciar() { if (!document.getElementById('robo-vivo-card')) montar(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else setTimeout(iniciar, 60);

  window.RoboVivo = { ligar: ligar, desligar: desligar, estado: S, config: CFG };
})();
