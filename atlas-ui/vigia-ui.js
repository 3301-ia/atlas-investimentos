// Vigia de posicao do Atlas: um cartao que acompanha a posicao aberta.
//
// Voce digita lado, entrada, lote, stop e alvo uma vez. O cartao le o preco do
// grafico e mostra, a cada segundo, lucro em dolar, quantos R andou, distancia
// ate o stop e ate o alvo. Quando o preco chega perto do stop, encosta no alvo
// ou quando a posicao esta sem stop, ele avisa com som e vibracao.
//
// A conta mora em core/vigia.js. Aqui e so tela, leitura e aviso.

(function () {
  'use strict';

  var CHAVE = 'atlas.vigia.v1';
  var card = null;
  var campos = {};
  var abaCorpo = null;
  var core = null;
  var ultimaAvaliacao = null;
  var ultimoEstado = null;
  var timer = null;

  // aceita 73917.30, 73.917,30 e 73,917.30 sem adivinhar errado
  function parseNumero(txt) {
    var s = String(txt == null ? '' : txt).replace(/[^0-9.,-]/g, '');
    var iDot = s.lastIndexOf('.');
    var iCom = s.lastIndexOf(',');
    if (iDot >= 0 && iCom >= 0) {
      s = iCom > iDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (iCom >= 0) {
      s = s.replace(',', '.');
    }
    var x = Number(s);
    return isFinite(x) && s !== '' ? x : null;
  }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    return parseNumero(v);
  }
  function usd(v) { return num(v) == null ? '--' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function obterCore() {
    if (core) return Promise.resolve(core);
    if (window.AtlasVigiaCore) { core = window.AtlasVigiaCore; return Promise.resolve(core); }
    return import('./core/vigia.js').then(function (m) {
      core = m; window.AtlasVigiaCore = m; return m;
    }).catch(function () { return null; });
  }

  function precoAtual() {
    try {
      var el = document.getElementById('rt-price');
      if (el) {
        var n = parseNumero(el.textContent);
        if (n && n > 0) return n;
      }
    } catch (e) {}
    try {
      if (typeof candleSeries !== 'undefined' && candleSeries && typeof candleSeries.data === 'function') {
        var d = candleSeries.data();
        if (d && d.length) {
          var u = d[d.length - 1];
          var c = num(u.close != null ? u.close : u.value);
          if (c && c > 0) return c;
        }
      }
    } catch (e) {}
    try {
      var v = window.__velas;
      if (Array.isArray(v) && v.length) { var k = num(v[v.length - 1].c); if (k && k > 0) return k; }
    } catch (e) {}
    try { if (typeof ultimoPreco !== 'undefined' && num(ultimoPreco) > 0) return Number(ultimoPreco); } catch (e) {}
    return null;
  }

  function lerPosicao() {
    return {
      lado: campos.lado && campos.lado.value === 'venda' ? 'venda' : 'compra',
      entrada: num(campos.entrada && campos.entrada.value),
      lote: num(campos.lote && campos.lote.value),
      stop: num(campos.stop && campos.stop.value),
      alvo: num(campos.alvo && campos.alvo.value)
    };
  }

  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(lerPosicao())); } catch (e) {}
    avaliar(true);
  }

  function carregar() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (e) { p = null; }
    if (!p) p = { lado: 'compra', entrada: '', lote: 0.01, stop: '', alvo: '' };
    Object.keys(campos).forEach(function (k) {
      if (campos[k] && p[k] != null && p[k] !== '') campos[k].value = p[k];
    });
  }

  function beep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = beep.ctx || (beep.ctx = new AC());
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.value = 0.05;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.16);
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate([60, 40, 60]); } catch (e) {}
  }

  function avisar(txt) {
    if (!txt) return;
    beep();
    try { if (typeof showInfoToast === 'function') showInfoToast('VIGIA', txt); } catch (e) {}
    var alvo = card && card.querySelector('#vg-aviso');
    if (alvo) { alvo.textContent = txt; alvo.style.display = 'block'; }
  }

  function avaliar(forcar) {
    if (!core || !card) return;
    var pos = lerPosicao();
    var preco = precoAtual();
    var saida = card.querySelector('#vg-saida');
    if (!saida) return;

    if (!pos.entrada || !pos.lote || !preco) {
      saida.innerHTML = '<div style="color:#8a97a8">informe entrada e lote para o vigia come\u00e7ar</div>';
      ultimaAvaliacao = null;
      return;
    }

    var a = core.avaliarPosicao(pos, preco);
    if (!a) {
      saida.innerHTML = '<div style="color:#E2685F">dados da posi\u00e7\u00e3o inv\u00e1lidos</div>';
      return;
    }
    ultimaAvaliacao = a;

    var corLucro = a.lucroUSD >= 0 ? '#3FBF8F' : '#E2685F';
    saida.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">' +
        '<span style="color:#8a97a8;font-size:11px">' + (a.lado === 'compra' ? 'COMPRA' : 'VENDA') +
        ' ' + a.lote + ' @ ' + usd(a.entrada) + '</span>' +
        '<span style="color:#cfe9f7;font-size:11px">pre\u00e7o ' + usd(a.preco) + '</span>' +
      '</div>' +
      '<div style="font-size:24px;font-weight:700;color:' + corLucro + '">' + (a.lucroUSD >= 0 ? '+' : '') +
        usd(a.lucroUSD) + ' <span style="font-size:12px;color:#8a97a8">USD</span></div>' +
      '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;font-size:12px">' +
        '<span>' + (a.r == null ? 'R --' : a.r.toFixed(2) + 'R') + '</span>' +
        '<span style="color:#8a97a8">stop ' + (a.distanciaStop == null ? '--' : usd(a.distanciaStop)) + '</span>' +
        '<span style="color:#8a97a8">alvo ' + (a.distanciaAlvo == null ? '--' : usd(a.distanciaAlvo)) + '</span>' +
        '<span style="color:#8a97a8">R:R ' + (a.riscoRetorno == null ? '--' : a.riscoRetorno.toFixed(2)) + '</span>' +
      '</div>';

    var faixa = card.querySelector('#vg-estado');
    if (faixa) {
      var mapas = {
        sem_stop: ['#E2685F', 'SEM STOP'],
        stop_atingido: ['#E2685F', 'STOP BATIDO'],
        alvo_atingido: ['#3FBF8F', 'ALVO BATIDO'],
        stop_travado_perto: ['#D9B45B', 'STOP NO LUCRO PERTO'],
        stop_proximo: ['#E2685F', 'PERTO DO STOP'],
        alvo_proximo: ['#3FBF8F', 'PERTO DO ALVO'],
        normal: ['#8a97a8', 'POSI\u00c7\u00c3O VIVA']
      };
      var m = mapas[a.estado] || mapas.normal;
      faixa.textContent = m[1];
      faixa.style.color = m[0];
      faixa.style.borderColor = m[0];
    }

    if (a.estado !== ultimoEstado) {
      ultimoEstado = a.estado;
      if (a.alertar || forcar) avisar(core.fraseEstado(a));
    }
  }

  function sugerirStop() {
    var est = null;
    try { if (window.AtlasTrailing && window.AtlasTrailing.estado) est = window.AtlasTrailing.estado(); } catch (e) {}
    if (!est || !est.stop) return;
    if (campos.stop) {
      campos.stop.value = Number(est.stop).toFixed(2);
      salvar();
    }
  }

  function montar() {
    if (card) return card;
    card = document.createElement('div');
    card.id = 'vg-card';
    card.style.cssText = 'position:fixed;left:8px;bottom:64px;z-index:9997;width:340px;max-width:calc(100vw - 16px);' +
      'background:rgba(8,14,22,.95);border:1px solid rgba(217,180,91,.45);border-radius:8px;' +
      'font:12px/1.45 ui-monospace,Consolas,monospace;color:#cfe9f7;box-shadow:0 8px 24px rgba(0,0,0,.45);display:none';

    var cab = document.createElement('div');
    cab.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(217,180,91,.25)';
    cab.innerHTML = '<b style="color:#D9B45B;letter-spacing:.1em">VIGIA</b>' +
      '<span id="vg-estado" style="margin-left:auto;font-size:10px;padding:2px 6px;border:1px solid #8a97a8;border-radius:4px">--</span>';
    var fechar = document.createElement('button');
    fechar.type = 'button'; fechar.textContent = '\u2212';
    fechar.style.cssText = 'min-width:40px;min-height:40px;background:transparent;border:none;color:#8a97a8;font-size:16px;cursor:pointer';
    fechar.addEventListener('click', function () {
      var c = card.querySelector('#vg-corpo');
      var oculto = c.style.display === 'none';
      c.style.display = oculto ? 'block' : 'none';
      fechar.textContent = oculto ? '\u2212' : '+';
    });
    cab.appendChild(fechar);
    card.appendChild(cab);

    var corpo = document.createElement('div');
    corpo.id = 'vg-corpo';
    corpo.style.cssText = 'padding:10px';
    card.appendChild(corpo);

    var linha1 = document.createElement('div');
    linha1.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px';
    corpo.appendChild(linha1);

    campos.lado = document.createElement('select');
    campos.lado.style.cssText = estCampo() + 'flex:1;min-width:120px';
    ['compra', 'venda'].forEach(function (v) {
      var o = document.createElement('option'); o.value = v; o.textContent = v.toUpperCase(); campos.lado.appendChild(o);
    });
    linha1.appendChild(rotulado('LADO', campos.lado));

    [['entrada', 'ENTRADA'], ['lote', 'LOTE'], ['stop', 'STOP'], ['alvo', 'ALVO']].forEach(function (par) {
      var i = document.createElement('input');
      i.type = 'text';
      i.inputMode = 'decimal';
      i.placeholder = par[1] === 'LOTE' ? '0.01' : '--';
      i.style.cssText = estCampo() + 'flex:1;min-width:88px';
      i.addEventListener('change', salvar);
      campos[par[0]] = i;
      linha1.appendChild(rotulado(par[1], i));
    });

    var linha2 = document.createElement('div');
    linha2.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap';
    corpo.appendChild(linha2);
    linha2.appendChild(acao('SALVAR', salvar));
    linha2.appendChild(acao('USAR STOP DO TS', sugerirStop));
    linha2.appendChild(acao('LIMPAR', function () {
      try { localStorage.removeItem(CHAVE); } catch (e) {}
      Object.keys(campos).forEach(function (k) { if (campos[k] && k !== 'lado') campos[k].value = ''; });
      campos.lado.value = 'compra';
      ultimoEstado = null;
      avaliar(true);
    }));

    var aviso = document.createElement('div');
    aviso.id = 'vg-aviso';
    aviso.style.cssText = 'display:none;margin-bottom:10px;padding:8px;border-radius:6px;' +
      'background:rgba(217,180,91,.12);border:1px solid rgba(217,180,91,.4);color:#ffe9b0;font-size:11px';
    corpo.appendChild(aviso);

    var saida = document.createElement('div');
    saida.id = 'vg-saida';
    corpo.appendChild(saida);

    document.body.appendChild(card);
    carregar();
    return card;
  }

  function estCampo() {
    return 'min-height:40px;padding:0 8px;background:#0c1522;border:1px solid rgba(217,180,91,.3);' +
      'border-radius:5px;color:#e6f1f8;font:16px ui-monospace,Consolas,monospace;box-sizing:border-box';
  }

  function rotulado(txt, campo) {
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:88px';
    var l = document.createElement('span');
    l.textContent = txt;
    l.style.cssText = 'font-size:9px;letter-spacing:.1em;color:#8a97a8';
    d.appendChild(l);
    d.appendChild(campo);
    return d;
  }

  function acao(txt, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = txt;
    b.style.cssText = 'min-height:40px;padding:0 12px;background:transparent;border:1px solid rgba(217,180,91,.45);' +
      'border-radius:6px;color:#D9B45B;font:600 11px ui-monospace,Consolas,monospace;letter-spacing:.05em;cursor:pointer';
    b.addEventListener('click', fn);
    return b;
  }

  function abrir() {
    montar();
    card.style.display = 'block';
    obterCore().then(function () {
      avaliar(true);
      if (!timer) timer = setInterval(function () { avaliar(false); }, 1000);
    });
  }

  function fechar() { if (card) card.style.display = 'none'; }

  function alternar() {
    if (card && card.style.display === 'block') fechar(); else abrir();
  }

  function adicionarNav() {
    if (document.getElementById('nav-vigia')) return;
    var pai = document.querySelector('.nav-item');
    if (!pai || !pai.parentNode) return;
    var item = document.createElement('div');
    item.className = 'nav-item';
    item.id = 'nav-vigia';
    item.title = 'Vigia de posicao: lucro, stop, alvo e aviso de aproximacao';
    item.innerHTML = '<span class="nav-icon">\ud83d\udee1</span><span class="nav-lbl">Vigia</span>';
    item.addEventListener('click', alternar);
    pai.parentNode.insertBefore(item, pai.parentNode.children[2] || null);
  }

  window.AtlasVigia = {
    abrir: abrir,
    fechar: fechar,
    avaliar: function () { avaliar(true); },
    ultima: function () { return ultimaAvaliacao; },
    preco: precoAtual
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', adicionarNav);
  else adicionarNav();
})();
