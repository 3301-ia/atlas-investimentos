import { macd } from './macd.js';
let ok = 0, f = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { f++; console.log('  FALHA ' + n + (x ? ' :: ' + x : '')); } };
const mk = (arr) => arr.map((v, i) => ({ time: 1700000000 + i * 60, c: v }));

const alta = mk(Array.from({ length: 120 }, (_, i) => 100 + i));
const r1 = macd(alta);
t('devolve series do tamanho da entrada', r1.linha.length === 120 && r1.sinal.length === 120);
t('aquecimento com null', r1.linha[10] === null && r1.linha[30] !== null);
t('tendencia de alta', r1.estado.tendencia === 'alta');
t('macd positivo em alta', r1.estado.macd > 0);
t('histograma definido', r1.estado.histograma != null);

const baixa = mk(Array.from({ length: 120 }, (_, i) => 300 - i));
const r2 = macd(baixa);
t('tendencia de baixa', r2.estado.tendencia === 'baixa');
t('macd negativo em baixa', r2.estado.macd < 0);

// serie que sobe e depois cai: precisa registrar cruzamento de baixa
const vira = mk([...Array.from({ length: 90 }, (_, i) => 100 + i * 1.2), ...Array.from({ length: 40 }, (_, i) => 208 - i * 2.4)]);
const r3 = macd(vira);
t('detecta cruzamento', r3.estado.ultimoCruzamento != null);
t('cruzamento de baixa depois do topo', r3.estado.ultimoCruzamento.tipo === 'baixa', r3.estado.ultimoCruzamento.tipo);
t('diz quantas velas desde o cruzamento', r3.estado.velasDesdeCruzamento >= 0);

const plano = mk(Array.from({ length: 80 }, () => 150));
const r4 = macd(plano);
t('mercado parado zera o macd', Math.abs(r4.estado.macd) < 1e-6, r4.estado.macd);
t('histograma zero no parado', Math.abs(r4.estado.histograma) < 1e-6);

t('poucos candles devolve null', macd(alta.slice(0, 20)) === null);
const p = macd(alta, { rapida: 5, lenta: 13, sinal: 4 });
t('aceita parametros proprios', p.parametros.lenta === 13 && p.linha[12] !== null);
t('aceita candles com close', macd(alta.map(c => ({ time: c.time, close: c.c }))) != null);

console.log(f ? '\n' + f + ' falhas' : '\n' + ok + ' verificacoes do macd passaram');
process.exit(f ? 1 : 0);
