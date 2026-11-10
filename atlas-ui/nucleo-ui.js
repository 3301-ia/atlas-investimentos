// Painel NUCLEO & PINE do Atlas.
//
// Mostra, dentro do proprio painel, o codigo Pine original de cada indicador e
// o nucleo puro em JavaScript que roda no grafico, com o hash SHA-256 de cada
// arquivo calculado no navegador a partir do texto servido. O manifesto em
// pine/index.json guarda o hash de referencia: se o hash calculado nao bater
// com o do manifesto, o arquivo mudou depois de assinado.
//
// Nada aqui calcula indicador. E leitura, conferencia e copia.

(function () {
  'use strict';

  var MANIFESTO = './pine/index.json';
  var abas = [
    { id: 'pine', nome: 'PINE' },
    { id: 'nucleo', nome: 'NUCLEO' },
    { id: 'trailing', nome: 'TRAILING' }
  ];
  var manifesto = null;
  var abaAtual = 'pine';
  var itemAtual = null;
  var hashes = {};
  var painel = null;
  var assinatura = null;
  var timerTrailing = null;

  function el(tag, css, html) {
    var d = document.createElement(tag);
    if (css) d.style.cssText = css;
    if (html != null) d.innerHTML = html;
    return d;
  }

  function obterAssinatura() {
    if (assinatura) return Promise.resolve(assinatura);
    if (window.AtlasSignature) { assinatura = window.AtlasSignature; return Promise.resolve(assinatura); }
    return import('./core/signature.js').then(function (m) {
      assinatura = m;
      window.AtlasSignature = m;
      return m;
    }).catch(function () { return null; });
  }

  function curto(h) { return h ? h.slice(0, 12) : '--------'; }

  function carregarManifesto() {
    if (manifesto) return Promise.resolve(manifesto);
    return fetch(MANIFESTO, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('manifesto ' + r.status); return r.json(); })
      .then(function (m) { manifesto = m; return m; })
      .catch(function (e) { console.warn('[nucleo]', e.message); return null; });
  }

  function buscarTexto(arquivo) {
    return fetch(arquivo, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(arquivo + ' ' + r.status);
      return r.text();
    });
  }

  function hashArquivo(item) {
    if (hashes[item.arquivo]) return Promise.resolve(hashes[item.arquivo]);
    return Promise.all([buscarTexto(item.arquivo), obterAssinatura()]).then(function (par) {
      var texto = par[0], sign = par[1];
      if (!sign || !sign.sha256hex) return null;
      return sign.sha256hex(texto).then(function (h) {
        hashes[item.arquivo] = h;
        return h;
      });
    }).catch(function () { return null; });
  }

  function marcaHash(calculado, referencia) {
    if (!calculado) return '<span style="color:#8a97a8">hash indisponivel</span>';
    if (!referencia) return '<span style="color:#cfe9f7">' + curto(calculado) + '</span>';
    var igual = calculado === referencia;
    return '<span style="color:' + (igual ? '#3FBF8F' : '#E2685F') + '">' +
      (igual ? '&#10003; ' : '&#10007; ') + curto(calculado) + '</span>';
  }

  function estiloBase() {
    return {
      painel: 'position:fixed;inset:0;z-index:10050;background:rgba(4,8,14,.94);backdrop-filter:blur(3px);' +
        'display:flex;flex-direction:column;font:13px/1.5 ui-monospace,Consolas,monospace;color:#cfe9f7',
      topo: 'display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(217,180,91,.35);' +
        'background:linear-gradient(180deg,rgba(15,26,42,.95),rgba(8,14,22,.95))',
      corpo: 'flex:1;display:flex;min-height:0;flex-wrap:wrap',
      lista: 'width:300px;max-width:100%;min-width:0;overflow:auto;border-right:1px solid rgba(217,180,91,.2);padding:8px',
      detalhe: 'flex:1;min-width:0;display:flex;flex-direction:column;padding:10px 12px',
      codigo: 'flex:1;min-height:120px;overflow:auto;margin:0;padding:12px;background:#060b12;' +
        'border:1px solid rgba(217,180,91,.22);border-radius:6px;white-space:pre;font-size:12px;' +
        'line-height:1.5;color:#b8d4e6;tab-size:2'
    };
  }

  function botao(rotulo, extra) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = rotulo;
    b.style.cssText = 'min-height:40px;min-width:40px;padding:0 12px;background:transparent;cursor:pointer;' +
      'border:1px solid rgba(217,180,91,.45);border-radius:6px;color:#D9B45B;' +
      'font:600 11px ui-monospace,Consolas,monospace;letter-spacing:.06em' + (extra || '');
    return b;
  }

  function montar() {
    if (painel) return painel;
    var S = estiloBase();
    painel = el('div', S.painel);
    painel.id = 'nucleo-painel';

    var topo = el('div', S.topo);
    topo.appendChild(el('span', 'color:#D9B45B;font-weight:700;letter-spacing:.12em', 'NUCLEO &amp; PINE'));
    var sp = el('span', 'flex:1');
    topo.appendChild(sp);

    abas.forEach(function (a) {
      var b = botao(a.nome);
      b.dataset.aba = a.id;
      b.addEventListener('click', function () { trocarAba(a.id); });
      topo.appendChild(b);
    });
    var fechar = botao('FECHAR');
    fechar.addEventListener('click', function () { painel.style.display = 'none'; });
    topo.appendChild(fechar);
    painel.appendChild(topo);

    var corpo = el('div', S.corpo);
    corpo.id = 'nucleo-corpo';
    painel.appendChild(corpo);

    document.body.appendChild(painel);
    return painel;
  }

  function pintarAbas() {
    if (!painel) return;
    Array.prototype.forEach.call(painel.querySelectorAll('[data-aba]'), function (b) {
      var on = b.dataset.aba === abaAtual;
      b.style.background = on ? 'rgba(217,180,91,.16)' : 'transparent';
      b.style.color = on ? '#ffe9b0' : '#D9B45B';
    });
  }

  function trocarAba(id) {
    abaAtual = id;
    pintarAbas();
    if (id === 'trailing') return desenharTrailing();
    desenharLista();
  }

  function itens() {
    if (!manifesto) return [];
    return abaAtual === 'pine' ? (manifesto.indicadores || []) : (manifesto.nucleo || []);
  }

  function desenharLista() {
    var S = estiloBase();
    var corpo = painel.querySelector('#nucleo-corpo');
    corpo.innerHTML = '';

    var lista = el('div', S.lista);
    lista.id = 'nucleo-lista';
    var det = el('div', S.detalhe);
    det.id = 'nucleo-detalhe';
    corpo.appendChild(lista);
    corpo.appendChild(det);

    if (!manifesto) {
      lista.innerHTML = '<div style="color:#E2685F;padding:8px">manifesto nao carregou</div>';
      return;
    }

    itens().forEach(function (item) {
      var linha = el('div', 'min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:8px;' +
        'padding:8px;border:1px solid rgba(255,255,255,.06);border-radius:6px;margin-bottom:6px;cursor:pointer');
      linha.dataset.item = item.id;
      linha.innerHTML = '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        item.nome + '</span><span style="color:#8a97a8;font-size:11px">' + curto(item.sha256) + '</span>';
      linha.addEventListener('click', function () { abrirItem(item, det, lista); });
      lista.appendChild(linha);
    });

    if (itens().length) abrirItem(itens()[0], det, lista);
    else det.innerHTML = '<div style="color:#8a97a8">nada nesta aba</div>';
  }

  function abrirItem(item, det, lista) {
    itemAtual = item;
    if (lista) {
      Array.prototype.forEach.call(lista.children, function (c) {
        var on = c.dataset.item === item.id;
        c.style.borderColor = on ? 'rgba(217,180,91,.55)' : 'rgba(255,255,255,.06)';
        c.style.background = on ? 'rgba(217,180,91,.08)' : 'transparent';
      });
    }
    var S = estiloBase();
    det.innerHTML = '';

    var cab = el('div', 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px');
    cab.innerHTML = '<span style="color:#ffe9b0;font-weight:700">' + item.nome + '</span>' +
      '<span style="color:#8a97a8;font-size:11px">' + item.arquivo + ' &middot; ' + item.linhas + ' linhas</span>' +
      '<span id="nucleo-hash" style="font-size:11px">hash: &hellip;</span>';
    var copiar = botao('COPIAR');
    copiar.addEventListener('click', function () {
      var txt = det.querySelector('pre');
      if (!txt) return;
      var acao = navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(txt.textContent)
        : Promise.reject();
      acao.then(function () {
        copiar.textContent = 'COPIADO';
        setTimeout(function () { copiar.textContent = 'COPIAR'; }, 1400);
      }).catch(function () {
        try {
          var r = document.createRange();
          r.selectNodeContents(txt);
          var s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
        } catch (e) {}
      });
    });
    cab.appendChild(copiar);
    det.appendChild(cab);

    if (item.descricao) {
      det.appendChild(el('div', 'color:#9fb3c6;font-size:12px;margin-bottom:8px', item.descricao));
    }

    var pre = el('pre', S.codigo, 'carregando...');
    det.appendChild(pre);

    Promise.all([buscarTexto(item.arquivo), hashArquivo(item)]).then(function (par) {
      var texto = par[0], h = par[1];
      pre.textContent = texto;
      var alvo = det.querySelector('#nucleo-hash');
      if (alvo) alvo.innerHTML = 'hash: ' + marcaHash(h, item.sha256);
    }).catch(function (e) {
      pre.textContent = 'nao carregou ' + item.arquivo + ' (' + e.message + ')';
    });
  }

  function desenharTrailing() {
    var S = estiloBase();
    var corpo = painel.querySelector('#nucleo-corpo');
    corpo.innerHTML = '';

    var col = el('div', 'flex:1;min-width:0;display:flex;flex-direction:column;padding:10px 12px');
    corpo.appendChild(col);

    var cartao = el('div', 'border:1px solid rgba(217,180,91,.3);border-radius:8px;padding:12px;' +
      'background:linear-gradient(180deg,rgba(15,26,42,.7),rgba(8,14,22,.7));margin-bottom:10px');
    cartao.id = 'nucleo-trailing-estado';
    cartao.innerHTML = 'lendo o motor de trailing...';
    col.appendChild(cartao);

    var pre = el('pre', S.codigo, 'carregando pine do trailing...');
    col.appendChild(pre);

    desenharEstadoTrailing();

    if (!timerTrailing) {
      timerTrailing = setInterval(function () {
        if (abaAtual === 'trailing' && painel && painel.style.display !== 'none') desenharEstadoTrailing();
      }, 2000);
    }

    var item = (manifesto && (manifesto.indicadores || []).filter(function (i) {
      return i.id === 'vectra_dynamic_stepped_trailing';
    })[0]) || null;
    if (!item) { pre.textContent = 'pine do trailing nao esta no manifesto'; return; }
    Promise.all([buscarTexto(item.arquivo), hashArquivo(item)]).then(function (par) {
      pre.textContent = par[0];
    }).catch(function (e) {
      pre.textContent = 'nao carregou ' + item.arquivo + ' (' + e.message + ')';
    });
  }

  function desenharEstadoTrailing() {
    var caixa = painel && painel.querySelector('#nucleo-trailing-estado');
    if (!caixa) return;
    var est = null;
    try {
      if (window.AtlasTrailing && typeof window.AtlasTrailing.estado === 'function') est = window.AtlasTrailing.estado();
    } catch (e) {}
    var params = (window.AtlasTrailingCore && window.AtlasTrailingCore.TRAILING_PARAMS) || { atr: 14, mult: 2.5, janela: 22 };
    var versao = (window.AtlasTrailingCore && window.AtlasTrailingCore.TRAILING_VERSION) || '--';

    if (!est) {
      caixa.innerHTML = '<div style="color:#8a97a8">motor de trailing ainda sem leitura de candle. ' +
        'Parametros: ATR ' + params.atr + ', multiplicador ' + params.mult + ', janela ' + params.janela + '.</div>';
      return;
    }
    var cor = est.lado === 'alta' ? '#3FBF8F' : '#E2685F';
    caixa.innerHTML =
      '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:baseline">' +
        '<div><div style="color:#8a97a8;font-size:11px">LADO</div>' +
          '<div style="color:' + cor + ';font-size:20px;font-weight:700">' + (est.lado === 'alta' ? 'ALTA' : 'BAIXA') + '</div></div>' +
        '<div><div style="color:#8a97a8;font-size:11px">STOP</div>' +
          '<div style="color:#ffe9b0;font-size:20px;font-weight:700">' + Number(est.stop).toFixed(2) + '</div></div>' +
        '<div><div style="color:#8a97a8;font-size:11px">PRECO</div>' +
          '<div style="font-size:20px">' + Number(est.preco).toFixed(2) + '</div></div>' +
        '<div><div style="color:#8a97a8;font-size:11px">DISTANCIA</div>' +
          '<div style="font-size:20px">' + Number(est.distancia).toFixed(2) + ' <span style="font-size:12px;color:#8a97a8">(' +
          est.distanciaPercentual + '%)</span></div></div>' +
      '</div>' +
      '<div style="margin-top:8px;color:#8a97a8;font-size:11px">versao ' + versao + ' &middot; ATR ' + params.atr +
      ' &middot; multiplicador ' + params.mult + ' &middot; janela ' + params.janela +
      ' &middot; viradas ' + est.viradas + '</div>';
  }

  function adicionarNav() {
    if (document.getElementById('nav-nucleo')) return;
    var pai = document.querySelector('.nav-item');
    if (!pai || !pai.parentNode) return;
    var item = el('div', '');
    item.className = 'nav-item';
    item.id = 'nav-nucleo';
    item.title = 'Nucleo puro e codigo Pine dos indicadores, com assinatura';
    item.innerHTML = '<span class="nav-icon">&#129516;</span><span class="nav-lbl">Codigo</span>';
    item.addEventListener('click', function () { abrir(); });
    pai.parentNode.insertBefore(item, pai.parentNode.children[1] || null);
  }

  function abrir() {
    montar();
    painel.style.display = 'flex';
    pintarAbas();
    carregarManifesto().then(function () {
      if (abaAtual === 'trailing') desenharTrailing();
      else desenharLista();
    });
  }

  window.AtlasNucleo = {
    abrir: abrir,
    fechar: function () { if (painel) painel.style.display = 'none'; },
    aba: trocarAba,
    manifesto: function () { return manifesto; },
    hash: function (arquivo) { return hashes[arquivo] || null; }
  };

  function iniciar() {
    adicionarNav();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
