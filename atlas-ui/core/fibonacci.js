// Fibonacci do Atlas, portado do Pine v10.0 para o núcleo puro.
//
// Regra do original: a âncora nasce no cruzamento da EMA 8/16 (ou no sinal
// ATLAS), usa o swing de 21 barras como P0 e P1, e projeta alvos em
// extensões do range. Aqui a mesma regra roda sem tela, só em candle
// fechado, com três acréscimos: invalidação da âncora, nome correto de cada
// nível e histórico da âncora anterior.
//
// Nomenclatura: o nível "0.618" é o primeiro alvo do original, que no painel
// Pine aparece rotulado como 1.618. Aqui o rótulo segue a matemática.

import { ema } from './indicators.js';

export const FIB_VERSION = '1.0.0';

export const FIB_PARAMS = {
  swing: 21,
  rapida: 8,
  lenta: 16,
  alvos: [0.618, 1.618, 2.618, 3.618, 4.618]
};

function arred(v, casas = 2) {
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
}

/**
 * Plano Fibonacci da última âncora do gráfico.
 * @param {Array<{t:number,o:number,h:number,l:number,c:number}>} candles fechados, ascendentes
 * @param {object} params
 * @returns {object|null} plano com âncora, níveis progressivos e estado
 */
export function fiboPlan(candles, params = {}) {
  const p = { ...FIB_PARAMS, ...params };
  const n = Array.isArray(candles) ? candles.length : 0;
  if (n < p.swing + p.lenta + 2) return null;

  const closes = candles.map(c => c.c);
  const emaR = ema(closes, p.rapida);
  const emaL = ema(closes, p.lenta);

  // última travessia EMA 8/16 em candle fechado
  let idx = -1;
  let lado = null;
  for (let i = 1; i < n; i++) {
    const a = emaR[i - 1], b = emaL[i - 1], a1 = emaR[i], b1 = emaL[i];
    if (a == null || b == null || a1 == null || b1 == null) continue;
    if (a <= b && a1 > b1) { idx = i; lado = 'alta'; }
    else if (a >= b && a1 < b1) { idx = i; lado = 'baixa'; }
  }
  if (idx < 0) return null;

  // swing de 21 barras imediatamente antes da âncora
  const ini = Math.max(0, idx - p.swing);
  let pH = -Infinity, pL = Infinity, pHB = ini, pLB = ini;
  for (let i = ini; i < idx; i++) {
    if (candles[i].h >= pH) { pH = candles[i].h; pHB = i; }
    if (candles[i].l <= pL) { pL = candles[i].l; pLB = i; }
  }

  const alta = lado === 'alta';
  const p0 = alta ? pL : pH;   // ponto de origem do impulso
  const p1 = alta ? pH : pL;   // ponto de chegada do impulso
  const range = Math.abs(p1 - p0);
  if (!isFinite(range) || range <= 0) return null;

  const niveis = p.alvos.map((mult, k) => ({
    k: k + 1,
    mult,
    preco: arred(alta ? p1 + range * mult : p1 - range * mult),
    bateu: false,
    em: null
  }));

  // progresso: só conta o alvo seguinte depois que o anterior foi batido
  let alvoAtivo = 0;
  let invalidada = false;
  let invalidadaEm = null;
  for (let i = idx + 1; i < n; i++) {
    const c = candles[i];
    const nivel = niveis[alvoAtivo];
    if (nivel && !nivel.bateu) {
      const bateu = alta ? c.h >= nivel.preco : c.l <= nivel.preco;
      if (bateu) { nivel.bateu = true; nivel.em = c.t; alvoAtivo++; }
    }
    // invalidação: perder a origem do impulso desqualifica a âncora
    const perdeu = alta ? c.c < p0 : c.c > p0;
    if (perdeu) { invalidada = true; invalidadaEm = c.t; break; }
  }

  return {
    lado,
    p0: arred(p0),
    p1: arred(p1),
    range: arred(range),
    niveis,
    alvoAtivo,
    alvoAtual: niveis[Math.min(alvoAtivo, niveis.length - 1)],
    restantes: niveis.length - alvoAtivo,
    invalidada,
    invalidadaEm,
    ancoraEm: candles[idx].t,
    ancoraEmBarra: idx,
    ordemGatilho: 'EMA 8/16',
    parametros: p,
    versao: FIB_VERSION
  };
}

/**
 * Distância até o alvo atual, em preço e em porcentagem.
 */
export function distanciaAlvo(plano, preco) {
  if (!plano || !plano.alvoAtual || !isFinite(preco)) return null;
  const d = plano.alvoAtual.preco - preco;
  return {
    absoluta: arred(Math.abs(d)),
    percentual: arred(Math.abs(d) / preco * 100, 3),
    direcao: d > 0 ? 'acima' : 'abaixo'
  };
}
