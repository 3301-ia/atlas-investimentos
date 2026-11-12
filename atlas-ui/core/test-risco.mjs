import { dimensionar, disjuntores, verificarHierarquia, folgaDiaria } from './risco.js';
let ok = 0, f = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { f++; console.log('  FALHA ' + n + (x ? ' :: ' + x : '')); } };

// conta real dele: 130 de equity, risco 2%, entrada 73136, stop 73214 (no lucro)
const d1 = dimensionar({ equity: 130, riscoPct: 2, entrada: 73000, stop: 72400 });
t('tamanho calculado', d1.ok && Math.abs(d1.tamanho - 0.4333) < 0.01, d1.tamanho);
t('risco em dolar e 2,6', Math.abs(d1.riscoUSD - 2.6) < 0.01, d1.riscoUSD);
t('arredonda para baixo no lote', d1.tamanhoArredondado <= d1.tamanho);

const semStop = dimensionar({ equity: 130, riscoPct: 2, entrada: 73000 });
t('sem stop recusa', semStop.ok === false && /stop obrigatorio/.test(semStop.motivos.join(' ')), semStop.motivos);

const riscoAlto = dimensionar({ equity: 130, riscoPct: 10, entrada: 73000, stop: 72400 });
t('risco acima do teto recusa', riscoAlto.ok === false && /teto/.test(riscoAlto.motivos.join(' ')));

const stopIgual = dimensionar({ equity: 130, riscoPct: 2, entrada: 73000, stop: 73000 });
t('stop igual a entrada recusa', stopIgual.ok === false);

const dj = disjuntores({
  equity: 124, equityInicioDia: 130,
  posicoes: [{ stop: 73000, riscoPct: 2, lucroUSD: 5 }],
  parametros: { tetoPosicoes: 3 }
});
t('liberado com uma posicao protegida', dj.liberado === true, dj.travas.join('|'));
t('perda do dia calculada', Math.abs(dj.perdaDiaPct - 4.62) < 0.05, dj.perdaDiaPct);
t('avisa perto do limite', dj.avisos.some(a => /perto do limite/.test(a)));

const travaPerda = disjuntores({ equity: 120, equityInicioDia: 130, posicoes: [] });
t('trava quando a perda do dia estoura', travaPerda.liberado === false && /perda diaria/.test(travaPerda.travas.join(' ')));

const travaSemStop = disjuntores({ equity: 130, equityInicioDia: 130, posicoes: [{ lucroUSD: 3 }] });
t('trava posicao sem stop', travaSemStop.liberado === false && /sem stop/.test(travaSemStop.travas.join(' ')));

const travaTeto = disjuntores({ equity: 130, equityInicioDia: 130, posicoes: [{ stop: 1 }, { stop: 2 }, { stop: 3 }] });
t('trava no teto de posicoes', travaTeto.liberado === false && /teto/.test(travaTeto.travas.join(' ')), travaTeto.travas.join('|'));

const h1 = verificarHierarquia([
  { nome: 'agenciado A', limite: 1000 },
  { nome: 'sub B', limite: 1500, superior: 'agenciado A' }
]);
t('hierarquia pega limite maior', h1.length === 1 && /acima do superior/.test(h1[0]), h1);
const h2 = verificarHierarquia([
  { nome: 'agenciado A', limite: 1000 },
  { nome: 'sub B', limite: 800, superior: 'agenciado A' }
]);
t('hierarquia correta passa', h2.length === 0);
const h3 = verificarHierarquia([{ nome: 'sub C', limite: 10, superior: 'ninguem' }]);
t('hierarquia pega superior inexistente', h3.length === 1 && /inexistente/.test(h3[0]));

const fl = folgaDiaria(124, 130);
t('folga diaria calculada', fl && Math.abs(fl.limiteUSD - 7.8) < 0.01 && Math.abs(fl.perdidoUSD - 6) < 0.01, JSON.stringify(fl));
t('folga restante coerente', Math.abs(fl.restanteUSD - 1.8) < 0.01, fl.restanteUSD);

console.log(f ? '\n' + f + ' falhas' : '\n' + ok + ' verificacoes de risco passaram');
process.exit(f ? 1 : 0);
