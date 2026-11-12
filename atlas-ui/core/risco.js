// Dimensionamento e disjuntores do Atlas, em nucleo puro.
//
// Duas coisas que precisam ser matematica e nao decisao de humor:
//
// 1) tamanho da posicao a partir do risco em fracao do equity e da distancia
//    do stop. Sem stop, nao ha tamanho: a funcao recusa.
// 2) disjuntores que travam a operacao: perda diaria estourada, teto de
//    posicoes, risco por operacao acima do limite, hierarquia de limite entre
//    agenciado e subagenciado, e posicao que perdeu o stop.
//
// A regra que veio da operacao real: subagenciado nunca pode ter limite maior
// que o agenciado. Aqui isso e uma checagem, nao uma recomendacao.

export const RISCO_VERSION = '1.0.0';

export const RISCO_PARAMS = {
  riscoMaxPctTrade: 2,      // teto de risco por operacao, em % do equity
  perdaDiariaMaxPct: 6,     // perda maxima no dia, em % do equity
  tetoPosicoes: 3,          // posicoes simultaneas
  valorPorPontoLote: 0.01   // para BTC: 0,01 lote = 1 dolar por dolar de preco
};

function arred(v, casas = 2) {
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
}

/**
 * Tamanho da posicao.
 * @param {{equity:number, riscoPct?:number, entrada:number, stop:number, valorPorPonto?:number}} dados
 */
export function dimensionar(dados = {}) {
  const equity = Number(dados.equity);
  const entrada = Number(dados.entrada);
  const stop = Number(dados.stop);
  const riscoPct = dados.riscoPct != null ? Number(dados.riscoPct) : RISCO_PARAMS.riscoMaxPctTrade;
  const valorPorPonto = dados.valorPorPonto != null ? Number(dados.valorPorPonto) : RISCO_PARAMS.valorPorPontoLote;

  const motivos = [];
  if (!(equity > 0)) motivos.push('equity invalido');
  if (!(entrada > 0)) motivos.push('entrada invalida');
  if (!(stop > 0)) motivos.push('stop obrigatorio: sem stop nao existe tamanho');
  if (entrada > 0 && stop > 0 && entrada === stop) motivos.push('stop igual a entrada');
  if (!(riscoPct > 0)) motivos.push('risco invalido');
  if (riscoPct > RISCO_PARAMS.riscoMaxPctTrade) motivos.push('risco acima do teto de ' + RISCO_PARAMS.riscoMaxPctTrade + '%');
  if (!(valorPorPonto > 0)) motivos.push('valor por ponto invalido');

  if (motivos.length) return { ok: false, motivos, tamanho: null, riscoUSD: null };

  const distancia = Math.abs(entrada - stop);
  const riscoUSD = equity * (riscoPct / 100);
  const tamanho = riscoUSD / (distancia * valorPorPonto);

  return {
    ok: true,
    motivos: [],
    distancia: arred(distancia),
    riscoUSD: arred(riscoUSD),
    riscoPct: arred(riscoPct, 2),
    tamanho: arred(tamanho, 4),
    tamanhoArredondado: Math.floor(tamanho * 100) / 100,
    valorPorPonto,
    stopNaEntrada: stop
  };
}

/**
 * Disjuntores. Recebe o estado da conta e devolve o que esta travado.
 * @param {object} estado
 */
export function disjuntores(estado = {}) {
  const p = { ...RISCO_PARAMS, ...(estado.parametros || {}) };
  const equity = Number(estado.equity);
  const equityInicioDia = Number(estado.equityInicioDia);
  const posicoes = Array.isArray(estado.posicoes) ? estado.posicoes : [];
  const resultadoDia = Number(estado.resultadoDia || 0);

  const travas = [];
  const avisos = [];

  let perdaDiaPct = null;
  if (equity > 0 && equityInicioDia > 0) {
    perdaDiaPct = arred((1 - equity / equityInicioDia) * 100, 2);
    if (perdaDiaPct >= p.perdaDiariaMaxPct) {
      travas.push('perda diaria de ' + perdaDiaPct + '% atingiu o limite de ' + p.perdaDiariaMaxPct + '%');
    } else if (perdaDiaPct >= p.perdaDiariaMaxPct * 0.7) {
      avisos.push('perda diaria em ' + perdaDiaPct + '%, perto do limite');
    }
  }

  if (posicoes.length >= p.tetoPosicoes) {
    travas.push('teto de ' + p.tetoPosicoes + ' posicoes atingido');
  }

  const semStop = posicoes.filter(x => x && (x.stop == null || !(Number(x.stop) > 0)));
  if (semStop.length) {
    travas.push(semStop.length + ' posicao(oes) sem stop');
  }

  const acimaDoRisco = posicoes.filter(x => {
    const risco = Number(x && x.riscoPct);
    return isFinite(risco) && risco > p.riscoMaxPctTrade;
  });
  if (acimaDoRisco.length) {
    travas.push(acimaDoRisco.length + ' posicao(oes) com risco acima de ' + p.riscoMaxPctTrade + '%');
  }

  const perdas = posicoes.filter(x => Number(x && x.lucroUSD) < 0);
  if (perdas.length >= 2) {
    avisos.push(perdas.length + ' posicoes no negativo ao mesmo tempo');
  }

  if (resultadoDia > 0 && equity > 0 && resultadoDia / equity > 0.1) {
    avisos.push('dia acima de 10% de ganho: cuidado com reforco de lote');
  }

  const hierarquia = verificarHierarquia(estado.agenciados || []);
  hierarquia.forEach(h => travas.push(h));

  return {
    versao: RISCO_VERSION,
    parametros: p,
    liberado: travas.length === 0,
    travas,
    avisos,
    perdaDiaPct,
    posicoesAbertas: posicoes.length,
    margem: p.tetoPosicoes - posicoes.length
  };
}

/**
 * Subagenciado nao pode ter limite maior que o agenciado.
 * @param {Array<{nome:string, limite:number, superior?:string, subagenciados?:string[]}>} lista
 */
export function verificarHierarquia(lista) {
  const problemas = [];
  const porNome = new Map((lista || []).map(x => [x.nome, x]));
  (lista || []).forEach(x => {
    if (!x || !x.superior) return;
    const pai = porNome.get(x.superior);
    if (!pai) { problemas.push(x.nome + ' aponta para superior inexistente: ' + x.superior); return; }
    if (Number(x.limite) > Number(pai.limite)) {
      problemas.push(x.nome + ' tem limite ' + x.limite + ' acima do superior ' + pai.nome + ' (' + pai.limite + ')');
    }
  });
  return problemas;
}

/** Quanto ainda pode perder hoje, em dolar. */
export function folgaDiaria(equity, equityInicioDia, params = {}) {
  const p = { ...RISCO_PARAMS, ...params };
  if (!(equity > 0) || !(equityInicioDia > 0)) return null;
  const limiteUSD = equityInicioDia * (p.perdaDiariaMaxPct / 100);
  const perdido = Math.max(0, equityInicioDia - equity);
  return {
    limiteUSD: arred(limiteUSD),
    perdidoUSD: arred(perdido),
    restanteUSD: arred(Math.max(0, limiteUSD - perdido))
  };
}
