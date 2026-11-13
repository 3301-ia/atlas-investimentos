/* Avisos do robô em coluna, um embaixo do outro.
   Antes cada aviso nascia no mesmo canto e o segundo cobria o primeiro. */
(function () {
  var caixa = null, t = null;
  function arrumar() {
    var avisos = [].slice.call(document.querySelectorAll('.vx-aviso'));
    if (!avisos.length) return;
    if (!caixa || !document.body.contains(caixa)) {
      caixa = document.createElement('div');
      caixa.id = 'vx-avisos';
      document.body.appendChild(caixa);
    }
    avisos.forEach(function (a) { if (a.parentElement !== caixa) caixa.appendChild(a); });
    while (caixa.children.length > 3) caixa.removeChild(caixa.firstChild);
  }
  function agendar() { clearTimeout(t); t = setTimeout(arrumar, 120); }
  if (document.readyState !== 'loading') agendar(); else document.addEventListener('DOMContentLoaded', agendar);
  new MutationObserver(agendar).observe(document.documentElement, { childList: true, subtree: true });
})();
