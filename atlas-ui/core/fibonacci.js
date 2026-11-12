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

// ─────────────────────────────────────────────────────────────────────────────
// Alternância automática (v2). O plano acima responde "qual é a última âncora
// do gráfico". O que faltava era a perna ATUAL: qual lado está no comando, em
// que ponto ela nasceu, quanto já andou e onde ela morre. Em microtempo o
// cruzamento da EMA 8/16 acontece dezenas de vezes por hora, então a âncora
// precisa trocar sozinha, sem repintar o passado e sem depender de clique.
// ─────────────────────────────────────────────────────────────────────────────

export const FIB_AUTO_VERSION = '2.0.0';

function pernaNova(candles, idx, lado, p) {
  const ini = Math.max(0, idx - p.swing);
  let pH = -Infinity, pL = Infinity;
  for (let i = ini; i < idx; i++) {
    if (candles[i].h >= pH) pH = candles[i].h;
    if (candles[i].l <= pL) pL = candles[i].l;
  }
  const alta = lado === 'alta';
  const p0 = alta ? pL : pH;
  const p1 = alta ? pH : pL;
  const range = Math.abs(p1 - p0);
  if (!isFinite(range) || range <= 0) return null;

  return {
    lado,
    p0: arred(p0), p1: arred(p1), range: arred(range),
    niveis: p.alvos.map((mult, k) => ({
      k: k + 1, mult,
      preco: arred(alta ? p1 + range * mult : p1 - range * mult),
      bateu: false, em: null
    })),
    alvoAtivo: 0,
    invalidada: false, invalidadaEm: null,
    viva: true,
    ancoraEm: candles[idx].t, ancoraEmBarra: idx,
    fimEm: null, fimBarra: null,
    extremo: arred(p1),
    eventos: []
  };
}

/**
 * Todos os gatilhos de uma perna: rompimento do extremo do impulso (entrada),
 * origem do impulso (stop) e primeiro alvo projetado.
 * A conta é a mesma do Pine: alvo = p1 + range * 0.618 na alta, espelhado na baixa.
 */
export function gatilhoDaPerna(perna, preco) {
  if (!perna) return null;
  const alta = perna.lado === 'alta';
  // Entrada no rompimento do extremo que deu origem ao impulso (p1), nao no
  // extremo que anda depois: se a entrada sobe junto com o preco, o risco
  // cresce e o primeiro alvo deixa de pagar. Com p1 fixo, risco = range.
  const entrada = perna.p1;
  const stop = perna.p0;
  const risco = Math.abs(entrada - stop);

  // O alvo 0.618 fica dentro do risco (0,618 R), entao ele serve de parada
  // parcial. O alvo do gatilho e o primeiro nivel que paga pelo menos 1,2 R.
  const niveis = perna.niveis || [];
  const parcial = niveis[0] ? niveis[0].preco : null;
  let alvo = null;
  for (let i = 0; i < niveis.length; i++) {
    if (niveis[i].bateu) continue;
    const premio = Math.abs(niveis[i].preco - entrada);
    if (risco > 0 && premio / risco >= 1.2) { alvo = niveis[i].preco; break; }
  }
  if (alvo == null && niveis.length) {
    const ultimo = niveis[niveis.length - 1].preco;
    alvo = Math.abs(ultimo - entrada) / (risco || 1) >= 0.6 ? ultimo : null;
  }

  const premio = alvo == null ? null : Math.abs(alvo - entrada);
  const rr = risco > 0 && premio != null ? arred(premio / risco, 2) : null;
  let estado = 'aguardando';
  if (perna.invalidada) estado = 'invalidado';
  else if (isFinite(preco)) {
    const rompeu = alta ? preco >= entrada : preco <= entrada;
    const perdeuStop = alta ? preco <= stop : preco >= stop;
    estado = perdeuStop ? 'invalidado' : (rompeu ? 'acionado' : 'aguardando');
  }
  return {
    lado: alta ? 'compra' : 'venda', entrada, stop, alvo, parcial,
    risco: arred(risco), rr, estado
  };
}

