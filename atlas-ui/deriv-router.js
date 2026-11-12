/* global window, document, localStorage */
// Roteador e feed da Deriv (P7 e P8).
//
// A Deriv recusa conexao vinda de IP de datacenter (o navegador automatizado
// recebe 520), entao nada aqui roda em servidor: o socket sai do navegador do
// dono, com o App ID 1089 que ele determinou. O token nunca fica no codigo —
// mora no localStorage do proprio navegador dele.
//
// O que este arquivo faz:
//   feed   - velas de cambio e metal (frx*) e cripto (cry*), inclusive segundos
//   roteador - propõe e envia contrato com stop obrigatorio, em papel ou real
(function () {
  'use strict';
  const URL_WS = 'wss://ws.derivws.com/websockets/v3?app_id=';
  const APP_PADRAO = '1089';
  const CHAVE_TOKEN = 'atlas.deriv.token';
  const CHAVE_APP = 'deriv_app_id';

  const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  let core = null;                       // core/deriv.js carregado sob demanda

  function obterCore() {
    if (core) return Promise.resolve(core);
    return import('./core/deriv.js').then(m => (core = m)).catch(() => null);
  }

  function appId() {
    try { return localStorage.getItem(CHAVE_APP) || APP_PADRAO; } catch (e) { return APP_PADRAO; }
  }
  function token() {
    try { return localStorage.getItem(CHAVE_TOKEN) || ''; } catch (e) { return ''; }
  }

  const S = {
    ws: null, aberto: false, pedido: 0, fila: new Map(),
    erro: null, conta: null, saldo: null, virtual: null,
    ligado: false, tentativas: 0, ultimoEnvio: null, papel: [],
  };

  function conectar() {
    return new Promise(resolve => {
      if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1)) {
        if (S.aberto) resolve({ ok: true, jaAberto: true });
        else setTimeout(() => resolve({ ok: S.aberto }), 400);
        return;
      }
      let ws;
      try { ws = new WebSocket(URL_WS + encodeURIComponent(appId())); }
      catch (e) { S.erro = 'nao abriu o socket: ' + e.message; resolverFalhas(); resolve({ ok: false, erro: S.erro }); return; }
      S.ws = ws;
      const limite = setTimeout(() => {
        if (!S.aberto) { S.erro = 'sem resposta da Deriv em 12s'; resolverFalhas(); resolve({ ok: false, erro: S.erro }); }
      }, 12000);
      ws.onopen = () => {
        S.aberto = true; S.erro = null; clearTimeout(limite);
        autorizarSilencioso();
        resolve({ ok: true });
      };
      ws.onclose = () => {
        S.aberto = false;
        resolverFalhas('conexao fechada');
        if (S.ligado && S.tentativas < 5) {
          S.tentativas++;
          setTimeout(conectar, 1500 * S.tentativas);
        }
      };
      ws.onerror = () => { S.erro = 'conexao recusada pela Deriv'; };
      ws.onmessage = ev => {
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        receber(msg);
      };
    });
  }

  function resolverFalhas(motivo) {
    S.fila.forEach(cb => { try { cb(null, motivo || 'conexao perdida'); } catch (e) {} });
    S.fila.clear();
  }

  function pedir(payload, tempo = 12000) {
    return new Promise(resolve => {
      const pronto = () => {
        if (!S.aberto) { conectar(); return false; }
        return true;
      };
      const enviar = () => {
        if (!pronto()) { conectar().then(ok => { if (ok.ok) enviar(); else resolve(null); }); return; }
        const id = ++S.pedido;
        const corpo = Object.assign({}, payload, { req_id: id });
        S.fila.set(id, resolve);
        try { S.ws.send(JSON.stringify(corpo)); }
        catch (e) { S.fila.delete(id); resolve(null); return; }
        setTimeout(() => {
          if (S.fila.has(id)) { S.fila.delete(id); resolve(null); }
        }, tempo);
      };
      enviar();
    });
  }

  function receber(msg) {
    const id = msg.req_id;
    if (id != null && S.fila.has(id)) {
      const cb = S.fila.get(id);
      S.fila.delete(id);
      cb(msg);
      pintarSeAberto();
      return;
    }
    if (msg.msg_type === 'authorize' && msg.authorize) {
      S.conta = msg.authorize.loginid;
      S.saldo = num(msg.authorize.balance);
      S.virtual = !!msg.authorize.is_virtual;
      S.erro = null;
      pintarSeAberto();
    } else if (msg.error && !id) {
      S.erro = msg.error.message || 'erro da Deriv';
      pintarSeAberto();
    }
  }

  function autorizarSilencioso() {
    const t = token();
    if (!t) return;
    pedir({ authorize: t }).then(msg => {
      if (!msg) return;
      if (msg.error) { S.erro = msg.error.message || 'token recusado'; S.conta = null; }
      else if (msg.authorize) {
        S.conta = msg.authorize.loginid;
        S.saldo = num(msg.authorize.balance);
        S.virtual = !!msg.authorize.is_virtual;
        S.erro = null;
      }
      pintarSeAberto();
    });
  }

  // ── FEED: velas de qualquer ativo da Deriv, inclusive segundos ────────────
  async function velas(sym, segundos, quantidade = 600) {
    const m = await obterCore();
    if (!m) return null;
    const alvo = m.simboloDeriv(sym);
    if (!alvo) return null;
    const seg = Math.max(1, Math.floor(segundos || 60));
    if (seg >= 60) {
      const msg = await pedir({ ticks_history: alvo, adjust_start_time: 1, count: Math.min(5000, quantidade), end: 'latest', style: 'candles', granularity: seg });
      const velas = msg && msg.candles;
      if (!Array.isArray(velas) || !velas.length) return null;
      return velas.map(c => ({
        time: Number(c.epoch), open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close), volume: 0,
      })).filter(c => c.time && c.close != null);
    }
    // abaixo de 1 minuto a Deriv nao entrega vela: monta dos ticks crus
    const msg = await pedir({ ticks_history: alvo, adjust_start_time: 1, count: Math.min(5000, Math.max(1000, quantidade * 4)), end: 'latest', style: 'ticks' });
    const preco = msg && msg.history && msg.history.prices;
    const tempo = msg && msg.history && msg.history.times;
    if (!Array.isArray(preco) || !preco.length) return null;
    const ticks = preco.map((p, i) => ({ quote: +p, epoch: +tempo[i] }));
    return m.velasDeTicks(ticks, seg).slice(-quantidade);
  }

  // ── ROTEADOR ─────────────────────────────────────────────────────────────
  function ordemDoPainel() {
    const g = (n) => (typeof window[n] !== 'undefined' ? window[n] : null);
    const sym = g('currentSym') || 'BTCUSDT';
    const preco = g('lastPrice') || g('currentPrice') || null;
    return { sym, preco };
  }

  async function propor(opcoes) {
    const m = await obterCore();
    if (!m) return { ok: false, erros: ['nucleo nao carregou'] };
    const o = opcoes || {};
    const c = m.contratoDeOrdem({
      sym: o.sym, lado: o.lado, entrada: o.entrada, stop: o.stop, alvo: o.alvo,
      equity: o.equity, riscoPct: o.riscoPct, multiplicador: o.multiplicador || 100,
    });
    const v = m.validarContrato(c);
    if (!c.ok || !v.ok) return { ok: false, erros: (c.erros || []).concat(v.erros), contrato: c };
    const msg = await pedir({
      proposal: 1, amount: c.stake, basis: 'stake', contract_type: c.contract_type,
      currency: 'USD', duration: 5, duration_unit: 't', symbol: c.symbol, multiplier: c.multiplier,
    });
    if (!msg) return { ok: false, erros: ['a Deriv nao respondeu a proposta'], contrato: c };
    if (msg.error) return { ok: false, erros: [msg.error.message], contrato: c };
    const p = msg.proposal;
    return { ok: true, contrato: c, proposta: { id: p && p.id, ask: p && num(p.ask_price), payout: p && num(p.payout) } };
  }

  async function enviar(ordem, opcoes) {
    const o = opcoes || {};
    if (!o.real) {
      S.papel.push({ quando: Date.now(), ordem });
      S.ultimoEnvio = { papel: true, ordem, quando: Date.now() };
      pintarSeAberto();
      return { ok: true, papel: true, ordem };
    }
    if (!token()) return { ok: false, erro: 'sem token: conecte a conta primeiro' };
    if (!S.conta) return { ok: false, erro: 'conta nao autorizada' };
    if (o.confirmar !== true) return { ok: false, erro: 'ordem real exige confirmacao explicita' };
    const prop = await propor(ordem);
    if (!prop.ok) return { ok: false, erro: prop.erros.join('; ') };
    const msg = await pedir({ buy: prop.proposta.id, price: prop.proposta.ask });
    const m = await obterCore();
    const lido = m ? m.lerResposta(msg) : { ok: false, erro: 'nucleo indisponivel' };
    S.ultimoEnvio = { real: true, ...lido, quando: Date.now() };
    pintarSeAberto();
    return lido;
  }

  // ── TELA ─────────────────────────────────────────────────────────────────
  let card = null, corpo = null;
  const OURO = '#D9B45B', CINZA = '#76818f', TEXT = '#e6edf3';

  function el(tag, css, txt) {
    const d = document.createElement(tag);
    if (css) d.style.cssText = css;
    if (txt != null) d.textContent = txt;
    return d;
  }

  function pintarSeAberto() { if (card && card.style.display !== 'none') pintar(); }

  function pintar() {
    if (!corpo) return;
    corpo.innerHTML = '';

    const linha = (rot, val, cor) => {
      const d = el('div', 'display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04);font:11px/1.3 ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums');
      d.appendChild(el('span', 'color:' + CINZA + ';letter-spacing:.04em', rot));
      d.appendChild(el('span', 'color:' + (cor || TEXT) + ';font-weight:600;text-align:right', val));
      corpo.appendChild(d);
    };

    const ok = S.aberto && !S.erro;
    linha('CONEXAO', ok ? 'conectada' : (S.erro || 'desligada'), ok ? '#2ECC8F' : '#E2564D');
    linha('APP ID', appId(), CINZA);
    linha('CONTA', S.conta ? S.conta : 'sem token', S.conta ? TEXT : CINZA);
    if (S.saldo != null) linha('SALDO', '$' + S.saldo.toFixed(2) + (S.virtual ? ' (virtual)' : ''), S.virtual ? OURO : '#2ECC8F');

    // campo de token: fica so no navegador do dono
    const campoTok = el('input', 'width:100%;margin:8px 0 4px;padding:10px;border-radius:6px;box-sizing:border-box;' +
      'background:rgba(255,255,255,.04);border:1px solid rgba(217,180,91,.35);color:#e6edf3;font:16px ui-monospace,Consolas,monospace');
    campoTok.type = 'password';
    campoTok.placeholder = token() ? 'token salvo · trocar' : 'cole o token da Deriv';
    campoTok.autocomplete = 'off';
    corpo.appendChild(campoTok);

    const bConectar = el('button', 'width:100%;min-height:40px;margin-top:4px;border-radius:6px;cursor:pointer;' +
      'background:rgba(217,180,91,.10);border:1px solid rgba(217,180,91,.45);color:' + OURO + ';font:600 10px ui-monospace,Consolas,monospace;letter-spacing:.06em', 'CONECTAR CONTA');
    bConectar.onclick = async () => {
      const t = campoTok.value.trim();
      if (t) { try { localStorage.setItem(CHAVE_TOKEN, t); } catch (e) {} }
      bConectar.textContent = 'conectando...';
      await conectar();
      autorizarSilencioso();
      setTimeout(pintarSeAberto, 900);
    };
    corpo.appendChild(bConectar);

    // risco e ordem
    linha('ATIVO', ordemDoPainel().sym, TEXT);
    const r = el('input', 'width:100%;margin:8px 0;padding:10px;border-radius:6px;box-sizing:border-box;' +
      'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);color:#e6edf3;font:16px ui-monospace,Consolas,monospace');
    r.type = 'number'; r.step = '0.1'; r.min = '0.1'; r.max = '5';
    r.value = String(lerRisco());
    r.onchange = () => { try { localStorage.setItem('atlas.deriv.risco', r.value); } catch (e) {} };
    corpo.appendChild(el('div', 'margin-top:6px;font:9px ui-monospace,Consolas,monospace;color:' + CINZA + ';letter-spacing:.06em', 'RISCO POR ORDEM (% DO SALDO)')).appendChild(r);

    const bProp = el('button', 'width:100%;min-height:40px;border-radius:6px;cursor:pointer;margin-top:2px;' +
      'background:transparent;border:1px solid rgba(217,180,91,.45);color:' + OURO + ';font:600 10px ui-monospace,Consolas,monospace;letter-spacing:.06em', 'CALCULAR CONTRATO');
    bProp.onclick = async () => {
      const p = ordemDoPainel();
      const preco = p.preco || (typeof window.lastPrice !== 'undefined' ? window.lastPrice : null);
      const saida = el('div', 'margin-top:6px;font:10px ui-monospace,Consolas,monospace;color:' + CINZA);
      saida.textContent = 'calculando...';
      corpo.insertBefore(saida, bProp.nextSibling);
      const m = await obterCore();
      const stopSug = typeof window.stopLoss === 'number' ? window.stopLoss : (preco ? preco * 0.985 : null);
      const c = m ? m.contratoDeOrdem({
        sym: p.sym, lado: (typeof window.posicao === 'string' ? window.posicao : 'venda'),
        entrada: preco, stop: stopSug, alvo: null,
        equity: S.saldo || 100, riscoPct: Number(r.value) || 1,
      }) : null;
      if (!c || !c.ok) { saida.textContent = 'sem contrato: ' + ((c && c.erros) || ['nucleo indisponivel']).join(', '); return; }
      saida.textContent = 'stake $' + c.stake.toFixed(2) + ' · stop $' + c.stop_loss.toFixed(2) +
        ' · risco $' + c.risco_usd.toFixed(2) + ' · ' + c.contract_type + ' ' + c.symbol;
    };
    corpo.appendChild(bProp);

    const bPapel = el('button', 'width:100%;min-height:40px;border-radius:6px;cursor:pointer;margin-top:6px;' +
      'background:transparent;border:1px solid rgba(46,204,143,.45);color:#2ECC8F;font:600 10px ui-monospace,Consolas,monospace;letter-spacing:.06em', 'ENVIAR EM PAPEL');
    bPapel.onclick = async () => {
      const p = ordemDoPainel();
      await enviar({ sym: p.sym, entrada: p.preco, riscoPct: Number(r.value) || 1 }, { real: false });
    };
    corpo.appendChild(bPapel);

    const bReal = el('button', 'width:100%;min-height:40px;border-radius:6px;cursor:pointer;margin-top:6px;' +
      'background:transparent;border:1px solid rgba(226,86,77,.5);color:#E2564D;font:600 10px ui-monospace,Consolas,monospace;letter-spacing:.06em', 'ENVIAR REAL (2 CLIQUES)');
    let espera = 0;
    bReal.onclick = async () => {
      if (Date.now() - espera > 6000) {
        espera = Date.now();
        bReal.textContent = 'CONFIRMAR EM 6s';
        setTimeout(() => { bReal.textContent = 'ENVIAR REAL (2 CLIQUES)'; }, 6000);
        return;
      }
      const p = ordemDoPainel();
      const r2 = await enviar({ sym: p.sym, entrada: p.preco, riscoPct: Number(r.value) || 1 }, { real: true, confirmar: true });
      bReal.textContent = r2.ok ? 'ENVIADO · ' + (r2.contrato_id || '') : 'RECUSADO · ' + (r2.erro || '');
      setTimeout(() => { bReal.textContent = 'ENVIAR REAL (2 CLIQUES)'; }, 6000);
    };
    corpo.appendChild(bReal);

    const nota = el('div', 'margin-top:8px;font:9px ui-monospace,Consolas,monospace;color:#4e5866;letter-spacing:.05em;text-align:center');
    nota.textContent = 'token no seu navegador · stop obrigatório · papel: ' + S.papel.length;
    corpo.appendChild(nota);
  }

  function lerRisco() {
    try { return Number(localStorage.getItem('atlas.deriv.risco')) || 1; } catch (e) { return 1; }
  }

  function abrir() {
    if (!card) montar();
    card.style.display = 'block';
    S.ligado = true;
    pintar();
    conectar().then(() => autorizarSilencioso());
  }

  function montar() {
    card = el('div', 'position:fixed;right:14px;bottom:700px;width:290px;max-height:calc(100vh - 720px);overflow:auto;z-index:9998;' +
      'background:linear-gradient(160deg,rgba(11,20,34,.97),rgba(8,14,24,.99));border:1px solid rgba(217,180,91,.28);' +
      'border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.5);padding:10px 12px 12px;color:#e6edf3');
    card.id = 'deriv-card';
    const topo = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px');
    topo.appendChild(el('div', 'font:700 10px ui-monospace,Consolas,monospace;letter-spacing:.16em;color:' + OURO, 'DERIV'));
    const x = el('button', 'width:24px;height:24px;border:0;background:transparent;color:#76818f;cursor:pointer;font-size:15px;line-height:1', '×');
    x.onclick = () => { card.style.display = 'none'; S.ligado = false; };
    topo.appendChild(x);
    card.appendChild(topo);
    corpo = el('div');
    card.appendChild(corpo);
    document.body.appendChild(card);
    window.addEventListener('resize', ajustar);
    ajustar();
  }

  function ajustar() {
    if (!card) return;
    const estreito = window.innerWidth < 640;
    card.style.width = estreito ? 'calc(100% - 28px)' : '290px';
    card.style.bottom = estreito ? '14px' : '700px';
    card.style.maxHeight = estreito ? '52vh' : 'calc(100vh - 720px)';
  }

  function instalarNav() {
    if (document.getElementById('nav-deriv')) return;
    const pai = document.querySelector('.nav-item');
    if (!pai || !pai.parentNode) return;
    const item = document.createElement('div');
    item.className = 'nav-item';
    item.id = 'nav-deriv';
    item.title = 'Deriv: conexao, velas de cambio e roteador de contrato';
    item.innerHTML = '<span class="nav-icon">\u25C8</span><span class="nav-lbl">Deriv</span>';
    item.addEventListener('click', abrir);
    const irmao = document.getElementById('nav-imperial');
    pai.parentNode.insertBefore(item, irmao ? irmao.nextSibling : null);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalarNav);
  else setTimeout(instalarNav, 300);

  window.DerivAtlas = {
    velas, conectar, propor, enviar, abrir,
    fechar() { if (card) card.style.display = 'none'; S.ligado = false; },
    estado() { return { aberto: S.aberto, erro: S.erro, conta: S.conta, saldo: S.saldo, virtual: S.virtual, papel: S.papel.length }; },
    tokenSalvo() { return !!token(); },
  };
})();
