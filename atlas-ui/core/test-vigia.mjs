import { avaliarPosicao, fraseEstado } from './vigia.js';
let ok = 0, f = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { f++; console.log('  FALHA ' + n + (x ? ' :: ' + x : '')); } };

// posicao real dele: entrada 73136.264, 0.01 lote, stop 73831.198
const p = { lado: 'compra', entrada: 73136.264, lote: 0.01, stop: 73831.198, alvo: 74317.122 };
const a = avaliarPosicao(p, 73917.298);
t('lucro bate com a corretora (7.81)', Math.abs(a.lucroUSD - 7.81) < 0.02, a.lucroUSD);
t('stop no lucro', a.stopNoLucro === true);
t('lucro travado calculado', Math.abs(a.lucroTravadoUSD - 6.95) < 0.02, a.lucroTravadoUSD);
t('R de 1.12', Math.abs(a.r - 1.12) < 0.02, a.r);
t('risco/retorno 1.70', Math.abs(a.riscoRetorno - 1.70) < 0.02, a.riscoRetorno);
t('stop no lucro e perto: acusa', a.estado === 'stop_travado_perto', a.estado);
t('frase do stop travado menciona o valor', fraseEstado(a).includes('travando'));

const b = avaliarPosicao(p, 73850);
t('perto do stop avisa', b.estado === 'stop_travado_perto' || b.estado === 'stop_proximo', b.estado);
const semProtecao = avaliarPosicao({ lado: 'compra', entrada: 74000, lote: 0.01, stop: 73500 }, 73620);
t('stop sem lucro, perto: stop_proximo', semProtecao.estado === 'stop_proximo', semProtecao.estado);

const c = avaliarPosicao(p, 73831.198);
t('stop atingido', c.estado === 'stop_atingido', c.estado);

const d = avaliarPosicao(p, 74320);
t('alvo atingido', d.estado === 'alvo_atingido', d.estado);
t('frase do alvo', fraseEstado(d).includes('Alvo'));

const semStop = avaliarPosicao({ lado: 'compra', entrada: 73136.264, lote: 0.01 }, 73900);
t('sem stop acusa', semStop.estado === 'sem_stop' && semStop.alertar === true);

const venda = avaliarPosicao({ lado: 'venda', entrada: 74000, lote: 0.01, stop: 74400, alvo: 73200 }, 73800);
t('venda em lucro', Math.abs(venda.lucroUSD - 2) < 0.01, venda.lucroUSD);
t('venda: stop acima trava lucro', venda.stopNoLucro === false);
t('venda perto do alvo', avaliarPosicao({ lado: 'venda', entrada: 74000, lote: 0.01, stop: 74400, alvo: 73200 }, 73250).estado === 'alvo_proximo');

t('entrada invalida devolve null', avaliarPosicao({ lado: 'compra', entrada: 0, lote: 0.01 }, 100) === null);
t('preco invalido devolve null', avaliarPosicao(p, NaN) === null);
t('lucro negativo funciona', avaliarPosicao(p, 73000).lucroUSD < 0);

console.log(f ? '\n' + f + ' falhas' : '\n' + ok + ' verificacoes do vigia passaram');
process.exit(f ? 1 : 0);
