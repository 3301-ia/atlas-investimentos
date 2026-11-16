/* ══════════════════════════════════════════════════════════════════════
   ATLAS VECTRA · COCKPIT  (atlas-cockpit.js)
   ---------------------------------------------------------------------
   Esta camada NÃO reescreve indicador nem motor de sinal. Ela:
     1. organiza a casa: cabeçalho profissional, trilha de números,
        gaveta de ferramentas e coluna de trabalho;
     2. adota os cartões que antes flutuavam soltos pela tela
        (sinais, avisos, estado) sem tocar no DOM interno deles;
     3. acrescenta a leitura de DOMINÂNCIA multi-tempo, com as quatro
        dimensões que a formam (tendência, estrutura, momento, fluxo)
        e registra as viradas como sinal de leitura por tempo gráfico.

   Dados de dominância: velas públicas da OKX, a mesma fonte do painel.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__atlasCockpit) return;
  window.__atlasCockpit = true;

  var TFS = [
    { rot: '1m', bar: '1m', peso: 0.06 },
    { rot: '5m', bar: '5m', peso: 0.12 },
    { rot: '15m', bar: '15m', peso: 0.20 },
    { rot: '1H', bar: '1H', peso: 0.24 },
    { rot: '4H', bar: '4H', peso: 0.22 },
    { rot: '1D', bar: '1D', peso: 0.16 }
  ];

  var estado = { dom: {}, geral: 0, consenso: { up: 0, dn: 0 }, lido: 0, preco: 0, var24: null, pos: null };
  var CHAVE_SINAIS = 'vxDominioSinais';
  var CHAVE_ULTIMO = 'vxDominioUltimo';
  var CHAVE_DIMS = 'vxCockpitDims';

  /* ─────────── utilidades ─────────── */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function n(v, c) {
    if (v == null || !isFinite(v)) return '--';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c == null ? 2 : c, maximumFractionDigits: c == null ? 2 : c });
  }
  function num(v) { return (v == null || !isFinite(v)) ? '--' : Number(v).toFixed(2).replace('.', ','); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function agora() { var d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  /* ─────────── matemática ─────────── */
  function ema(arr, n) {
    var k = 2 / (n + 1), out = [], prev = null;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (prev == null) prev = v; else prev = v * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
  }
  function rsi(closes, n) {
    n = n || 14;
    if (closes.length < n + 1) return 50;
    var g = 0, p = 0;
    for (var i = closes.length - n; i < closes.length; i++) {
      var d = closes[i] - closes[i - 1];
      if (d >= 0) g += d; else p -= d;
    }
    var ag = g / n, ap = p / n;
    if (ap === 0) return 100;
    var rs = ag / ap;
    return 100 - (100 / (1 + rs));
  }
  function atr(h, l, c, n) {
    n = n || 14;
    if (c.length < n + 1) return 0;
    var s = 0;
    for (var i = c.length - n; i < c.length; i++) {
      var tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      s += tr;
    }
    return s / n;
  }

  /* ─────────── leitura de dominância de um tempo gráfico ─────────── */
  function medir(v) {
    var c = v.c, o = v.o, h = v.h, l = v.l, vol = v.v;
    var n = c.length;
    if (n < 30) return null;
    var a = atr(h, l, c, 14) || (c[n - 1] * 0.002);
    var e8 = ema(c, 8), e21 = ema(c, 21);
    var i = n - 1;

    /* tendência: distância entre 8 e 21 somada à inclinação da 21 */
    var tend = 0.62 * ((e8[i] - e21[i]) / (0.9 * a)) + 0.38 * ((e21[i] - e21[Math.max(0, i - 10)]) / (0.6 * a));
    tend = clamp(tend, -1.4, 1.4) / 1.4;

    /* estrutura: onde o preço está dentro do range das últimas 24 velas */
    var hi = -Infinity, lo = Infinity;
    for (var k = Math.max(0, n - 24); k < n; k++) { if (h[k] > hi) hi = h[k]; if (l[k] < lo) lo = l[k]; }
    var estr = (hi - lo) > 0 ? ((c[i] - lo) / (hi - lo)) * 2 - 1 : 0;

    /* momento: RSI traduzido em -1..1 */
    var mom = (rsi(c, 14) - 50) / 50;
    var rsiV = rsi(c, 14);

    /* fluxo: volume assinado pelo corpo das últimas 20 velas */
    var sg = 0, tot = 0;
    for (var j = Math.max(0, n - 20); j < n; j++) {
      var w = Math.abs(vol[j] || 1);
      sg += (c[j] >= o[j] ? 1 : -1) * w;
      tot += w;
    }
    var flux = tot > 0 ? clamp(sg / tot, -1, 1) : 0;

    var nota = 100 * (0.32 * tend + 0.24 * estr + 0.24 * mom + 0.20 * flux);
    return {
      nota: nota,
      tend: tend, estr: estr, mom: mom, flux: flux,
      rsi: rsiV,
      lado: nota >= 25 ? 'compra' : (nota <= -25 ? 'venda' : 'neutro'),
      forca: Math.min(100, Math.abs(nota))
    };
  }

  /* ─────────── busca das velas ─────────── */
  function velas(inst, bar) {
    var url = 'https://www.okx.com/api/v5/market/candles?instId=' + parOkx() + '&bar=' + bar + '&limit=140';
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.data || !j.data.length) return null;
      var rows = j.data.slice().reverse();     /* a OKX devolve do mais novo para o mais velho */
      var v = { t: [], o: [], h: [], l: [], c: [], v: [] };
      rows.forEach(function (r) {
        v.t.push(+r[0]); v.o.push(+r[1]); v.h.push(+r[2]); v.l.push(+r[3]); v.c.push(+r[4]); v.v.push(+r[5]);
      });
      return v;
    }).catch(function () { return null; });
  }

  function instrumento() {
    var s = document.getElementById('sym-select');
    var v = s ? String(s.value || 'BTCUSDT') : 'BTCUSDT';
    return v.replace('-', '');          /* BTCUSDT: nome curto para a tela */
  }
  /* a OKX pede o par com hífen: BTC-USDT */
  function parOkx() {
    var v = instrumento();
    if (v.indexOf('USDT') > 0) return v.replace('USDT', '-USDT');
    if (v.indexOf('USDC') > 0) return v.replace('USDC', '-USDC');
    return v;
  }

  function cicloDominancia() {
    Promise.all(TFS.map(function (t) { return velas(null, t.bar); })).then(function (todos) {
      var soma = 0, peso = 0, up = 0, dn = 0;
      TFS.forEach(function (t, i) {
        var v = todos[i];
        var m = v ? medir(v) : null;
        if (!m) { estado.dom[t.rot] = null; return; }
        anterior = estado.dom[t.rot];
        estado.dom[t.rot] = m;
        soma += m.nota * t.peso; peso += t.peso;
        if (m.lado === 'compra') up++; else if (m.lado === 'venda') dn++;
        registrarVirada(t.rot, m, anterior, todos[i]);
      });
      estado.geral = peso > 0 ? soma / peso : 0;
      estado.consenso = { up: up, dn: dn };
      estado.lido = Date.now();
      renderDominancia();
      renderLeituras();
      pintarKpis();
    });
  }

  var anterior = null;

  /* virada de dominância num tempo gráfico = sinal de leitura */
  function ultimosLados() {
    try { return JSON.parse(localStorage.getItem(CHAVE_ULTIMO) || '{}'); } catch (e) { return {}; }
  }
  function guardarLado(tf, lado) {
    try { var o = ultimosLados(); o[tf] = lado; localStorage.setItem(CHAVE_ULTIMO, JSON.stringify(o)); } catch (e) {}
  }
  function registrarVirada(tf, m, antes, v) {
    if (!m) return;
    if (!antes) {
      /* primeira leitura desta sessão: compara com a ultima gravada, sem inventar */
      var g = ultimosLados();
      if (g[tf] && g[tf] !== m.lado && m.lado !== 'neutro') {
        anterior = { lado: g[tf] };
        antes = anterior;
      }
      guardarLado(tf, m.lado);
      if (!antes) return;
    }
    guardarLado(tf, m.lado);
    if (antes.lado === m.lado) return;
    if (m.lado === 'neutro') return;
    var preco = v && v.c.length ? v.c[v.c.length - 1] : estado.preco;
    var lista = lerSinais();
    var ult = lista[0];
    if (ult && ult.tf === tf && ult.lado === m.lado && (Date.now() - ult.t) < 60000) return;
    lista.unshift({ tf: tf, lado: m.lado, preco: preco, forca: Math.round(m.forca), t: Date.now() });
    try { localStorage.setItem(CHAVE_SINAIS, JSON.stringify(lista.slice(0, 24))); } catch (e) {}
  }
  function lerSinais() {
    try { return JSON.parse(localStorage.getItem(CHAVE_SINAIS) || '[]'); } catch (e) { return []; }
  }

  /* ─────────── desenho: dominância ─────────── */
  function dimsAbertas() {
    try { return localStorage.getItem(CHAVE_DIMS) === '1'; } catch (e) { return false; }
  }

  function renderDominancia() {
    var box = document.querySelector('#vx-dom .vx-card-b');
    if (!box) return;
    var g = estado.geral;
    var lado = g >= 18 ? 'compra' : (g <= -18 ? 'venda' : 'equilíbrio');
    var cor = lado === 'compra' ? 'var(--vx-up)' : (lado === 'venda' ? 'var(--vx-dn)' : 'var(--vx-dim)');
    var quem = estado.consenso.up >= 4 ? estado.consenso.up + ' de 6 compradoras'
             : (estado.consenso.dn >= 4 ? estado.consenso.dn + ' de 6 vendedoras'
             : 'sem consenso (' + estado.consenso.up + ' alta / ' + estado.consenso.dn + ' baixa)');

    var apoiam = [], opoem = [];
    TFS.forEach(function (t) {
      var m = estado.dom[t.rot];
      if (!m || m.lado === 'neutro') return;
      if ((lado === 'compra' && m.lado === 'compra') || (lado === 'venda' && m.lado === 'venda')) apoiam.push(t.rot);
      else opoem.push(t.rot);
    });
    var frase;
    if (lado === 'equilíbrio') {
      var curtos = [], longos = [];
      TFS.forEach(function (t) {
        var m = estado.dom[t.rot]; if (!m || m.lado === 'neutro') return;
        if (t.rot === '1m' || t.rot === '5m' || t.rot === '15m') { if (m.lado === 'compra') curtos.push(t.rot); }
        else if (m.lado === 'venda') longos.push(t.rot);
      });
      frase = (curtos.length ? 'curto prazo compra (' + curtos.join(', ') + ')' : 'sem tração no curto')
            + (longos.length ? ' · longo prazo vende (' + longos.join(', ') + ')' : '')
            + ' — sem lado dominante';
    } else {
      frase = 'apoiada por ' + apoiam.join(', ') + (opoem.length ? ' · contra em ' + opoem.join(', ') : ' · sem oposição');
    }

    var h = '<div class="vx-dom-top">' +
      '<div><div class="vx-dom-verdict" style="color:' + cor + '">' + (lado === 'equilíbrio' ? 'Equilíbrio' : lado === 'compra' ? 'Dominância compradora' : 'Dominância vendedora') + '</div>' +
      '<div class="vx-dom-sub">' + frase + '</div></div>' +
      '<div class="vx-dom-score" style="color:' + cor + '">' + (g >= 0 ? '+' : '') + Math.round(g) + '</div></div>';

    h += '<table class="vx-dom-tab">';
    TFS.forEach(function (t) {
      var m = estado.dom[t.rot];
      if (!m) { h += '<tr><td class="tf">' + t.rot + '</td><td class="bar"></td><td class="num" style="color:var(--vx-dim)">--</td></tr>'; return; }
      var pc = clamp(Math.abs(m.nota), 0, 100);
      var fill = m.nota >= 0
        ? '<div class="fill up" style="width:' + (pc / 2) + '%"></div>'
        : '<div class="fill dn" style="width:' + (pc / 2) + '%"></div>';
      var c = m.lado === 'compra' ? 'var(--vx-up)' : (m.lado === 'venda' ? 'var(--vx-dn)' : 'var(--vx-dim)');
      h += '<tr data-tf="' + t.rot + '" title="abrir ' + t.rot + ' no gráfico"><td class="tf">' + t.rot + '</td>' +
           '<td class="bar"><div class="track">' + fill + '<div class="mid"></div></div></td>' +
           '<td class="num" style="color:' + c + '">' + (m.nota >= 0 ? '+' : '') + Math.round(m.nota) + '</td></tr>';
    });
    h += '</table>';

    if (dimsAbertas()) {
      h += '<table class="vx-dims" style="margin-top:8px"><thead><tr>' +
           '<td class="tf"></td><td class="num" style="width:auto;text-align:left;color:var(--vx-dim);font-size:8.5px">tend</td>' +
           '<td class="num" style="width:auto;text-align:left;color:var(--vx-dim);font-size:8.5px">estr</td>' +
           '<td class="num" style="width:auto;text-align:left;color:var(--vx-dim);font-size:8.5px">mom</td>' +
           '<td class="num" style="text-align:left;color:var(--vx-dim);font-size:8.5px">fluxo</td></tr></thead><tbody>';
      TFS.forEach(function (t) {
        var m = estado.dom[t.rot];
        var cel = function (v) {
          var c = v >= 0.08 ? 'var(--vx-up)' : (v <= -0.08 ? 'var(--vx-dn)' : 'var(--vx-dim)');
          return '<td class="num" style="width:auto;color:' + c + ';font-size:9.5px">' + (v >= 0 ? '+' : '') + Math.round(v * 100) + '</td>';
        };
        h += '<tr data-tf="' + t.rot + '" title="abrir ' + t.rot + ' no gráfico"><td class="tf">' + t.rot + '</td>' +
             (m ? cel(m.tend) + cel(m.estr) + cel(m.mom) + cel(m.flux)
                : '<td class="num">--</td><td class="num">--</td><td class="num">--</td><td class="num">--</td>') + '</tr>';
      });
      h += '</tbody></table>';
    }
    h += '<div class="vx-dom-sub" style="margin-top:8px">tendência · estrutura · momento · fluxo — lido ' + agora() + '</div>';
    box.innerHTML = h;
    [].forEach.call(box.querySelectorAll('.vx-dom-tab tr[data-tf]'), function (tr) {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () {
        var sel = document.getElementById('tf-select');
        if (!sel) return;
        sel.value = tr.getAttribute('data-tf');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }

  /* ─────────── desenho: leituras (viradas) ─────────── */
  function renderLeituras() {
    var box = document.querySelector('#vx-leituras .vx-card-b');
    if (!box) return;
    var lista = lerSinais();
    if (!lista.length) {
      box.innerHTML = '<div class="vx-empty">Nenhuma virada de dominância registrada nesta sessão. A lista começa quando um tempo gráfico troca de lado.</div>';
      return;
    }
    box.innerHTML = lista.slice(0, 8).map(function (s) {
      var d = new Date(s.t);
      var quando = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
                   String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      return '<div class="vx-leitura"><span class="vx-tag ' + (s.lado === 'compra' ? 'up' : 'dn') + '">' + s.lado + '</span>' +
             '<b style="font-weight:600">' + s.tf + '</b>' +
             '<span style="color:var(--vx-dim)">força ' + s.forca + '</span>' +
             '<span class="vx-when">' + quando + ' · ' + n(s.preco, 0) + '</span></div>';
    }).join('');
  }

  /* ─────────── trilha de números ─────────── */
  function pintarKpis() {
    var preco = estado.preco || 0;
    var g = estado.geral;
    var k = function (id, valorHtml, sub, classe) {
      var box = document.getElementById('kpi-' + id);
      if (!box) return;
      box.className = 'kpi' + (classe ? ' ' + classe : '');
      var b = box.querySelector('b'), s = box.querySelector('small');
      if (b) b.innerHTML = valorHtml;
      if (s) s.innerHTML = sub || '&nbsp;';
    };
    k('preco', preco ? n(preco, 2) : '--', 'fonte OKX · ' + (document.getElementById('tf-select') ? document.getElementById('tf-select').value : '15m'), '');
    var v = estado.var24;
    k('var24', v == null ? '--' : ((v >= 0 ? '+' : '') + num(v) + '%'), v == null ? 'sem leitura' : (v >= 0 ? 'compra no dia' : 'venda no dia'), v == null ? '' : (v >= 0 ? 'up' : 'dn'));
    k('dominio', (g >= 0 ? '+' : '') + Math.round(g), estado.consenso.up + ' alta · ' + estado.consenso.dn + ' baixa', g >= 18 ? 'up' : (g <= -18 ? 'dn' : ''));
    var pos = estado.pos;
    if (pos) {
      var R = 0;
      if (pos.media && pos.stop) {
        var risco = pos.media - pos.stop;
        R = risco > 0 ? (preco - pos.media) / risco : 0;
      }
      k('posicao', pos.lado === 'compra' ? 'COMPRA' + (pos.lotes ? ' ' + pos.lotes + 'x' : '') : String(pos.lado || '--').toUpperCase(),
        'média ' + n(pos.media, 0) + ' · ' + (R >= 0 ? '+' : '') + num(R) + 'R', R >= 0 ? 'up' : 'dn');
      k('risco', pos.stop ? n(Math.abs(preco - pos.stop), 0) + ' pts' : '--', pos.stop ? 'stop ' + n(pos.stop, 0) : 'sem stop', '');
    } else {
      k('posicao', 'FORA', 'sem posição aberta', '');
      k('risco', '--', 'sem stop', '');
    }
    var qtd = lerSinais().length;
    k('sinais', String(qtd), qtd ? 'viradas registradas' : 'aguardando virada', '');

    /* HUD */
    var hp = document.getElementById('hud-preco');
    if (hp) {
      hp.textContent = preco ? n(preco, 2) : '--';
      var hv = document.getElementById('hud-var');
      hv.textContent = estado.var24 == null ? '--' : (estado.var24 >= 0 ? '+' : '') + num(estado.var24) + '%';
      hv.style.color = estado.var24 == null ? 'var(--vx-dim)' : (estado.var24 >= 0 ? 'var(--vx-up)' : 'var(--vx-dn)');
      var hd = document.getElementById('hud-dom');
      hd.textContent = (g >= 0 ? '+' : '') + Math.round(g);
      hd.style.color = g >= 18 ? 'var(--vx-up)' : (g <= -18 ? 'var(--vx-dn)' : 'var(--vx-dim)');
      var hpos = document.getElementById('hud-pos');
      if (estado.pos) {
        var risco = estado.pos.media - estado.pos.stop;
        var rr = risco > 0 ? (preco - estado.pos.media) / risco : 0;
        hpos.textContent = (estado.pos.lado === 'compra' ? 'COMPRA ' : 'VENDA ') + (rr >= 0 ? '+' : '') + num(rr) + 'R';
        hpos.style.color = rr >= 0 ? 'var(--vx-up)' : 'var(--vx-dn)';
      } else { hpos.textContent = 'fora'; hpos.style.color = 'var(--vx-dim)'; }
    }
  }

  /* HUD do modo imersivo: só o essencial, flutuando sobre o gráfico */
  function montarHud() {
    if (document.getElementById('vx-hud')) return;
    var h = el('div', '');
    h.id = 'vx-hud';
    h.innerHTML =
      '<div class="hud-i"><u>Preço</u><b id="hud-preco">--</b></div>' +
      '<div class="hud-i"><u>24h</u><b id="hud-var">--</b></div>' +
      '<div class="hud-i"><u>Dominância</u><b id="hud-dom">--</b></div>' +
      '<div class="hud-i"><u>Posição</u><b id="hud-pos">--</b></div>';
    document.body.appendChild(h);
  }

  /* ─────────── montagem da casa ─────────── */
  /* a marca do app volta para o cabeçalho, no tamanho de um selo */
  function logoMarca() {
    var orig = document.querySelector('img.logo-icon, .logo img, img[src*="vectra-icon"]');
    if (orig) {
      var img = document.createElement('img');
      img.src = orig.getAttribute('src');
      img.alt = 'Vectra';
      img.className = 'vx-logo';
      return img;
    }
    return null;
  }

  function montarCabecalho() {
    var page = document.querySelector('.page-col');
    if (!page || document.getElementById('vx-head')) return;
    var head = el('header'); head.id = 'vx-head';
    head.innerHTML =
      '<div class="vx-hline">' +
        '<div class="vx-brand"><span class="vx-mark"></span><div>Atlas Vectra<small>inteligência de mesa</small></div></div>' +
        '<div class="vx-inst" id="vx-inst"></div>' +
        '<div class="vx-price"><b id="vx-preco">--</b><span id="vx-var">--</span></div>' +
        '<div class="vx-live"><i></i><span id="vx-live-txt">ao vivo</span></div>' +
        '<button type="button" class="vx-toolbtn" id="vx-imersao-btn">Imersão (F)</button>' +
        '<button type="button" class="vx-toolbtn" id="vx-tools-btn" aria-expanded="false">Ferramentas <span style="opacity:.6">▾</span></button>' +
      '</div>' +
      '<div id="vx-kpis">' +
        '<div class="kpi" id="kpi-preco"><u>Preço</u><b>--</b><small>&nbsp;</small></div>' +
        '<div class="kpi" id="kpi-var24"><u>Variação 24h</u><b>--</b><small>&nbsp;</small></div>' +
        '<div class="kpi" id="kpi-dominio"><u>Dominância</u><b>--</b><small>&nbsp;</small></div>' +
        '<div class="kpi" id="kpi-posicao"><u>Posição</u><b>--</b><small>&nbsp;</small></div>' +
        '<div class="kpi" id="kpi-risco"><u>Distância do stop</u><b>--</b><small>&nbsp;</small></div>' +
        '<div class="kpi" id="kpi-sinais"><u>Viradas</u><b>--</b><small>&nbsp;</small></div>' +
      '</div>' +
      '<div id="vx-tools"></div>';

    var topbar = document.querySelector('.topbar');
    if (topbar) topbar.insertAdjacentElement('afterend', head);
    else page.insertBefore(head, page.firstChild);

    /* seletor de ativo e de tempo ganham casa própria no cabeçalho */
    var inst = head.querySelector('#vx-inst');
    ['sym-select', 'tf-select'].forEach(function (id) {
      var s = document.getElementById(id);
      if (s) { inst.appendChild(s); }
    });
    if (document.getElementById('tf-select')) {
      document.getElementById('tf-select').addEventListener('change', function () { setTimeout(function () { cicloDominancia(); pintarKpis(); }, 400); });
    }
    if (document.getElementById('sym-select')) {
      document.getElementById('sym-select').addEventListener('change', function () { setTimeout(cicloDominancia, 400); });
    }

    head.querySelector('#vx-tools-btn').addEventListener('click', function () {
      var t = document.getElementById('vx-tools');
      var on = !t.classList.contains('on');
      t.classList.toggle('on', on);
      this.setAttribute('aria-expanded', on ? 'true' : 'false');
    });

    var marca = head.querySelector('.vx-mark');
    var lg = logoMarca();
    if (marca && lg) { marca.appendChild(lg); marca.classList.add('vx-mark-img'); }
    head.querySelector('#vx-imersao-btn').addEventListener('click', function () { alternarImersao(); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'f' || ev.key === 'F') {
        var tag = (ev.target && ev.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
        ev.preventDefault(); alternarImersao();
      }
      if (ev.key === 'Escape' && imersivo) alternarImersao(false);
    });

    posicionarChip();
    window.addEventListener('resize', function () { clearTimeout(window.__vxRz); window.__vxRz = setTimeout(function () { posicionarChip(); window.dispatchEvent(new Event('resize')); }, 200); });

    absorverTopbar(head);
    organizarFerramentas();
  }

  /* a barra antiga tinha marca repetida, status solto e números sem rótulo.
     O que ainda serve (categorias, tema, alertas) vem para o cabeçalho e a
     barra inteira se aposenta. */
  function absorverTopbar(head) {
    var topbar = document.querySelector('.topbar');
    if (!topbar) return;
    var inst = head.querySelector('#vx-inst');

    var cats = topbar.querySelector('.cat-bar');
    if (cats) inst.appendChild(cats);

    var extra = el('div', 'vx-extra');
    [].slice.call(topbar.querySelectorAll('button.btn')).forEach(function (b) {
      var t = (b.textContent || '').trim();
      if (t === '☀️' || t === '🌙' || t.indexOf('🔔') === 0 || t.indexOf('Atalhos') >= 0) extra.appendChild(b);
    });
    if (extra.children.length) {
      var price = head.querySelector('.vx-price');
      if (price && price.parentElement) price.parentElement.insertBefore(extra, head.querySelector('#vx-tools-btn'));
    }

    /* marca repetida, faróis e números sem rótulo saem de cena */
    [].slice.call(topbar.children).forEach(function (c) {
      if (c.classList.contains('logo') || c.classList.contains('sep') || c.classList.contains('dot') ||
          c.tagName === 'SPAN' || c.classList.contains('cat-bar')) {
        c.style.display = 'none';
      }
    });
    topbar.classList.add('vx-aposentada');
    topbar.style.setProperty('display', 'none', 'important');
  }

  /* leva os botões que se acumulavam na barra para uma gaveta com grupos */
  function organizarFerramentas() {
    var tools = document.getElementById('vx-tools');
    var topbar = document.querySelector('.topbar');
    if (!tools || !topbar) return;

    var GRUPOS = [
      { titulo: 'Sinais e validação', chaves: ['sinais ativos', 'tudo', 'auto', 'multi', 'multi-tf', 'validador'] },
      { titulo: 'Estudos', chaves: ['rsi table', 'rainbow', 'arquivo', 'backtest'] },
      { titulo: 'Ferramentas', chaves: ['macro', 'terminal', 'indicadores', 'atalhos'] },
      { titulo: 'Camadas do gráfico', chaves: ['médias base', 'vectra dynamic', 'gann sq9', '8-ema ribbon', 'mtf ribbon matrix', 'fibbo reversal', 'fibbo ribbon', 'bússola', 'potential', 'gold', 'ocultar camadas'] }
    ];

    var botoes = [].slice.call(topbar.querySelectorAll('button.btn'));
    var usados = [];
    GRUPOS.forEach(function (g) {
      var achados = botoes.filter(function (b) {
        var t = (b.textContent || '').toLowerCase();
        var bate = g.chaves.some(function (k) { return t.indexOf(k) >= 0; });
        if (bate && usados.indexOf(b) < 0) { usados.push(b); return true; }
        return false;
      });
      if (!achados.length) return;
      var caixa = el('div', 'vx-grp', '<h4>' + g.titulo + '</h4>');
      var row = el('div', 'vx-row');
      achados.forEach(function (b) { row.appendChild(b); });
      caixa.appendChild(row);
      tools.appendChild(caixa);
    });

    /* o que sobra fica na gaveta também, sem inventar categoria */
    var resto = botoes.filter(function (b) { return usados.indexOf(b) < 0 && b.offsetParent !== null; });
    if (resto.length) {
      var caixa = el('div', 'vx-grp', '<h4>Outros</h4>');
      var row = el('div', 'vx-row');
      resto.forEach(function (b) {
        if ((b.textContent || '').trim().length > 28) return;   /* menus gigantes ficam na barra */
        row.appendChild(b);
      });
      caixa.appendChild(row);
      tools.appendChild(caixa);
    }
  }

  function montarColuna() {
    var layout = document.querySelector('.layout');
    if (!layout || document.getElementById('vx-work')) return;
    var col = document.createElement('div');
    col.id = 'vx-work';
    col.innerHTML =
      '<div id="vx-work-top"><span>mesa</span><button type="button" id="vx-work-fold" title="recolher a coluna">⟩</button></div>' +
      '<section class="vx-card" id="vx-dom">' +
        '<div class="vx-card-h"><h3>Dominância</h3><button type="button" id="vx-dims-btn" class="vx-mini">dimensões</button></div>' +
        '<div class="vx-card-b"></div>' +
      '</section>' +
      '<section class="vx-card" id="vx-leituras">' +
        '<div class="vx-card-h"><h3>Viradas de dominância</h3><span>sinal de leitura</span></div>' +
        '<div class="vx-card-b"></div>' +
      '</section>';
    layout.appendChild(col);
    var fold = col.querySelector('#vx-work-fold');
    if (fold) fold.addEventListener('click', function () {
      var fechada = col.classList.toggle('vx-fechada');
      fold.textContent = fechada ? '⟨' : '⟩';
      setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 260);
    });
    var db = col.querySelector('#vx-dims-btn');
    if (db) {
      db.textContent = dimsAbertas() ? 'resumo' : 'dimensões';
      db.addEventListener('click', function () {
        try { localStorage.setItem(CHAVE_DIMS, dimsAbertas() ? '0' : '1'); } catch (e) {}
        db.textContent = dimsAbertas() ? 'resumo' : 'dimensões';
        renderDominancia();
      });
    }
    adotarCartoes();
  }

  /* adota os cartões flutuantes, preservando o DOM e os eventos deles */
  function adotarCartoes() {
    var col = document.getElementById('vx-work');
    if (!col) return;
    ['vx-sinais', 'vx-avisos', 'vx-dock'].forEach(function (id) {
      var alvo = document.getElementById(id);
      if (!alvo || alvo.parentElement === col) return;
      col.appendChild(alvo);
      alvo.classList.remove('recolhido');
      alvo.style.position = 'static';
      alvo.style.inset = 'auto';
      alvo.style.left = alvo.style.top = alvo.style.right = alvo.style.bottom = 'auto';
      alvo.style.width = '100%';
      alvo.style.height = 'auto';
      alvo.style.transform = 'none';
    });
  }

  /* ─────────── navegação: ícones de linha, sem emoji ─────────── */
  var ICONES = {
    'inicio':   'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
    'btn-robo': 'M9 3h6M12 3v3M6 8h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM9.5 12.5h.01M14.5 12.5h.01M9 16h6',
    'nav-nucleo': 'M12 3 3 7.5 12 12l9-4.5L12 3zM3 12.5 12 17l9-4.5M3 17 12 21.5 21 17',
    'nav-vigia': 'M12 3 5 6v5.5c0 4.2 2.9 7.7 7 9.5 4.1-1.8 7-5.3 7-9.5V6l-7-3z',
    'nav-estudos': 'M4 20 20 4M14 4h6v6M4 14v6h6',
    'nav-imperial': 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
    'nav-deriv': 'M12 3l9 9-9 9-9-9 9-9z',
    'nav-consenso': 'M5 6h14M5 12h14M5 18h14M9 4v4M15 10v4M11 16v4',
    'nav-analise': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    'nav-alerts': 'M12 3a5 5 0 0 0-5 5v4l-2 4h14l-2-4V8a5 5 0 0 0-5-5zM10 19a2 2 0 0 0 4 0',
    'nav-rsi-matrix': 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    'nav-mais': 'M6 12h.01M12 12h.01M18 12h.01'
  };
  var ROTULOS = {
    'inicio': 'Início', 'btn-robo': 'Robô', 'nav-nucleo': 'Código', 'nav-vigia': 'Vigia',
    'nav-estudos': 'Estudos', 'nav-imperial': 'Imperial', 'nav-deriv': 'Deriv',
    'nav-consenso': 'Consenso', 'nav-analise': 'Análise', 'nav-alerts': 'Alertas',
    'nav-rsi-matrix': 'RSI Matrix', 'nav-mais': 'Mais'
  };

  function svgIcone(chave) {
    var d = ICONES[chave];
    if (!d) return '';
    return '<svg class="vx-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  function arrumarNavegacao() {
    var alvos = [
      { sel: '.side-nav-top .nav-item', chave: function (e, i) { return e.id || (i === 0 ? 'inicio' : null); } },
      { sel: '#btn-robo', chave: function () { return 'btn-robo'; } },
      { sel: '#nav-mais', chave: function () { return 'nav-mais'; } }
    ];
    var itens = [].slice.call(document.querySelectorAll('.side-nav-top .nav-item'));
    var robo = document.getElementById('btn-robo');
    if (robo && itens.indexOf(robo) < 0) itens.push(robo);
    var mais = document.getElementById('nav-mais');
    if (mais) itens.push(mais);

    itens.forEach(function (e) {
      var chave = e.id || (e.classList.contains('active') && !e.id ? 'inicio' : '');
      if (!chave) {
        var t = (e.textContent || '').trim();
        if (/Inicio|Início/i.test(t)) chave = 'inicio';
      }
      if (!chave || !ICONES[chave]) return;
      if (e.querySelector('.vx-ico')) {
        /* o módulo do robô reescreve o conteúdo dele com preço: limpa de novo */
        if (chave === 'btn-robo') {
          var num = e.querySelector('.vx-robo-num');
          if (!num) {
            var velho = (e.textContent || '').replace(/\s+/g, ' ').trim();
            var m = velho.match(/[\d.]+,\d+|\$[\d.,]+/);
            e.innerHTML = svgIcone(chave) + '<span class="vx-nav-lbl">' + ROTULOS[chave] + '</span>' +
              (m ? '<span class="vx-robo-num">' + m[0] + '</span>' : '');
          }
        }
        return;
      }
      /* primeiro desenho do item */
      var rotulo = ROTULOS[chave] || chave;
      if (chave === 'btn-robo') {
        var txt = (e.textContent || '').replace(/\s+/g, ' ').trim();
        var mm = txt.match(/[\d.]+,\d+|\$[\d.,]+/);
        e.innerHTML = svgIcone(chave) + '<span class="vx-nav-lbl">' + rotulo + '</span>' +
          (mm ? '<span class="vx-robo-num">' + mm[0] + '</span>' : '');
      } else {
        e.innerHTML = svgIcone(chave) + '<span class="vx-nav-lbl">' + rotulo + '</span>';
      }
      e.setAttribute('title', rotulo);
    });
  }

  /* o passador do TS cabe no cabeçalho em tela larga; em tela estreita desce
     para a gaveta, para não empurrar o preço para fora da tela */
  function posicionarChip() {
    var chip = document.getElementById('ts-chip');
    var head = document.getElementById('vx-head');
    var tools = document.getElementById('vx-tools');
    if (!chip || !head) return;
    chip.style.position = 'static';
    chip.style.left = chip.style.top = chip.style.right = chip.style.bottom = 'auto';
    chip.style.transform = 'none';
    chip.style.margin = '0';
    chip.classList.add('vx-tspill');
    if (window.innerWidth >= 1600) {
      var priceBox = head.querySelector('.vx-price');
      if (priceBox && chip.parentElement !== priceBox.parentElement) {
        priceBox.parentElement.insertBefore(chip, head.querySelector('#vx-imersao-btn'));
      }
    } else if (tools) {
      var g = document.getElementById('vx-tools-passador');
      if (!g) {
        g = el('div', 'vx-grp');
        g.id = 'vx-tools-passador';
        g.innerHTML = '<h4>Passador e tema</h4>';
        var row = el('div', 'vx-row');
        row.id = 'vx-tools-passador-row';
        g.appendChild(row);
        tools.insertBefore(g, tools.firstChild);
      }
      var row2 = document.getElementById('vx-tools-passador-row');
      if (row2 && chip.parentElement !== row2) row2.appendChild(chip);
      var extra = document.querySelector('.vx-extra');
      if (extra && row2 && extra.parentElement !== row2) row2.appendChild(extra);
    }
  }

  /* ─────────── modo imersivo ─────────── */
  var imersivo = false;
  function alternarImersao(forcar) {
    imersivo = (forcar == null) ? !imersivo : !!forcar;
    document.body.classList.toggle('vx-imersivo', imersivo);
    var b = document.getElementById('vx-imersao-btn');
    if (b) b.textContent = imersivo ? 'Sair da imersão (F)' : 'Imersão (F)';
    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 300);
  }

  /* ─────────── cartões soltos viram pilha na coluna ─────────── */
  function adotarFlutuantes() {
    var col = document.getElementById('vx-work');
    if (!col) return;
    window.__vxAdotar = adotarFlutuantes;
    var pilha = document.getElementById('vx-pilha');
    if (!pilha) {
      pilha = el('section', 'vx-card', '<div class="vx-card-h"><h3>Painéis</h3><span>abertos</span></div>');
      pilha.id = 'vx-pilha';
      var corpo = el('div', 'vx-card-b', '');
      corpo.id = 'vx-pilha-corpo';
      pilha.appendChild(corpo);
      pilha.style.display = 'none';
      col.appendChild(pilha);
    }
    var corpo = document.getElementById('vx-pilha-corpo');
    [].slice.call(document.body.children).forEach(function (e) {
      if (!e.id || e === col || e.closest('#vx-work')) return;
      if (/modal|overlay|toast|app-shell|vx-avisos|vx-sinais|vx-dock/.test(e.id + ' ' + e.className)) return;
      var cs = getComputedStyle(e);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
      var r = e.getBoundingClientRect();
      if (r.width < 120 || r.width > 480 || r.height < 24) return;
      corpo.appendChild(e);
      e.style.position = 'static';
      e.style.width = '100%';
      e.style.maxWidth = 'none';
      e.style.margin = '0 0 8px';
      e.style.transform = 'none';
      e.style.left = e.style.top = e.style.right = e.style.bottom = 'auto';
      pilha.style.display = '';
    });
    if (!corpo.children.length) pilha.style.display = 'none';
  }

  /* ─────────── leitura de preço e posição ─────────── */
  function lerPreco() {
    try {
      if (window.AtlasMercado && AtlasMercado.ler) {
        var m = AtlasMercado.ler();
        if (m && m.preco) { estado.preco = m.preco; return; }
      }
    } catch (e) {}
    var b = document.getElementById('vx-preco');
    var t = b ? parseFloat((b.textContent || '').replace(/[^\d.]/g, '')) : 0;
    if (t) estado.preco = t;
  }

  function var24(inst) {
    fetch('https://www.okx.com/api/v5/market/ticker?instId=' + parOkx(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.data || !j.data[0]) return;
        var d = j.data[0];
        var ult = +d.last, ab = +d.open24h;
        if (ab > 0) estado.var24 = ((ult - ab) / ab) * 100;
        if (!estado.preco) estado.preco = ult;
        pintarKpis();
      }).catch(function () {});
  }

  function lerPosicao() {
    fetch('observador/historico/posicoes.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) {
        if (!p || !p.ordens || !p.ordens.length) { estado.pos = null; pintarKpis(); return; }
        var somaE = 0, somaS = 0;
        p.ordens.forEach(function (o) { somaE += +o.entrada || 0; somaS += +o.stop || 0; });
        estado.pos = { lado: 'compra', lotes: p.ordens.length, media: somaE / p.ordens.length, stop: somaS / p.ordens.length, alvo: +p.alvo || null };
        pintarKpis();
      }).catch(function () { pintarKpis(); });
  }

  function relogio() {
    var precoEl = document.getElementById('vx-preco');
    if (precoEl && estado.preco) precoEl.textContent = n(estado.preco, 2);
    var varEl = document.getElementById('vx-var');
    if (varEl) {
      if (estado.var24 == null) { varEl.textContent = '--'; varEl.className = ''; }
      else {
        varEl.textContent = (estado.var24 >= 0 ? '+' : '') + num(estado.var24) + '% 24h';
        varEl.className = estado.var24 >= 0 ? 'up' : 'dn';
      }
    }
    var lt = document.getElementById('vx-live-txt');
    if (lt) {
      var m = null;
      try { m = window.AtlasMercado ? AtlasMercado.ler() : null; } catch (e) {}
      lt.textContent = m && m.idade != null ? 'ao vivo · ' + Math.round(m.idade) + 'ms' : 'ao vivo';
    }
    try { document.title = 'Atlas Vectra · ' + instrumento().replace('USDT', '/USDT') + ' · ' + (document.getElementById('tf-select') ? document.getElementById('tf-select').value : '15m'); } catch (e) {}
  }

  /* ─────────── arranque ─────────── */
  function iniciar() {
    montarCabecalho();
    montarColuna();
    arrumarNavegacao();
    montarHud();
    adotarFlutuantes();
    /* em tela estreita a coluna nasce recolhida e o gráfico ganha a área */
    if (window.innerWidth < 1280) {
      var w = document.getElementById('vx-work'), f = document.getElementById('vx-work-fold');
      if (w) { w.classList.add('vx-fechada'); if (f) f.textContent = '⟨'; }
    }
    lerPreco(); pintarKpis(); relogio();
    var24(instrumento());
    lerPosicao();
    cicloDominancia();
    renderLeituras();

    setInterval(function () { lerPreco(); pintarKpis(); relogio(); }, 1000);
    setInterval(function () { adotarCartoes(); adotarFlutuantes(); arrumarNavegacao(); }, 4000);
    setInterval(cicloDominancia, 60000);
    setInterval(function () { var24(instrumento()); }, 120000);
    setInterval(lerPosicao, 120000);
  }

  if (document.readyState !== 'loading') setTimeout(iniciar, 900);
  else document.addEventListener('DOMContentLoaded', function () { setTimeout(iniciar, 900); });
})();
