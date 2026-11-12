// Simulador de giro e de robo espelhado, em nucleo puro.
//
// Giro simples: uma perna por vez, risco fixo em fracao do equity, cada ciclo
// acerta ou erra. Depois de acertar, o lucro volta para a conta e o proximo
// risco cresce junto. E exatamente o que acontece quando o lucro e "despejado"
// na compra seguinte.
//
// Espelhado: duas pernas opostas no mesmo ciclo. Se o mercado lateraliza, as
// duas batem no stop e o ciclo custa 2R. Se sai tendencia, uma perna morre em
// -1R e a outra corre com o alvo maior. Aqui o custo de spread entra nos dois
// modos, porque cada perna paga o seu.
//
// Resultado: expectativa por ciclo, mediana e faixa de 10% a 90% do equity
// final, probabilidade de ruina e de bater a meta. Nada de opiniao.

export const GIRO_VERSION = '1.0.0';

export const GIRO_PARAMS = {
  equity: 100,
  riscoPct: 2,        // fracao do equity arriscada por ciclo
  alvoR: 2,           // ganho em R quando acerta
  acerto: 0.45,       // fracao de ciclos vencedores
  ciclos: 100,
  spreadR: 0.05,      // custo de spread do ciclo, em R
  modo: 'simples',    // 'simples' | 'espelhado'
  alvoMultiplo: 2,    // meta: dobrar o equity
  pisoRuina: 0.4,     // conta abaixo disso conta como ruina
  caminhos: 2000,
  semente: 7
};

function rng(semente) {
  let s = semente >>> 0 || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function arred(v, casas = 2) {
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
}

/** Expectativa matematica de um ciclo, em R. */
export function expectativa(params = {}) {
  const p = { ...GIRO_PARAMS, ...params };
  if (p.modo === 'espelhado') {
    // acerto = ciclo direcional: perde 1R na perna morta e ganha alvoR na viva
    const ganho = p.alvoR - 1 - 2 * p.spreadR;
    const perda = 2 + 2 * p.spreadR;      // lateralidade: duas pernas param
    return {
      ganhoR: arred(ganho, 3),
      perdaR: arred(perda, 3),
      evR: arred(p.acerto * ganho - (1 - p.acerto) * perda, 4),
      acertoNeutro: arred(perda / (ganho + perda) * 100, 1)
    };
  }
  const ganho = p.alvoR - p.spreadR;
  const perda = 1 + p.spreadR;
  return {
    ganhoR: arred(ganho, 3),
    perdaR: arred(perda, 3),
    evR: arred(p.acerto * ganho - (1 - p.acerto) * perda, 4),
    acertoNeutro: arred(perda / (ganho + perda) * 100, 1)
  };
}

/**
 * Simula caminhos e devolve a distribuicao final.
 */
export function simular(params = {}) {
  const p = { ...GIRO_PARAMS, ...params };
  if (!(p.equity > 0) || !(p.ciclos > 0)) return null;
  const risco = p.riscoPct / 100;
  const ev = expectativa(p);
  const rnd = rng(p.semente);

  const finais = [];
  let ruinas = 0, metas = 0, melhorPior = null;

  for (let c = 0; c < p.caminhos; c++) {
    let eq = p.equity;
    let pior = eq;
    for (let i = 0; i < p.ciclos; i++) {
      const venceu = rnd() < p.acerto;
      const riscoAgora = eq * risco;
      const resultadoR = venceu ? ev.ganhoR : -ev.perdaR;
      eq += riscoAgora * resultadoR;
      if (eq < pior) pior = eq;
      if (eq <= p.equity * p.pisoRuina) { eq = Math.max(eq, 0); break; }
    }
    finais.push(eq);
    if (eq <= p.equity * p.pisoRuina) ruinas++;
    if (eq >= p.equity * p.alvoMultiplo) metas++;
    if (melhorPior == null || pior / p.equity < melhorPior) melhorPior = pior / p.equity;
  }

  finais.sort((a, b) => a - b);
  const pega = q => finais[Math.min(finais.length - 1, Math.max(0, Math.floor(q * finais.length)))];
  const mediana = pega(0.5);

  return {
    versao: GIRO_VERSION,
    parametros: p,
    expectativa: ev,
    mediana: arred(mediana),
    p10: arred(pega(0.1)),
    p90: arred(pega(0.9)),
    multiploMediano: arred(mediana / p.equity, 2),
    ruinaPct: arred(ruinas / p.caminhos * 100, 1),
    metaPct: arred(metas / p.caminhos * 100, 1),
    piorDrawdownPct: arred((1 - melhorPior) * 100, 1),
    temVantagem: ev.evR > 0
  };
}

/**
 * Quanto tempo leva para multiplicar a conta, no cenario mediano.
 */
export function escada(params = {}) {
  const p = { ...GIRO_PARAMS, ...params };
  const r = simular(p);
  if (!r) return null;
  const multiplicador = r.multiploMediano;
  const crescPorCiclo = multiplicador > 0 ? Math.pow(multiplicador, 1 / p.ciclos) : 0;
  const paraDobrar = crescPorCiclo > 1 ? Math.log(2) / Math.log(crescPorCiclo) : null;
  return {
    multiplicadorMediano: multiplicador,
    ciclosParaDobrar: paraDobrar ? Math.round(paraDobrar) : null,
    cruzaMeta: r.metaPct
  };
}
