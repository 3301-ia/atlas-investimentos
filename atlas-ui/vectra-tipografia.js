/* ── Régua mínima da tipografia ───────────────────────────────────────────
   O painel cresceu com fontes de 7, 8 e 9px herdadas de quando a tela era
   outra coisa. 7px não é "compacto", é ilegível, e no telefone vira borrão.
   Este módulo sobe qualquer texto abaixo do piso para o piso da linguagem,
   sem tocar em canvas, svg nem em número de gráfico. Uma vez por elemento,
   marcado com data-vx-legivel, então não briga com quem quiser mudar.     */
(function () {
  if (window.AtlasRegua) return;
  var PISO = 10.5;          // px: abaixo disso o olho paga imposto
  var vistos = 0;

  function ajustar(raiz) {
    var alvos = (raiz || document).querySelectorAll('span,b,small,i,em,strong,label,div,p,td,th,a,button,li');
    var mudou = 0;
    for (var i = 0; i < alvos.length; i++) {
      var el = alvos[i];
      if (el.getAttribute('data-vx-legivel')) continue;
      if (el.closest('#chart, canvas, svg, .tv-lightweight-charts')) continue;
      var texto = (el.textContent || '').trim();
      if (!texto) continue;
      var temFilho = el.children.length > 0;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var fs = parseFloat(cs.fontSize);
      if (!(fs > 0) || fs >= PISO) { el.setAttribute('data-vx-legivel', '1'); continue; }
      // só sobe onde o texto é a folha ou o rótulo: não mexe em contêiner grande
      if (temFilho && el.querySelector('span,b,small,button,input,select')) { continue; }
      el.style.fontSize = PISO + 'px';
      el.setAttribute('data-vx-legivel', '1');
      mudou++;
    }
    vistos += mudou;
    return mudou;
  }

  /* barra de desenho: símbolo em cima, palavra embaixo, nome inteiro no title.
     Antes o rótulo de 137px vivia escondido dentro de um botão de 40px.     */
  function compactarBarra() {
    var barra = document.getElementById('drawing-toolbar');
    if (!barra) return 0;
    var mudou = 0;
    [].forEach.call(barra.querySelectorAll('.tool-btn'), function (b) {
      if (b.getAttribute('data-vx-compacto')) return;
      if (b.querySelector('input, select, canvas')) return;
      var texto = (b.innerText || '').replace(/\s+/g, ' ').trim();
      if (!texto) return;
      var partes = texto.split(' ');
      var simbolo = partes.shift() || '•';
      var palavra = (partes.join(' ').split(/[(\[]/)[0] || '').trim().split(' ')[0] || '';
      if (!palavra) palavra = simbolo;
      b.setAttribute('title', texto);
      b.setAttribute('data-vx-compacto', '1');
      b.innerHTML = '<span class="vx-simbolo">' + simbolo + '</span>' +
                    '<span class="vx-palavra">' + palavra.toLowerCase() + '</span>';
      mudou++;
    });
    return mudou;
  }

  function rodar() {
    try { ajustar(document.body); } catch (e) {}
    try { compactarBarra(); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rodar);
  else rodar();
  setTimeout(rodar, 1200);
  setTimeout(rodar, 4000);

  // tela que se monta depois (cartão, aba, módulo) entra na mesma régua
  if (window.MutationObserver) {
    var pendente = null;
    new MutationObserver(function () {
      if (pendente) return;
      pendente = setTimeout(function () { pendente = null; rodar(); }, 700);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  window.AtlasRegua = { piso: PISO, ajustar: rodar, corrigidos: function () { return vistos; } };
})();

/* ── conserta o que o CSS não alcança ─────────────────────────────────────
   1. avisos do robô em coluna (nasciam no mesmo pixel, um cobria o outro);
   2. dock sem esticar até o rodapé quando tem pouco conteúdo;
   3. barra de desenho dentro da tela no celular.
   Usa style com important porque essas três coisas são posicionadas por JS. */
(function () {
  var caixa = null;
  function arrumar() {
    var avisos = [].slice.call(document.querySelectorAll('.vx-aviso'));
    if (avisos.length) {
      if (!caixa || !document.body.contains(caixa)) {
        caixa = document.createElement('div');
        caixa.id = 'vx-avisos';
        document.body.appendChild(caixa);
      }
      var estreito = window.innerWidth <= 820;
      caixa.style.cssText = 'position:fixed;top:' + (estreito ? 108 : 56) + 'px;' +
        (estreito ? 'left:8px;right:8px;' : 'right:344px;width:320px;') +
        'display:flex;flex-direction:column;gap:8px;z-index:9600;pointer-events:none;';
      avisos.forEach(function (a) {
        if (a.parentElement !== caixa) caixa.appendChild(a);
        a.style.setProperty('position', 'static', 'important');
        a.style.setProperty('inset', 'auto', 'important');
        a.style.setProperty('width', '100%', 'important');
        a.style.setProperty('margin', '0', 'important');
        a.style.setProperty('left', 'auto', 'important');
        a.style.setProperty('right', 'auto', 'important');
        a.style.setProperty('top', 'auto', 'important');
        a.style.setProperty('bottom', 'auto', 'important');
        a.style.setProperty('pointer-events', 'auto', 'important');
      });
      while (caixa.children.length > 3) caixa.removeChild(caixa.firstChild);
    }
    var dock = document.getElementById('vx-dock');
    if (dock) {
      dock.style.setProperty('bottom', 'auto', 'important');
      dock.style.setProperty('max-height', 'calc(100vh - 130px)', 'important');
    }
    var barra = document.getElementById('drawing-toolbar');
    if (barra && window.innerWidth <= 820) {
      barra.style.setProperty('left', 'auto', 'important');
      barra.style.setProperty('right', '6px', 'important');
    }
  }
  var t = null;
  function agendar() { clearTimeout(t); t = setTimeout(arrumar, 120); }
  if (document.readyState !== 'loading') agendar(); else document.addEventListener('DOMContentLoaded', agendar);
  window.addEventListener('resize', agendar);
  new MutationObserver(agendar).observe(document.documentElement, { childList: true, subtree: true });
})();
