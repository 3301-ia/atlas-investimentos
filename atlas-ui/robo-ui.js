// Robô em papel dentro do Atlas UI.
//
// Le as ordens gravadas pelo roboPaper no servidor e avisa quando nasce ordem
// nova ou quando uma fecha. O alerta e o mesmo do resto do painel: som curto,
// vibracao no celular e aviso na tela.

(function () {
  var CFG = {
    url: 'https://romerito-agente-9f88b64a.base44.app/functions/roboLer',
    token: 'robo-atlas-2026',
    ativo: 'BTC-USDT',
    intervalo: 60000
  };
  var CHAVE = 'atlas.robo.v1';

  var ultimo = { id: null, fechadas: 0, aberto: false };
  var dados = null;
  var card = null, corpo = null, chip = null;
  var aberto = false;
  var cores = { ok: '#2E9E5B', ruim: '#E2685F', ouro: '#D9B45B', texto: '#e8eef7', fraco: '#8a97a8' };

  function num(v) {
    var x = Number(String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    return isFinite(x) ? x : null;
  }

  function precoAtual() {
    try {
      if (typeof candleSeries !== 'undefined' && candleSeries && candleSeries.data) {
        var d = candleSeries.data();
        if (d && d.length) return d[d.length - 1].close;
      }
    } catch (e) {}
    try {
      var el = document.getElementById('big-price') || document.getElementById('rt-price');
      if (el) { var n = num(el.textContent); if (n) return n; }
    } catch (e) {}
    return null;
  }

  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 780; g.gain.value = 0.05;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      setTimeout(function () { try { o.stop(); ctx.close(); } catch (e) {} }, 160);
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate([90, 60, 90]); } catch (e) {}
  }

  function aviso(texto) {
    beep();
    if (typeof window.showInfoToast === 'function') { try { window.showInfoToast(texto); } catch (e) {} }
    var t = document.createElement('div');
    t.textContent = texto;
    t.style.cssText = 'position:fixed;right:10px;top:10px;z-index:9999;background:#0b1a2b;color:#e8eef7;' +
      'border:1px solid ' + cores.ouro + ';border-radius:8px;padding:10px 12px;font-size:13px;max-width:300px';
    document.body.appendChild(t);
    setTimeout(function () { try { document.body.removeChild(t); } catch (e) {} }, 9000);
  }

  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify({ id: ultimo.id, fechadas: ultimo.fechadas })); } catch (e) {}
  }
  function carregar() {
    try {
      var d = JSON.parse(localStorage.getItem(CHAVE) || '{}');
      if (d && d.id) ultimo.id = d.id;
      if (d && typeof d.fechadas === 'number') ultimo.fechadas = d.fechadas;
    } catch (e) {}
  }

  function buscar() {
    return fetch(CFG.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: CFG.token, ativo: CFG.ativo, limite: 10 })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) return null;
      return j;
    }).catch(function () { return null; });
  }

  function conferir(j) {
    if (!j) return;
    var a = j.aberta;
    var fechadas = (j.fechadas || []).length;

    if (a && a.id !== ultimo.id) {
      aviso('Robô abriu ' + (a.lado === 'venda' ? 'VENDA' : 'COMPRA') + ' em ' + fmt(a.entrada) +
        ' | stop ' + fmt(a.stop) + ' | alvo ' + fmt(a.alvo));
    }
    if (!a && ultimo.aberto && !a) { /* fechou */ }
    if (fechadas > ultimo.fechadas && ultimo.fechadas >= 0 && j.fechadas && j.fechadas[0]) {
      var f = j.fechadas[0];
      aviso('Robô fechou ' + (f.lado === 'venda' ? 'VENDA' : 'COMPRA') + ' em ' + fmt(f.preco_saida) +
        ' | ' + (Number(f.resultado_r) >= 0 ? '+' : '') + f.resultado_r + 'R (' +
        (Number(f.resultado_usd) >= 0 ? '+' : '') + f.resultado_usd + ' USD)');
    }
    ultimo.id = a ? a.id : null;
    ultimo.aberto = !!a;
    ultimo.fechadas = fechadas;
    salvar();
  }

  function fmt(v) {
    var n = Number(v);
    return isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
  }

  function cartao(html) {
    var d = document.createElement('div');
    d.style.cssText = 'border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px;margin-bottom:8px;background:rgba(255,255,255,.02)';
    d.innerHTML = html;
    return d;
  }

  function desenhar() {
    if (!corpo) return;
    corpo.innerHTML = '';
    if (!dados) {
      corpo.appendChild(cartao('<div style="color:' + cores.fraco + '">sem resposta do servidor ainda</div>'));
      return;
    }
    var a = dados.aberta;
    var preco = precoAtual();
    if (!a) {
      corpo.appendChild(cartao('<div style="color:' + cores.fraco + '">Nenhuma ordem aberta agora. O robô roda a cada 15 minutos.</div>'));
    } else {
      var dist = Math.abs(Number(a.entrada) - Number(a.stop));
      var rAtual = preco && dist ? ((preco - a.entrada) * (a.lado === 'venda' ? -1 : 1)) / dist : null;
      var distStop = preco ? Math.abs(preco - Number(a.stop)) : null;
      var distAlvo = preco ? Math.abs(preco - Number(a.alvo)) : null;
      var corLado = a.lado === 'venda' ? cores.ruim : cores.ok;
      corpo.appendChild(cartao(
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
        '<b style="color:' + corLado + '">' + (a.lado === 'venda' ? 'VENDA' : 'COMPRA') + '</b>' +
        '<span style="color:' + cores.fraco + ';font-size:12px">' + a.timeframe + ' · papel</span></div>' +
        '<div style="font-family:monospace;font-size:13px;margin-top:6px;line-height:1.7">' +
        'entrada ' + fmt(a.entrada) + '<br>stop ' + fmt(a.stop) + ' (' + fmt(distStop) + ')<br>' +
        'alvo ' + fmt(a.alvo) + ' (' + fmt(distAlvo) + ')<br>' +
        'tamanho ' + a.tamanho + ' · risco ' + fmt(a.risco_usd) + ' USD</div>' +
        '<div style="margin-top:6px;font-weight:800;color:' + (rAtual >= 0 ? cores.ok : cores.ruim) + '">' +
        (rAtual == null ? 'R --' : (rAtual >= 0 ? '+' : '') + rAtual.toFixed(2) + 'R') + '</div>' +
        '<div style="margin-top:4px;font-size:11px;color:' + cores.fraco + ';word-break:break-all">hash ' + String(a.hash || '').slice(0, 16) + '…</div>'
      ));
    }
    var r = dados.resumo || {};
    corpo.appendChild(cartao(
      '<div style="color:' + cores.fraco + ';font-size:12px;margin-bottom:4px">temporada</div>' +
      '<div style="font-family:monospace;font-size:13px">fechadas ' + (r.fechadas || 0) +
      ' · acerto ' + (r.acerto_pct == null ? '--' : r.acerto_pct + '%') + '<br>' +
      'resultado ' + (r.resultado_r >= 0 ? '+' : '') + fmt(r.resultado_r) + 'R / ' +
      (r.resultado_usd >= 0 ? '+' : '') + fmt(r.resultado_usd) + ' USD</div>'
    ));
    if ((dados.fechadas || []).length) {
      var linhas = dados.fechadas.slice(0, 5).map(function (f) {
        var cor = Number(f.resultado_r) >= 0 ? cores.ok : cores.ruim;
        return '<div style="display:flex;justify-content:space-between;font-family:monospace;font-size:12px;padding:2px 0">' +
          '<span>' + (f.lado === 'venda' ? 'V' : 'C') + ' ' + fmt(f.entrada) + '</span>' +
          '<span style="color:' + cor + '">' + (Number(f.resultado_r) >= 0 ? '+' : '') + f.resultado_r + 'R</span></div>';
      }).join('');
      corpo.appendChild(cartao(linhas));
    }
    pintarChip(a);
  }

  function pintarChip(a) {
    if (!chip) return;
    if (!a) { chip.textContent = '🤖 sem ordem'; chip.style.color = cores.fraco; return; }
    chip.textContent = '🤖 ' + (a.lado === 'venda' ? 'V' : 'C') + ' ' + fmt(a.entrada);
    chip.style.color = a.lado === 'venda' ? cores.ruim : cores.ok;
  }

  function criarCard() {
    card = document.createElement('div');
    card.id = 'robo-card';
    card.style.cssText = 'position:fixed;right:8px;top:64px;z-index:9000;width:320px;max-width:calc(100vw - 16px);' +
      'background:#0b1a2b;border:1px solid ' + cores.ouro + ';border-radius:10px;color:' + cores.texto +
      ';font-family:system-ui,sans-serif;display:none;box-shadow:0 10px 30px rgba(0,0,0,.45)';
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)';
    head.innerHTML = '<b style="flex:1;font-size:13px;letter-spacing:.06em">ROBÔ · PAPEL</b>';
    var fechar = document.createElement('button');
    fechar.textContent = '×';
    fechar.style.cssText = 'min-width:40px;min-height:40px;background:transparent;color:' + cores.texto +
      ';border:1px solid rgba(255,255,255,.15);border-radius:6px;font-size:18px;cursor:pointer';
    fechar.addEventListener('click', function () { aberto = false; card.style.display = 'none'; });
    head.appendChild(fechar);
    card.appendChild(head);
    corpo = document.createElement('div');
    corpo.id = 'robo-corpo';
    corpo.style.cssText = 'padding:10px;max-height:60vh;overflow:auto';
    card.appendChild(corpo);
    document.body.appendChild(card);
  }

  function criarNav() {
    var nav = document.querySelector('.nav-item, .nav, .sidebar');
    var pai = nav && nav.parentNode ? nav.parentNode : document.body;
    var btn = document.createElement('div');
    btn.id = 'btn-robo';
    btn.style.cssText = 'display:flex;align-items:center;gap:8px;min-height:40px;padding:8px 10px;cursor:pointer;' +
      'border-radius:8px;color:' + cores.texto + ';font-size:13px';
    btn.innerHTML = '<span>🤖</span><span style="flex:1">Robô</span><span id="robo-chip" style="font-size:11px;color:' + cores.fraco + '">sem ordem</span>';
    btn.addEventListener('click', function () {
      aberto = !aberto;
      card.style.display = aberto ? 'block' : 'none';
      if (aberto) { buscar().then(function (j) { if (j) { dados = j; } desenhar(); }); }
    });
    if (nav && nav.parentNode) nav.parentNode.insertBefore(btn, nav.nextSibling);
    else document.body.insertBefore(btn, document.body.firstChild);
    chip = btn.querySelector('#robo-chip');
  }

  function ciclo() {
    buscar().then(function (j) {
      if (!j) return;
      dados = j;
      conferir(j);
      if (aberto) desenhar();
      else pintarChip(j.aberta);
    });
  }

  function iniciar() {
    carregar();
    criarCard();
    criarNav();
    ciclo();
    setInterval(ciclo, CFG.intervalo);
  }

  window.AtlasRobo = {
    estado: function () { return { aberto: aberto, ultimo: ultimo, dados: dados }; },
    abrir: function () { aberto = true; card.style.display = 'block'; return buscar().then(function (j) { if (j) dados = j; desenhar(); }); },
    fechar: function () { aberto = false; card.style.display = 'none'; },
    ciclo: ciclo,
    conferir: conferir
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
