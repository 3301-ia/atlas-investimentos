// Medidor de viradas: quantas vezes a estrutura troca de lado, quanto custa
// cada troca e quanto sobra por ciclo.
//
// A regra de virada e a mesma do trailing do painel: Chandelier com catraca,
// stop a k vezes o ATR do extremo de N barras. Quando o fechamento perde o
// stop, o lado vira e o ciclo fecha. Cada virada paga o spread uma vez.
//
// O ponto central do medidor: comparar o custo do spread com a distancia do
// stop. Acima de 10% a virada vira pedagio e o ciclo nao paga a conta.

export const VIRADAS_VERSION = '1.0.0';

export const VIRADAS_PARAMS = {
  atr: 14,
  mult: 2.5,
  janela: 22,
  spread: 40        // em preco, na moeda do ativo
};

function atrSerie(v, periodo) {
  const n = v.length;
  const tr = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) { tr[i] = v[i].h - v[i].l; continue; }
    const pc = v[i - 1].c;
    tr[i] = Math.max(v[i].h - v[i].l, Math.abs(v[i].h - pc), Math.abs(v[i].l - pc));
  }
  const out = new Array(n).fill(null);
  if (n < periodo) return out;
  let s = 0;
  for (let i = 0; i < periodo; i++) s += tr[i];
  out[periodo - 1] = s / periodo;
  for (let i = periodo; i < n; i++) out[i] = (out[i - 1] * (periodo - 1) + tr[i]) / periodo;
  return out;
}

/**
 * Agrega velas de um tempo base para um tempo maior. Fator 4 em 15m vira 1H.
 * @param {Array} velas
 * @param {number} fator
 */
export function agregar(velas, fator) {
  if (!Array.isArray(velas) || fator < 2 || velas.length < 3) return [];
  // tamanho da vela de origem vem da propria serie
  let intervalo = velas[1].time - velas[0].time;
  for (let i = 2; i < Math.min(velas.length, 20); i++) {
    const d = velas[i].time - velas[i - 1].time;
    if (d > 0 && (intervalo <= 0 || d < intervalo)) intervalo = d;
  }
  if (!(intervalo > 0)) return [];
  const janela = intervalo * fator;
  const balde = new Map();
  velas.forEach(v => {
    const t = Math.floor(v.time / janela) * janela;
    const atual = balde.get(t);
    if (!atual) {
      balde.set(t, { time: t, o: v.o, h: v.h, l: v.l, c: v.c });
    } else {
      atual.h = Math.max(atual.h, v.h);
      atual.l = Math.min(atual.l, v.l);
      atual.c = v.c;
    }
  });
  return [...balde.values()].sort((a, b) => a.time - b.time);
}

/**
 * Mede as viradas de uma serie.
 * @param {Array<{time:number,o:number,h:number,l:number,c:number}>} velas
 * @param {{atr?:number,mult?:number,janela?:number,spread?:number}} params
 */
export function medirViradas(velas, params = {}) {
  const p = { ...VIRADAS_PARAMS, ...params };
  const v = Array.isArray(velas) ? velas : [];
  if (v.length < p.janela + p.atr + 5) return null;

  const a = atrSerie(v, p.atr);
  const atrs = a.filter(x => x != null);
  const atrMedio = atrs.length ? atrs.reduce((x, y) => x + y, 0) / atrs.length : null;
  if (!atrMedio) return null;

  const ciclos = [];
  let lado = 0, extremo = null, entrada = 0;

  for (let i = p.janela; i < v.length; i++) {
    const A = a[i];
    if (!A) continue;
    const c = v[i].c;
    if (lado === 0) {
      lado = c >= v[i - 1].c ? 1 : -1;
      extremo = c; entrada = c;
      continue;
    }
    extremo = lado === 1 ? Math.max(extremo, c) : Math.min(extremo, c);
    const stop = lado === 1 ? extremo - p.mult * A : extremo + p.mult * A;
    const virou = lado === 1 ? c < stop : c > stop;
    if (!virou) continue;
    const brutoAtr = ((c - entrada) * lado) / A;
    const spreadAtr = p.spread / A;
    ciclos.push({
      time: v[i].time,
      lado: lado === 1 ? 'alta' : 'baixa',
      entrada,
      saida: c,
      brutoAtr: arred(brutoAtr, 3),
      custoAtr: arred(spreadAtr, 3),
      custoPct: arred(spreadAtr / (p.mult) * 100, 1),
      liquidoAtr: arred(brutoAtr - spreadAtr, 3),
      stopPreco: arred(p.mult * A)
    });
    lado = -lado; extremo = c; entrada = c;
  }

  if (!ciclos.length) return null;

  const bruto = ciclos.reduce((x, y) => x + y.brutoAtr, 0);
  const custo = ciclos.reduce((x, y) => x + y.custoAtr, 0);
  const liquido = bruto - custo;
  const custoPctMedio = ciclos.reduce((x, y) => x + y.custoPct, 0) / ciclos.length;
  const positivos = ciclos.filter(x => x.liquidoAtr > 0).length;
  const ruido = ciclos.filter(x => Math.abs(x.brutoAtr) < 0.5).length;

  return {
    versao: VIRADAS_VERSION,
    parametros: p,
    velas: v.length,
    atrMedio: arred(atrMedio),
    ciclos,
    totalViradas: ciclos.length,
    brutoAtr: arred(bruto, 2),
    custoAtr: arred(custo, 2),
    liquidoAtr: arred(liquido, 2),
    porCiclo: arred(liquido / ciclos.length, 3),
    custoMedioPctDoStop: arred(custoPctMedio, 1),
    aproveitamento: arred(positivos / ciclos.length * 100, 1),
    ruidoPct: arred(ruido / ciclos.length * 100, 1),
    veredito: custoPctMedio <= 10
      ? 'spread baixo para este tempo'
      : custoPctMedio <= 25
        ? 'spread no limite: virada cara'
        : 'spread alto: a virada come o ciclo'
  };
}

function arred(v, casas = 2) {
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
}
