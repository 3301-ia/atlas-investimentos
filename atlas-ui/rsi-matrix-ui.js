/* ── RSI Matrix: cartão com os ajustes na mão ─────────────────────────────
   Mesmas opções do indicador de referência (fonte, comprimento do RSI, EMA
   do RSI, sobrecompra, sobrevenda, painel, nível do RSI digitado, RSI de um
   preço digitado, decimais, fundo invisível), mas editável dentro do painel
   e salvo entre sessões. O que ele resolve: qual PREÇO corresponde a um RSI
   escolhido — vira linha de preço no gráfico, presa ao eixo.                */
(function () {
  if (window.AtlasRsiMatrix) return;

  var CHAVE = 'atlasRSIMatrixOpcoes';
  var card = null, aberto = false, ligado = false, ajustesAbertos = false;
  var ultimo = null, linhas = [], falhasSeguidas = 0;

  function lerOpcoes() {
    var op = {};
    try { op = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch (e) { op = {}; }
    return op;
  }
  function salvarOpcoes(op) {
    try { localStorage.setItem(CHAVE, JSON.stringify(op)); } catch (e) {}
  }
  var opcoes = lerOpcoes();

  function fmt(v, casas) {
    if (v == null || !isFinite(v)) return '--';
    return Number(v).toFixed(casas == null ? (opcoes.decimais != null ? opcoes.decimais : 2) : casas);
  }
  function velas() {
    try { return (typeof candles !== 'undefined' && Array.isArray(candles)) ? candles : []; } catch (e) { return []; }
  }
  function grafico() {
    try { if (typeof chart !== 'undefined' && chart && chart.addLineSeries) return chart; } catch (e) {}
    return null;
  }
  function seriePreco() {
    try { if (typeof candleSeries !== 'undefined' && candleSeries && candleSeries.createPriceLine) return candleSeries; } catch (e) {}
    return null;
  }

  /* ── cartão ────────────────────────────────────────────────────────── */
  function montar() {
    if (card) return card;
    card = document.createElement('div');
    card.id = 'rsi-matrix-card';
    card.style.display = 'none';
    card.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:0 12px;min-height:42px;border-bottom:1px solid rgba(255,255,255,.06)">' +
        '<b style="color:#D9B45B;letter-spacing:.14em;font-size:10.5px">RSI MATRIX</b>' +
        '<span id="rm-estado" style="margin-left:auto;font-size:10px;padding:2px 8px;border-radius:20px;border:1px solid rgba(217,180,91,.35);color:#CBDFEE">aguardando</span>' +
        '<button id="rm-ajustes" type="button" title="ajustes do indicador" style="min-height:28px;height:28px;padding:0 8px;font-size:10.5px">AJUSTES</button>' +
      '</div>' +
      '<div style="padding:10px 12px 4px">' +
        '<div style="display:flex;align-items:baseline;gap:8px">' +
          '<span id="rm-rsi" style="font:600 30px/1 ui-monospace,Consolas,monospace;color:#EAF4FB;letter-spacing:-.02em">--</span>' +
          '<span style="font-size:10px;letter-spacing:.1em;color:#7E97AB">RSI <span id="rm-len">14</span></span>' +
          '<span style="margin-left:auto;font-size:11px;color:#7E97AB">EMA <span id="rm-ema">--</span></span>' +
        '</div>' +
        '<div style="height:6px;border-radius:4px;background:rgba(255,255,255,.07);margin:8px 0 10px;position:relative;overflow:hidden">' +
          '<div id="rm-barra" style="position:absolute;left:0;top:0;bottom:0;width:0%;background:linear-gradient(90deg,#3FBF8F,#D9B45B)"></div>' +
          '<div id="rm-marca-ob" style="position:absolute;top:0;bottom:0;width:1px;background:rgba(226,104,95,.85)"></div>' +
          '<div id="rm-marca-os" style="position:absolute;top:0;bottom:0;width:1px;background:rgba(63,191,143,.85)"></div>' +
        '</div>' +
      '</div>' +
      '<div id="rm-niveis" style="padding:0 12px 10px"></div>' +
      '<div id="rm-ajustes-caixa" style="display:none;padding:0 12px 12px;border-top:1px solid rgba(255,255,255,.06)"></div>';
    document.body.appendChild(card);

    card.querySelector('#rm-ajustes').addEventListener('click', function () {
      ajustesAbertos = !ajustesAbertos;
      card.querySelector('#rm-ajustes-caixa').style.display = ajustesAbertos ? 'block' : 'none';
      if (ajustesAbertos) montarAjustes();
    });
    return card;
  }

  /* ── editor de ajustes (os mesmos campos do indicador de referência) ── */
  function montarAjustes() {
    var caixa = card.querySelector('#rm-ajustes-caixa');
    if (caixa.getAttribute('data-pronto')) { pintarAjustes(); return; }
    caixa.setAttribute('data-pronto', '1');
    caixa.innerHTML =
      campo('fonte', 'Fonte', 'select', ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'],
        ['Fechamento', 'Abertura', 'Máxima', 'Mínima', 'HL/2', 'HLC/3', 'OHLC/4']) +
      campo('rsiLen', 'Comprimento do RSI', 'number', null, null, '2', '200', '1') +
      campo('emaLen', 'Comprimento da EMA', 'number', null, null, '1', '200', '1') +
      campo('sobrecompra', 'Sobrecompra', 'number', null, null, '51', '99', '1') +
      campo('sobrevenda', 'Sobrevenda', 'number', null, null, '1', '49', '1') +
      caixaCheck('mostrarPainel', 'Mostrar painel de informações') +
      campo('deslocamento', 'Deslocamento do painel', 'number', null, null, '0', '400', '1') +
      caixaCheck('mostrarNivelRsiEntrada', 'Mostrar nível do RSI digitado') +
      campo('rsiEntrada', 'RSI digitado', 'number', null, null, '1', '99', '0.5') +
      caixaCheck('mostrarRsiDoPreco', 'Mostrar RSI de um preço digitado') +
      campo('precoEntrada', 'Preço digitado', 'number', null, null, '0', '100000000', 'any') +
      campo('decimais', 'Decimais', 'number', null, null, '0', '8', '1') +
      caixaCheck('fundoInvisivel', 'Fundo invisível') +
      '<div id="rm-do-preco" style="margin-top:6px;font-size:11px;color:#7E97AB"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button id="rm-restaurar" type="button" style="flex:1;min-height:36px;font-size:11px">PADRÕES</button>' +
        '<button id="rm-fechar" type="button" style="flex:1;min-height:36px;font-size:11px">FECHAR</button>' +
      '</div>';

    caixa.addEventListener('input', function (ev) {
      var campoEl = ev.target.closest('[data-campo]');
      if (!campoEl) return;
      var nome = campoEl.getAttribute('data-campo');
      var valor = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
      opcoes[nome] = valor;
      salvarOpcoes(opcoes);
      atualizar(true);
    });
    caixa.querySelector('#rm-restaurar').addEventListener('click', function () {
      opcoes = {}; salvarOpcoes(opcoes); pintarAjustes(); atualizar(true);
    });
    caixa.querySelector('#rm-fechar').addEventListener('click', function () {
      ajustesAbertos = false; caixa.style.display = 'none';
    });
    pintarAjustes();
  }

  function campo(nome, rotulo, tipo, opcoesLista, rotulosLista, min, max, passo) {
    if (tipo === 'select') {
      return '<label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:11.5px;color:#9FB4C6">' +
        '<span>' + rotulo + '</span>' +
        '<select data-campo="' + nome + '" id="rm-f-' + nome + '" style="margin-left:auto;min-height:32px;font-size:11.5px;background:#0E1D2C;color:#CBDFEE;border:1px solid rgba(217,180,91,.25);border-radius:7px;padding:0 8px">' +
        opcoesLista.map(function (v, i) { return '<option value="' + v + '">' + rotulosLista[i] + '</option>'; }).join('') +
        '</select></label>';
    }
    return '<label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:11.5px;color:#9FB4C6">' +
      '<span>' + rotulo + '</span>' +
      '<input data-campo="' + nome + '" id="rm-f-' + nome + '" type="number" min="' + min + '" max="' + max + '" step="' + passo + '"' +
      ' style="margin-left:auto;width:92px;min-height:32px;font-size:16px;text-align:right;background:#0E1D2C;color:#CBDFEE;border:1px solid rgba(217,180,91,.25);border-radius:7px;padding:0 8px">' +
      '</label>';
  }
  function caixaCheck(nome, rotulo) {
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:11.5px;color:#9FB4C6">' +
      '<input data-campo="' + nome + '" id="rm-f-' + nome + '" type="checkbox" style="width:18px;height:18px;accent-color:#D9B45B">' +
      '<span>' + rotulo + '</span></label>';
  }

  function pintarAjustes() {
    if (!card) return;
    var p = window.RSIMatrix ? window.RSIMatrix.opcoes(opcoes) : opcoes;
    ['rsiLen', 'emaLen', 'sobrecompra', 'sobrevenda', 'deslocamento', 'rsiEntrada', 'precoEntrada', 'decimais'].forEach(function (k) {
      var el = card.querySelector('#rm-f-' + k);
      if (el) el.value = p[k];
    });
    var sel = card.querySelector('#rm-f-fonte');
    if (sel) sel.value = p.fonte;
    ['mostrarPainel', 'mostrarNivelRsiEntrada', 'mostrarRsiDoPreco', 'fundoInvisivel'].forEach(function (k) {
      var el = card.querySelector('#rm-f-' + k);
      if (el) el.checked = !!p[k];
    });
  }

  /* ── desenho no gráfico: linhas de preço presas ao eixo ────────────── */
  function limparLinhas() {
    var serie = seriePreco();
    linhas.forEach(function (l) { try { serie.removePriceLine(l); } catch (e) {} });
    linhas = [];
  }

  function desenhar(r) {
    var serie = seriePreco();
    if (!serie) return;
    limparLinhas();
    if (!ligado || !r || !r.niveis) return;
    r.niveis.forEach(function (n) {
      if (!n.viavel || !n.preco) return;
      var cor = n.rsi >= 50 ? '#E2685F' : '#3FBF8F';
      if (Math.abs(n.rsi - (r.opcoes ? r.opcoes.rsiEntrada : 27)) < 0.001) cor = '#D9B45B';
      try {
        linhas.push(serie.createPriceLine({
          price: n.preco, color: cor, lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: n.rotulo
        }));
      } catch (e) {}
    });
  }

  /* ── leitura e pintura ─────────────────────────────────────────────── */
  function atualizar(imediato) {
    var vs = velas();
    var R = window.RSIMatrix;
    if (!R) return;
    var r = R.calcular(vs, opcoes);
    if (!r || !r.ok) {
      falhasSeguidas++;
      if (ultimo && falhasSeguidas < 12) { pintar(ultimo, true); return; } // nunca deixa o cartão morto
      if (card) {
        var e = card.querySelector('#rm-estado');
        if (e) { e.textContent = r && r.motivo === 'faltam velas' ? ('faltam ' + r.faltam + ' velas') : (r ? r.motivo : 'sem dados'); e.style.color = '#E2685F'; }
      }
      return;
    }
    falhasSeguidas = 0;
    ultimo = r;
    pintar(r, false);
    if (imediato) desenhar(r);
  }

  function pintar(r, antigo) {
    if (!card) return;
    var d = r.opcoes ? r.opcoes.decimais : 2;
    var el = function (id) { return card.querySelector('#' + id); };
    if (el('rm-rsi')) el('rm-rsi').textContent = r.rsi == null ? '--' : r.rsi.toFixed(d);
    if (el('rm-len')) el('rm-len').textContent = r.opcoes ? r.opcoes.rsiLen : 14;
    if (el('rm-ema')) el('rm-ema').textContent = fmt(r.emaRsi, d);
    if (el('rm-barra')) el('rm-barra').style.width = Math.max(0, Math.min(100, r.rsi || 0)) + '%';
    if (el('rm-marca-ob')) el('rm-marca-ob').style.left = (r.sobrecompra || 70) + '%';
    if (el('rm-marca-os')) el('rm-marca-os').style.left = (r.sobrevenda || 30) + '%';

    var estado = 'neutro', cor = '#CBDFEE';
    if (r.rsi >= r.sobrecompra) { estado = 'sobrecompra'; cor = '#E2685F'; }
    else if (r.rsi <= r.sobrevenda) { estado = 'sobrevenda'; cor = '#3FBF8F'; }
    if (r.cruzamento === 'subiu') estado += ' · EMA subiu';
    if (r.cruzamento === 'desceu') estado += ' · EMA desceu';
    var e = el('rm-estado');
    if (e) { e.textContent = antigo ? estado + ' (anterior)' : estado; e.style.color = cor; e.style.borderColor = cor + '55'; }

    var lista = el('rm-niveis');
    if (lista) {
      lista.innerHTML = r.niveis.map(function (n) {
        var valor = n.viavel ? fmt(n.preco, d) : '—';
        var nota = n.viavel
          ? (n.lado === 'alta' ? 'precisa subir ' : 'precisa cair ') + Math.abs(n.distanciaPct).toFixed(2) + '%'
          : (n.motivo || 'sem nível');
        var corN = n.viavel ? (n.lado === 'alta' ? '#3FBF8F' : '#E2685F') : '#7E97AB';
        if (String(n.rotulo).indexOf('RSI ') === 0 && n.rotulo.indexOf('Sobre') < 0) corN = '#D9B45B';
        return '<div style="display:flex;gap:8px;align-items:baseline;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">' +
          '<span style="font-size:10.5px;color:#7E97AB">' + n.rotulo + '</span>' +
          '<span style="margin-left:auto;font:500 12.5px ui-monospace,Consolas,monospace;color:' + corN + '">' + valor + '</span>' +
          '<span style="font-size:9.5px;color:#5F7285;min-width:96px;text-align:right">' + nota + '</span></div>';
      }).join('');
    }
    var dp = el('rm-do-preco');
    if (dp) {
      dp.textContent = r.rsiDoPreco && r.rsiDoPreco.viavel
        ? 'Se o preço for ' + fmt(r.rsiDoPreco.preco, d) + ', o RSI fica em ' + r.rsiDoPreco.rsi.toFixed(2)
        : '';
    }
    if (r.opcoes && r.opcoes.fundoInvisivel) card.style.background = 'transparent';
    else card.style.removeProperty('background');
  }

  /* ── abrir/fechar ──────────────────────────────────────────────────── */
  function mostrar(v) {
    aberto = v !== false;
    montar().style.display = aberto ? 'block' : 'none';
    if (aberto) atualizar(true);
  }
  function ligar(v) {
    ligado = v !== false;
    if (ligado) { desenhar(ultimo); } else limparLinhas();
  }
  function estaLigado() { return ligado; }
  function estaVisivel() { return aberto; }
  function estadoDoIndicador() { return ultimo; }

  // ciclo próprio: recalcula sem depender de ninguém
  setInterval(function () {
    if (!aberto && !ligado) return;
    atualizar(false);
    if (ligado) desenhar(ultimo);
  }, 2000);

  window.AtlasRsiMatrix = {
    mostrar: mostrar,
    ligar: ligar,
    ligado: estaLigado,
    visivel: estaVisivel,
    leitura: estadoDoIndicador,
    recalcular: function () { atualizar(true); },
    opcoes: function () { return window.RSIMatrix ? window.RSIMatrix.opcoes(opcoes) : opcoes; },
    versao: '1.0.0'
  };

  // item na lateral
  function itemLateral() {
    var nav = document.querySelector('.side-nav-top') || document.querySelector('.side-nav');
    if (!nav || document.getElementById('nav-rsi-matrix')) return;
    var it = document.createElement('div');
    it.className = 'nav-item';
    it.id = 'nav-rsi-matrix';
    it.title = 'RSI Matrix: RSI, EMA do RSI e o preço de cada nível';
    it.innerHTML = '<span class="nav-icon">🔷</span><span class="nav-lbl">RSI Matrix</span>';
    it.addEventListener('click', function () { mostrar(!aberto); });
    nav.appendChild(it);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', itemLateral);
  else itemLateral();
})();
