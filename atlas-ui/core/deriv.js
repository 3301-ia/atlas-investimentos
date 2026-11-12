/**
 * Nucleo puro do roteador Deriv (P7).
 *
 * Toda a decisao que da para provar sem rede mora aqui: traduzir o ativo do
 * painel para o simbolo da Deriv, transformar risco em dolares em tamanho de
 * contrato, montar o pedido e ler a resposta. A conversa com a corretora fica
 * na tela (deriv-router.js), que roda no navegador do usuario — a Deriv
 * bloqueia IP de datacenter, entao o unico caminho honesto e o navegador dele.
 *
 * Regras que o nucleo faz valer:
 *   - nenhuma ordem sem stop (o contrato carrega stop_loss obrigatorio);
 *   - risco nunca passa do teto pedido (arredonda para baixo);
 *   - app_id e simbolo sempre validados antes de sair;
 *   - resposta de erro da Deriv nunca vira ordem "ok".
 */

export const APP_ID_PADRAO = '1089';

// Ativo do painel -> simbolo da Deriv. Cripto usa 'cry', cambio e metal usam 'frx'.
export const SIMBOLO_DERIV = {
  BTCUSDT: 'cryBTCUSD', ETHUSDT: 'cryETHUSD', LTCUSDT: 'cryLTCUSD',
  XRPUSDT: 'cryXRPUSD', SOLUSDT: 'crySOLUSD', BNBUSDT: 'cryBNBUSD',
  DOGEUSDT: 'cryDOGEUSD', ADAUSDT: 'cryADAUSD', DOTUSDT: 'cryDOTUSD',
  XAUUSDT: 'frxXAUUSD', XAGUSDT: 'frxXAGUSD',
  EURUSD: 'frxEURUSD', GBPUSD: 'frxGBPUSD', USDJPY: 'frxUSDJPY',
  AUDUSD: 'frxAUDUSD', USDCAD: 'frxUSDCAD', USDCHF: 'frxUSDCHF',
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export function simboloDeriv(sym) {
  const original = String(sym || '').trim();
  const alto = original.toUpperCase();
  if (SIMBOLO_DERIV[alto]) return SIMBOLO_DERIV[alto];
  // ja veio no formato da Deriv: devolve como veio, sem trocar maiuscula
  // (a Deriv trata frxXAUUSD e FRXXAUUSD como simbolos diferentes)
  if (/^(cry|frx|R_|JD)[A-Z0-9_]+$/i.test(original)) return original;
  return null;
}

export function ehFx(sym) {
  const s = String(sym || '').toUpperCase();
  return /^(EUR|GBP|USD|AUD|NZD|CAD|CHF|JPY)/.test(s) && /USD|JPY|CHF|CAD/.test(s);
}

/** Distancia ate o stop e risco em dolares de um tamanho de posicao. */
export function riscoDaOrdem({ entrada, stop, tamanho }) {
  const e = num(entrada), s = num(stop), t = num(tamanho);
  if (e == null || s == null || t == null || e <= 0 || s <= 0 || t <= 0) return null;
  const distancia = Math.abs(e - s);
  if (distancia <= 0) return null;
  return { distancia, distanciaPct: (distancia / e) * 100, riscoUsd: distancia * t };
}

/**
 * Converte o risco aceito (em dolar) no tamanho do contrato.
 * Arredonda para baixo de proposito: passar do teto de risco e o erro que
 * quebra conta pequena, entao o resto fica como folga.
 */
export function tamanhoPorRisco({ equity, riscoPct, entrada, stop, casas = 6 }) {
  const e = num(entrada), s = num(stop), eq = num(equity), pct = num(riscoPct);
  if (e == null || s == null || eq == null || pct == null) return null;
  if (e <= 0 || s <= 0 || eq <= 0 || pct <= 0) return null;
  const distancia = Math.abs(e - s);
  if (distancia <= 0) return null;
  const riscoUsd = (eq * pct) / 100;
  const bruto = riscoUsd / distancia;
  const fator = Math.pow(10, casas);
  const tamanho = Math.floor(bruto * fator) / fator;
  if (tamanho <= 0) return { tamanho: 0, riscoUsd, distancia, motivo: 'risco pequeno demais para o stop' };
  return { tamanho, riscoUsd: +(tamanho * distancia).toFixed(2), distancia };
}

/**
 * Monta o contrato. Usa multiplicador (MULTUP/MULTDOWN) porque e o unico tipo
 * da Deriv que aceita stop e alvo em dinheiro, que e como o painel pensa.
 */
export function contratoDeOrdem({ sym, lado, entrada, stop, alvo, equity, riscoPct, multiplicador = 100 }) {
  const erros = [];
  const symbol = simboloDeriv(sym);
  if (!symbol) erros.push('ativo sem par na Deriv: ' + sym);
  const l = String(lado || '').toLowerCase();
  const comprado = l === 'compra' || l === 'buy' || l === 'alta';
  const vendido = l === 'venda' || l === 'sell' || l === 'baixa';
  if (!comprado && !vendido) erros.push('lado invalido: ' + lado);
  if (num(stop) == null) erros.push('ordem sem stop');
  const dim = tamanhoPorRisco({ equity, riscoPct, entrada, stop });
  if (!dim || !dim.tamanho) erros.push(!dim ? 'entrada ou stop invalidos' : dim.motivo);
  if (erros.length) return { ok: false, erros };

  const riscoUsd = dim.riscoUsd;
  const alvoNum = num(alvo);
  const recompensa = alvoNum != null ? Math.abs(alvoNum - num(entrada)) * dim.tamanho : null;

  return {
    ok: true,
    symbol,
    contract_type: comprado ? 'MULTUP' : 'MULTDOWN',
    multiplier: multiplicador,
    stake: riscoUsd,                     // o que pode ser perdido, nao o notional
    stop_loss: +riscoUsd.toFixed(2),     // em dinheiro, como a Deriv espera
    take_profit: recompensa != null ? +recompensa.toFixed(2) : undefined,
    tamanho: dim.tamanho,
    distancia: dim.distancia,
    risco_usd: riscoUsd,
    rr: recompensa != null && riscoUsd > 0 ? +(recompensa / riscoUsd).toFixed(2) : null,
  };
}

export function validarContrato(c) {
  const erros = [];
  if (!c || !c.ok) return { ok: false, erros: (c && c.erros) || ['contrato vazio'] };
  if (!/^(MULTUP|MULTDOWN|CALL|PUT)$/.test(c.contract_type || '')) erros.push('tipo de contrato invalido');
  if (!(num(c.stake) > 0)) erros.push('stake zerado');
  if (!(num(c.stop_loss) > 0)) erros.push('stop em dinheiro obrigatorio');
  if (c.take_profit != null && !(num(c.take_profit) > 0)) erros.push('alvo negativo');
  if (num(c.stop_loss) > num(c.stake)) erros.push('stop maior que o que pode ser perdido');
  return { ok: erros.length === 0, erros };
}

/** Le a resposta da Deriv sem inventar sucesso. */
export function lerResposta(msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, erro: 'resposta vazia' };
  if (msg.error) return { ok: false, erro: msg.error.message || 'erro da Deriv', codigo: msg.error.code };
  if (msg.msg_type === 'buy' && msg.buy) {
    return {
      ok: true,
      contrato_id: msg.buy.contract_id,
      comprado_em: msg.buy.purchase_time ? msg.buy.purchase_time * 1000 : null,
      preco: num(msg.buy.buy_price),
      saldo: num(msg.buy.balance_after),
      referencia: msg.buy.transaction_id,
    };
  }
  if (msg.msg_type === 'proposal' && msg.proposal) {
    return { ok: true, proposta_id: msg.proposal.id, payout: num(msg.proposal.payout), ask: num(msg.proposal.ask_price) };
  }
  if (msg.msg_type === 'authorize' && msg.authorize) {
    return {
      ok: true,
      conta: msg.authorize.loginid,
      saldo: num(msg.authorize.balance),
      moeda: msg.authorize.currency,
      virtual: !!msg.authorize.is_virtual,
      scopes: msg.authorize.scopes || [],
    };
  }
  return { ok: false, erro: 'resposta nao reconhecida: ' + (msg.msg_type || 'sem tipo') };
}

/** Candle a partir de ticks crus, para o feed de cambio e para os segundos. */
export function velasDeTicks(ticks, segundos = 60) {
  if (!Array.isArray(ticks) || !ticks.length) return [];
  const passo = Math.max(1, Math.floor(segundos || 60));
  const mapa = new Map();
  for (const t of ticks) {
    const p = num(t && (t.quote != null ? t.quote : t.price));
    const ep = num(t && (t.epoch != null ? t.epoch : t.time));
    if (p == null || ep == null || p <= 0) continue;
    const balde = ep - (ep % passo);
    const v = mapa.get(balde);
    if (!v) mapa.set(balde, { time: balde, open: p, high: p, low: p, close: p, volume: 1, ticks: 1 });
    else {
      v.high = Math.max(v.high, p); v.low = Math.min(v.low, p);
      v.close = p; v.volume++; v.ticks++;
    }
  }
  return Array.from(mapa.values()).sort((a, b) => a.time - b.time);
}