function resumoPerna(perna) {
  if (!perna) return null;
  return {
    lado: perna.lado,
    p0: perna.p0, p1: perna.p1, range: perna.range,
    alvoAtivo: perna.alvoAtivo,
    bateram: perna.niveis.filter(x => x.bateu).length,
    invalidada: perna.invalidada,
    ancoraEm: perna.ancoraEm,
    fimEm: perna.fimEm
  };
}

/**
 * Série de pernas alternadas do gráfico, da primeira à última.
 * Cada lado novo fecha a perna anterior e abre a seguinte: é a alternância
 * que o Pine faz visualmente e que o painel não fazia.
 */
export function fiboAuto(candles, params = {}) {
  const p = { ...FIB_PARAMS, ...params };
  const n = Array.isArray(candles) ? candles.length : 0;
  if (n < p.swing + p.lenta + 2) return null;

  const closes = candles.map(c => c.c);
  const emaR = ema(closes, p.rapida);
  const emaL = ema(closes, p.lenta);

  const fechadas = [];
  let atual = null;
  let alternancias = 0;
  let ultimaVirada = null;

  const acompanhar = (i) => {
    if (!atual || !atual.viva) return;
    const c = candles[i];
    while (atual.alvoAtivo < atual.niveis.length) {
      const niv = atual.niveis[atual.alvoAtivo];
      const bateu = atual.lado === 'alta' ? c.h >= niv.preco : c.l <= niv.preco;
      if (!bateu) break;
      niv.bateu = true; niv.em = c.t; atual.alvoAtivo++;
      atual.eventos.push({ t: c.t, tipo: 'alvo', mult: niv.mult, preco: niv.preco, barra: i });
    }
    const extremoAgora = atual.lado === 'alta' ? c.h : c.l;
    if (atual.lado === 'alta' ? extremoAgora > atual.extremo : extremoAgora < atual.extremo) {
      atual.extremo = arred(extremoAgora);
    }
    const perdeu = atual.lado === 'alta' ? c.c < atual.p0 : c.c > atual.p0;
    if (perdeu) {
      atual.invalidada = true;
      atual.invalidadaEm = c.t;
      atual.viva = false;
      atual.fimEm = c.t;
      atual.fimBarra = i;
      atual.eventos.push({ t: c.t, tipo: 'invalidada', preco: c.c, barra: i });
      fechadas.push(atual);
    }
  };

  for (let i = 1; i < n; i++) {
    const a = emaR[i - 1], b = emaL[i - 1], a1 = emaR[i], b1 = emaL[i];
    if (a == null || b == null || a1 == null || b1 == null) continue;
    let lado = null;
    if (a <= b && a1 > b1) lado = 'alta';
    else if (a >= b && a1 < b1) lado = 'baixa';

    if (lado) {
      if (atual && atual.viva) {
        atual.fimEm = candles[i].t;
        atual.fimBarra = i;
        atual.viva = false;
        fechadas.push(atual);
      }
      if (atual && atual.lado !== lado) alternancias++;
      const nova = pernaNova(candles, i, lado, p);
      if (nova) {
        nova.eventos.push({ t: candles[i].t, tipo: 'virada', preco: candles[i].c, barra: i, lado });
        atual = nova;
        ultimaVirada = { t: candles[i].t, lado, preco: candles[i].c, barra: i };
      }
    }
    acompanhar(i);
  }

  if (!atual) return null;
  const preco = candles[n - 1].c;
  return {
    versao: FIB_AUTO_VERSION,
    lado: atual.lado,
    ancoraEm: atual.ancoraEm,
    ancoraEmBarra: atual.ancoraEmBarra,
    p0: atual.p0, p1: atual.p1, range: atual.range,
    extremo: atual.extremo,
    niveis: atual.niveis,
    alvoAtivo: atual.alvoAtivo,
    alvoAtual: atual.niveis[Math.min(atual.alvoAtivo, atual.niveis.length - 1)],
    invalidada: atual.invalidada,
    viva: atual.viva && !atual.invalidada,
    extremoEm: atual.extremo,
    pernasFechadas: fechadas.length,
    alternancias,
    ultimaVirada,
    gatilho: gatilhoDaPerna(atual, preco),
    historico: fechadas.slice(-6).map(resumoPerna),
    atual: resumoPerna(atual),
    parametros: p
  };
}
