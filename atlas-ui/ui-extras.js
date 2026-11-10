/* Camada de ajustes do painel Atlas.
   Carregada depois do painel montar. Faz três coisas:
   1. remove a barra inferior que eu havia colocado (redundante)
   2. coloca Risco e Acessos na navegação da esquerda, abaixo de Ajuda
   3. troca a barra de rolagem horizontal por arrastar com o mouse */

(function () {
  function removerBarraInferior() {
    var n = document.getElementById('atlasNav');
    if (n) n.remove();
  }

  var estilo = document.createElement('style');
  estilo.textContent = [
    '.topbar,.cat-bar,.toolbar,.chips{scrollbar-width:none;-ms-overflow-style:none}',
    '.topbar::-webkit-scrollbar,.cat-bar::-webkit-scrollbar,.toolbar::-webkit-scrollbar,.chips::-webkit-scrollbar{height:0;display:none}',
    '.arrastavel{cursor:grab}',
    '.arrastavel.arrastando{cursor:grabbing}',
    '.arrastavel.arrastando *{pointer-events:none}',
    '@media (min-width:1300px){.topbar{gap:6px!important}}'
  ].join('\n');
  document.head.appendChild(estilo);

  function ativarArrasto(el) {
    if (el.__arrasto) return;
    el.__arrasto = true;
    el.classList.add('arrastavel');
    var ativo = false, x0 = 0, s0 = 0, moveu = false;

    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      ativo = true; moveu = false;
      x0 = e.clientX; s0 = el.scrollLeft;
      el.classList.add('arrastando');
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });

    el.addEventListener('pointermove', function (e) {
      if (!ativo) return;
      var d = e.clientX - x0;
      if (Math.abs(d) > 3) moveu = true;
      el.scrollLeft = s0 - d;
    });

    function soltar() {
      ativo = false;
      el.classList.remove('arrastando');
    }
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);
    el.addEventListener('pointerleave', function () { if (ativo) soltar(); });

    el.addEventListener('click', function (e) {
      if (moveu) { e.stopPropagation(); e.preventDefault(); moveu = false; }
    }, true);
  }

  function varrerRolagem() {
    var alvos = document.querySelectorAll('.topbar,.cat-bar,.toolbar,.chips');
    for (var i = 0; i < alvos.length; i++) {
      var el = alvos[i];
      if (el.scrollWidth > el.clientWidth + 8) ativarArrasto(el);
    }
  }

  function injetarMenu() {
    var topo = document.querySelector('.side-nav-top');
    if (!topo) return false;
    if (topo.querySelector('[data-extras]')) return true;
    var itens = topo.querySelectorAll('.nav-item');
    var base = null;
    for (var i = 0; i < itens.length; i++) {
      if (/Ajuda/i.test(itens[i].textContent)) { base = itens[i]; break; }
    }
    if (!base) return false;

    var novos = [
      { rotulo: 'Risco', icone: '⚠', href: '/risco/' },
      { rotulo: 'Acessos', icone: '🔑', href: '/terminal/' }
    ];
    var referencia = base;
    novos.forEach(function (o) {
      var cl = base.cloneNode(true);
      cl.setAttribute('data-extras', '1');
      cl.removeAttribute('id');
      var lbl = cl.querySelector('.nav-lbl');
      if (lbl) lbl.textContent = o.rotulo;
      for (var k = 0; k < cl.children.length; k++) {
        if (cl.children[k] !== lbl && !cl.children[k].contains(lbl)) {
          cl.children[k].textContent = o.icone;
          break;
        }
      }
      cl.style.cursor = 'pointer';
      cl.setAttribute('role', 'button');
      cl.setAttribute('title', o.rotulo);
      cl.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        window.location.href = o.href;
      });
      referencia.parentNode.insertBefore(cl, referencia.nextSibling);
      referencia = cl;
    });
    return true;
  }

  var tentativas = 0;
  var timer = setInterval(function () {
    tentativas++;
    removerBarraInferior();
    var ok = injetarMenu();
    varrerRolagem();
    if ((ok && tentativas > 6) || tentativas > 80) clearInterval(timer);
  }, 700);

  document.addEventListener('DOMContentLoaded', function () {
    removerBarraInferior();
    varrerRolagem();
  });

  window.addEventListener('resize', function () { setTimeout(varrerRolagem, 400); });
})();
