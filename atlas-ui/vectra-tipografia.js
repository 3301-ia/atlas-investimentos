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

  function rodar() {
    try { ajustar(document.body); } catch (e) {}
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
