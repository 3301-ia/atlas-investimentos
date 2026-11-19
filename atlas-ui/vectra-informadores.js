/* =====================================================================
   INFORMADORES — o que chega de fora para dentro do painel VECTRA
   ---------------------------------------------------------------------
   Um cartão fixo no canto de baixo à direita que mostra os últimos eventos
   recebidos pelo webhook vectraWebhook: alerta do TradingView, execução da
   corretora, sinal do robô ou texto solto. Lê a lista a cada 20 s, sem
   precisar de chave. Recolhe e lembra o estado, como as barras laterais.
   ===================================================================== */
(function(){
  if (window.__vxInformadores) return;
  window.__vxInformadores = true;

  const APP = '6a02bf87bbdfc0e29f88b64a';
  const URL_LISTA = 'https://base44.app/api/apps/' + APP + '/functions/vectraWebhook';
  const CHAVE_ESTADO = 'vx_informadores_aberto';

  const css = document.createElement('style');
  css.textContent = `
  #vx-dock-inf{position:fixed;right:12px;bottom:44px;z-index:9000;width:306px;
    background:#0b0d11;border:1px solid rgba(255,255,255,.09);border-radius:4px;
    font:11px/1.35 Inter,system-ui,-apple-system,sans-serif;color:#cfd6de;
    box-shadow:0 6px 22px rgba(0,0,0,.45);overflow:hidden}
  #vx-dock-inf *{box-sizing:border-box}
  #vx-dock-inf .vx-inf-top{display:flex;align-items:center;gap:6px;height:28px;padding:0 8px;
    border-bottom:1px solid rgba(255,255,255,.07);cursor:pointer;user-select:none}
  #vx-dock-inf .vx-inf-nome{font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:#9aa1ab;flex:1}
  #vx-dock-inf .vx-inf-n{font:9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#6f7782}
  #vx-dock-inf .vx-inf-luz{width:5px;height:5px;border-radius:50%;background:#3a4049}
  #vx-dock-inf .vx-inf-luz.viva{background:#089981}
  #vx-dock-inf .vx-inf-corpo{max-height:196px;overflow-y:auto;scrollbar-width:thin}
  #vx-dock-inf.recolhido .vx-inf-corpo{display:none}
  #vx-dock-inf .vx-inf-linha{display:grid;grid-template-columns:34px 1fr auto;gap:6px;
    align-items:baseline;padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.045)}
  #vx-dock-inf .vx-inf-linha:last-child{border-bottom:0}
  #vx-dock-inf .vx-inf-h{font:9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#6f7782}
  #vx-dock-inf .vx-inf-q{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
  #vx-dock-inf .vx-inf-f{font-size:8px;letter-spacing:.06em;text-transform:uppercase;color:#6f7782}
  #vx-dock-inf .vx-inf-ativo{font:10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e7ebf0}
  #vx-dock-inf .vx-inf-preco{font:10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#9aa1ab;
    font-variant-numeric:tabular-nums;white-space:nowrap}
  #vx-dock-inf .vx-inf-compra{color:#089981}
  #vx-dock-inf .vx-inf-venda{color:#f23645}
  #vx-dock-inf .vx-inf-vazio{padding:10px 8px;font-size:9.5px;color:#6f7782}
  @media (max-width:820px){
    #vx-dock-inf{width:calc(100vw - 24px);right:12px;bottom:52px}
    #vx-dock-inf .vx-inf-corpo{max-height:132px}
  }`;
  document.head.appendChild(css);

  const card = document.createElement('div');
  card.id = 'vx-dock-inf';
  card.innerHTML =
    '<div class="vx-inf-top">' +
      '<span class="vx-inf-luz"></span>' +
      '<span class="vx-inf-nome">Informadores</span>' +
      '<span class="vx-inf-n">—</span>' +
    '</div>' +
    '<div class="vx-inf-corpo"><div class="vx-inf-vazio">nenhum informador conectado ainda</div></div>';
  document.body.appendChild(card);

  const corpo = card.querySelector('.vx-inf-corpo');
  const contador = card.querySelector('.vx-inf-n');
  const luz = card.querySelector('.vx-inf-luz');

  if (localStorage.getItem(CHAVE_ESTADO) === '0') card.classList.add('recolhido');
  card.querySelector('.vx-inf-top').addEventListener('click', () => {
    card.classList.toggle('recolhido');
    localStorage.setItem(CHAVE_ESTADO, card.classList.contains('recolhido') ? '0' : '1');
  });

  const dois = n => String(n).padStart(2, '0');
  const hora = iso => { try { const d = new Date(iso); return dois(d.getHours()) + ':' + dois(d.getMinutes()); } catch { return '--:--'; } };
  const preco = v => (v === null || v === undefined || v === '') ? '' :
    Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function linha(e){
    const ladoCls = e.lado === 'compra' ? 'vx-inf-compra' : (e.lado === 'venda' ? 'vx-inf-venda' : '');
    const titulo = (e.ativo && e.ativo !== '—') ? e.ativo : (e.estrategia || e.fonte || 'evento');
    const detalhe = e.texto || e.estrategia || e.tipo || '';
    return '<div class="vx-inf-linha">' +
      '<span class="vx-inf-h">' + hora(e.recebido_em || e.created_date) + '</span>' +
      '<span class="vx-inf-q"><span class="' + ladoCls + ' vx-inf-ativo">' + titulo + '</span>' +
        (detalhe ? ' <span class="vx-inf-f">' + String(detalhe).slice(0, 42) + '</span>' : '') + '</span>' +
      '<span class="vx-inf-preco">' + preco(e.preco) + '</span>' +
    '</div>';
  }

  let erro = 0;
  async function puxa(){
    try{
      const r = await fetch(URL_LISTA + '?limite=8', { cache: 'no-store' });
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      const lista = Array.isArray(d.eventos) ? d.eventos : [];
      contador.textContent = lista.length ? String(lista.length) : '—';
      corpo.innerHTML = lista.length
        ? lista.map(linha).join('')
        : '<div class="vx-inf-vazio">nenhum informador conectado ainda</div>';
      luz.classList.add('viva');
      erro = 0;
    } catch(e){
      erro++;
      if (erro > 1) luz.classList.remove('viva');
    }
  }

  puxa();
  setInterval(puxa, 20000);
  window.vxInformadores = { atualiza: puxa };
})();
