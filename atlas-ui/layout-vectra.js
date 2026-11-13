/* ── Vectra: um canto de estado só ────────────────────────────────────────
   Antes cada módulo abria o seu cartão fixo no canto e eles se cobriam:
   Imperial e Consenso ocupavam o mesmo retângulo, o Deriv entrava por cima
   da barra, o Vigia encostava na tabela de alvos. Aqui existe UM dock com
   abas: os cartões são adotados (o DOM deles é preservado, com os eventos),
   perdem a moldura própria e aparecem um por vez, na mesma linguagem visual. */

(function () {
  if (window.__vxLayout) return;
  window.__vxLayout = true;

  var CARTOES = [
    { id: 'vg-card', aba: 'Vigia', icone: '🛡' },
    { id: 'imperial-card', aba: 'Imperial', icone: '⚔' },
    { id: 'consenso-card', aba: 'Consenso', icone: '◈' },
    { id: 'deriv-card', aba: 'Deriv', icone: '◇' }
  ];
  var PRIMARIOS = ['inicio', 'codigo', 'vigia', 'estudos', 'imperial', 'consenso', 'analise', 'alertas'];

  var dock, corpo, abas, idadeEl, abaAtiva = 'mercado';
  var adotados = {};      // id do cartão -> elemento
  var painelMercado = null;

  function fmt(v, casas) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(casas == null ? 2 : casas) : '--'; }
  function lerMercado() {
    try { return window.AtlasMercado ? window.AtlasMercado.ler() : null; } catch (e) { return null; }
  }

  function montarDock() {
    if (document.getElementById('vx-dock')) { dock = document.getElementById('vx-dock'); return; }
    dock = document.createElement('aside');
    dock.id = 'vx-dock';
    dock.innerHTML =
      '<div class="vx-dock-topo">' +
        '<span class="vx-marca">Estado</span>' +
        '<span class="vx-idade" id="vx-idade">--</span>' +
        '<button type="button" id="vx-dock-toggle" title="recolher o painel" aria-label="recolher o painel">⟩</button>' +
      '</div>' +
      '<div class="vx-dock-abas" role="tablist" id="vx-abas"></div>' +
      '<div class="vx-dock-corpo" id="vx-corpo"></div>';
    document.body.appendChild(dock);
    corpo = dock.querySelector('#vx-corpo');
    abas = dock.querySelector('#vx-abas');
    idadeEl = dock.querySelector('#vx-idade');

    dock.querySelector('#vx-dock-toggle').addEventListener('click', function () {
      dock.classList.toggle('recolhido');
      var r = dock.classList.contains('recolhido');
      this.textContent = r ? '⟨' : '⟩';
      this.title = r ? 'abrir o painel' : 'recolher o painel';
      try { localStorage.setItem('vxDockRecolhido', r ? '1' : '0'); } catch (e) {}
    });
    try { if (localStorage.getItem('vxDockRecolhido') === '1') { dock.classList.add('recolhido'); dock.querySelector('#vx-dock-toggle').textContent = '⟨'; } } catch (e) {}

    montarPainelMercado();
    montarAbas();
  }

  function montarAbas() {
    var lista = [{ chave: 'mercado', rotulo: 'Mercado', icone: '◉' }];
    CARTOES.forEach(function (c) { lista.push({ chave: c.id, rotulo: c.aba, icone: c.icone }); });
    abas.innerHTML = lista.map(function (t) {
      return '<button type="button" class="vx-aba" role="tab" data-aba="' + t.chave + '" aria-selected="' +
        (t.chave === abaAtiva ? 'true' : 'false') + '">' + t.icone + ' ' + t.rotulo + '</button>';
    }).join('');
    abas.addEventListener('click', function (ev) {
      var b = ev.target.closest('.vx-aba');
      if (b) selecionar(b.getAttribute('data-aba'));
    });
    selecionar(abaAtiva);
  }

  function selecionar(chave) {
    abaAtiva = chave;
    if (!abas) return;
    [].forEach.call(abas.querySelectorAll('.vx-aba'), function (b) {
      b.setAttribute('aria-selected', b.getAttribute('data-aba') === chave ? 'true' : 'false');
    });
    if (painelMercado) painelMercado.hidden = chave !== 'mercado';
    Object.keys(adotados).forEach(function (id) {
      var el = adotados[id];
      el.hidden = id !== chave;
      el.style.display = id === chave ? 'block' : 'none';
    });
    if (chave === 'mercado') pintarMercado();
  }

  /* ── aba Mercado: leitura única, com a idade do dado à mostra ──────── */
  function montarPainelMercado() {
    painelMercado = document.createElement('div');
    painelMercado.id = 'vx-mercado';
    painelMercado.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:8px;padding:4px 2px 10px">' +
        '<span id="vx-preco" style="font:600 26px/1 var(--vx-num);color:#EAF4FB;letter-spacing:-.02em">--</span>' +
        '<span id="vx-simbolo" style="font-size:10.5px;letter-spacing:.12em;color:var(--vx-texto-fraco)"></span>' +
        '<span id="vx-fonte" style="margin-left:auto;font-size:10px;color:var(--vx-texto-fraco)"></span>' +
      '</div>' +
      lin('Gatilho 74.100', 'vx-gatilho') +
      lin('Termômetro 72.511', 'vx-termo') +
      lin('Stop do trailing', 'vx-stop') +
      lin('Distância ao stop', 'vx-dist') +
      '<div style="margin-top:10px;font-size:10.5px;line-height:1.5;color:var(--vx-texto-fraco)">' +
        'Leitura única de preço: cabeçalho, cartões e distâncias saem do mesmo instante.' +
      '</div>';
    corpo.appendChild(painelMercado);
  }
  function lin(rotulo, id) {
    return '<div style="display:flex;gap:8px;align-items:center;padding:7px 2px;border-bottom:1px solid rgba(255,255,255,.04)">' +
      '<span style="font-size:11px;color:var(--vx-texto-fraco)">' + rotulo + '</span>' +
      '<span id="' + id + '" style="margin-left:auto;font:500 12.5px var(--vx-num);color:#D6E7F3">--</span></div>';
  }

  function pintarMercado() {
    if (!painelMercado) return;
    var m = lerMercado();
    var el = function (id) { return document.getElementById(id); };
    if (m && m.preco) {
      if (el('vx-preco')) el('vx-preco').textContent = '$' + fmt(m.preco);
      if (el('vx-simbolo')) el('vx-simbolo').textContent = (m.simbolo || '') + (m.tf ? ' · ' + m.tf : '');
      if (el('vx-fonte')) el('vx-fonte').textContent = m.fonte || '';
      if (el('vx-gatilho')) {
        var d = m.preco - 74100;
        el('vx-gatilho').textContent = (d >= 0 ? '+' : '') + fmt(d) + (d < 0 ? ' abaixo' : ' acima');
        el('vx-gatilho').style.color = d >= 0 ? 'var(--vx-alta)' : 'var(--vx-texto)';
      }
      if (el('vx-termo')) {
        var t = m.preco - 72511;
        el('vx-termo').textContent = (t >= 0 ? '+' : '') + fmt(t) + (t < 0 ? ' abaixo' : ' acima');
        el('vx-termo').style.color = t < 0 ? 'var(--vx-alta)' : 'var(--vx-baixa)';
      }
    }
    var e = (window.AtlasTrailing && window.AtlasTrailing.estado) ? window.AtlasTrailing.estado() : null;
    if (e) {
      if (el('vx-stop')) el('vx-stop').textContent = fmt(e.stop);
      if (el('vx-dist')) el('vx-dist').textContent = fmt(e.distancia) + ' (' + fmt(e.distanciaPercentual, 3) + '%)';
    }
    if (idadeEl && m && m.idade != null) {
      idadeEl.textContent = m.idade < 1000 ? 'agora' : Math.round(m.idade / 1000) + 's';
      idadeEl.style.color = m.idade > 15000 ? 'var(--vx-baixa)' : 'var(--vx-texto-fraco)';
    }
  }

  /* ── adoção dos cartões ─────────────────────────────────────────────── */
  function adotar() {
    CARTOES.forEach(function (c) {
      if (adotados[c.id]) return;
      var el = document.getElementById(c.id);
      if (!el) return;
      // limpa o posicionamento próprio: quem posiciona agora é o dock
      el.style.position = 'static';
      el.style.inset = 'auto';
      el.style.width = '100%';
      el.style.maxWidth = '100%';
      el.style.maxHeight = 'none';
      el.style.margin = '0';
      el.style.zIndex = 'auto';
      el.classList.add('vx-hospedado');
      el.hidden = true;
      el.style.display = 'none';
      corpo.appendChild(el);
      adotados[c.id] = el;
    });
    if (abaAtiva !== 'mercado' && adotados[abaAtiva]) selecionar(abaAtiva);
  }

  /* ── lateral: oito itens e um "mais" ───────────────────────────────── */
  function agruparLateral() {
    var nav = document.querySelector('.side-nav');
    if (!nav || document.getElementById('nav-mais')) return;
    var itens = [].slice.call(nav.querySelectorAll('.nav-item'));
    if (itens.length <= 9) return;

    var maisLista = document.createElement('div');
    maisLista.id = 'nav-mais-lista';
    var extra = [];
    itens.forEach(function (it) {
      var t = (it.innerText || it.title || '').toLowerCase();
      var primario = PRIMARIOS.some(function (p) { return t.indexOf(p) >= 0; });
      if (!primario) extra.push(it);
    });
    if (!extra.length) return;
    extra.forEach(function (it) { maisLista.appendChild(it); });

    var botao = document.createElement('button');
    botao.type = 'button';
    botao.id = 'nav-mais';
    botao.textContent = '⋯  MAIS  (' + extra.length + ')';
    botao.title = 'mais telas do painel';
    botao.addEventListener('click', function () {
      var aberto = maisLista.classList.toggle('aberto');
      botao.textContent = (aberto ? '−  MENOS' : '⋯  MAIS  (' + extra.length + ')');
    });

    nav.appendChild(botao);
    nav.appendChild(maisLista);

    // abrir uma tela escondida pelo "mais" também acende a aba certa
    extra.forEach(function (it) {
      it.addEventListener('click', function () {
        setTimeout(function () {
          CARTOES.forEach(function (c) {
            var el = document.getElementById(c.id);
            if (el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none') selecionar(c.id);
          });
        }, 60);
      });
    });
  }

  function ciclo() { adotar(); pintarMercado(); }

  function iniciar() {
    document.body.classList.add('vx');
    montarDock();
    adotar();
    agruparLateral();
    setInterval(ciclo, 1000);
    try {
      new MutationObserver(function () { adotar(); }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
