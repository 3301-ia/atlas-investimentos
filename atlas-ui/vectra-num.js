// Um só formatador para todo o painel.
// Antes cada módulo escrevia do seu jeito em #vx-preco (um com "$" e ponto,
// outro sem "$" e com vírgula), e o preço ficava trocando de formato na tela.
(function () {
  'use strict';
  var BR = 'pt-BR';
  function mil(v, casas) {
    if (v == null || !isFinite(v)) return '--';
    return Number(v).toLocaleString(BR, { minimumFractionDigits: casas == null ? 2 : casas, maximumFractionDigits: casas == null ? 2 : casas });
  }
  function preco(v) { return v == null || !isFinite(v) ? '--' : '$' + mil(v, 2); }
  function pct(v, casas) {
    if (v == null || !isFinite(v)) return '--';
    var c = casas == null ? 2 : casas;
    return (v >= 0 ? '+' : '') + Number(v).toLocaleString(BR, { minimumFractionDigits: c, maximumFractionDigits: c }) + '%';
  }
  function curto(v) {
    if (v == null || !isFinite(v)) return '--';
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toLocaleString(BR, { maximumFractionDigits: 2 }) + 'B';
    if (a >= 1e6) return (v / 1e6).toLocaleString(BR, { maximumFractionDigits: 2 }) + 'M';
    if (a >= 1e3) return (v / 1e3).toLocaleString(BR, { maximumFractionDigits: 1 }) + 'K';
    return mil(v, 2);
  }
  window.VXnum = { mil: mil, preco: preco, pct: pct, curto: curto };

  // Varredura de segurança: se algum módulo antigo escrever preço fora do
  // padrão (sem "$", com ponto decimal ou sem separador de milhar), o texto
  // é reescrito no padrão único antes de o olho perceber o pulo.
  function normalizar(el) {
    if (!el) return;
    var t = (el.textContent || '').trim();
    var m = t.match(/^\$?\s*(\d{1,3}(?:[.,]\d{3})*|\d+)(?:[.,](\d+))?$/);
    if (!m) return;
    var inteiro = m[1].replace(/[.,]/g, '');
    var dec = m[2] || '00';
    if (dec.length > 2) dec = dec.slice(0, 2);
    var novo = '$' + Number(inteiro + '.' + dec).toLocaleString(BR, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (novo !== t) el.textContent = novo;
  }
  function varrer() {
    ['vx-preco', 'big-price', 'rt-price'].forEach(function (id) { normalizar(document.getElementById(id)); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setInterval(varrer, 900); });
  else setInterval(varrer, 900);
})();

// Estado inicial das barras laterais: o painel abre com as duas recolhidas.
// Se o usuário abriu de propósito na última visita, respeita a escolha.
(function () {
  'use strict';
  function fechar(primeira) {
    var work = document.getElementById('vx-work');
    var dock = document.getElementById('vx-dock');
    var mesaAberta, dockAberto;
    try { mesaAberta = localStorage.getItem('vx_mesa_aberta') === '1'; dockAberto = localStorage.getItem('vxDockRecolhido') === '0'; } catch (e) {}
    if (work && !mesaAberta) {
      work.classList.add('vx-fechada');
      var f = document.getElementById('vx-work-fold');
      if (f) { f.textContent = '\u27e9'; f.title = 'abrir a mesa'; }
    }
    if (dock && !dockAberto) {
      dock.classList.add('recolhido');
      var b = dock.querySelector('#vx-dock-toggle');
      if (b) { b.textContent = '\u27e8'; b.title = 'abrir o painel'; }
    }
    if (primeira) { try { localStorage.setItem('vx_mesa_aberta', '0'); localStorage.setItem('vxDockRecolhido', '1'); } catch (e) {} }
  }
  function iniciar() { fechar(true); setTimeout(function () { fechar(false); }, 1200); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
