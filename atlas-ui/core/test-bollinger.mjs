import { bandas } from './bollinger.js';
let ok = 0, f = 0;
const t = (n, c, x) => { if (c) { ok++; console.log('  ok  ' + n); } else { f++; console.log('  FALHA ' + n + (x ? ' :: ' + x : '')); } };
const mk = (arr) => arr.map((v, i) => ({ time: 1700000000 + i * 60, c: v }));

const preco = Array.from({ length: 100 }, () => 100);
const r0 = bandas(preco.map((v, i) => ({ time: i, c: v })));
t('serie plana: bandas coladas na media', Math.abs(r0.estado.superior - 100) < 1e-9 && Math.abs(r0.estado.inferior - 100) < 1e-9);
t('serie plana: dentro da banda', r0.estado.posicao === 'dentro');
t('serie plana: largura zero', Math.abs(r0.estado.larguraPercentual) < 1e-9);

const alta = mk(Array.from({ length: 100 }, (_, i) => 100 + i * 0.8));
const r1 = bandas(alta);
t('media entre as bandas', r1.estado.superior > r1.estado.media && r1.estado.media > r1.estado.inferior);
t('preco acima da media na alta', r1.estado.posicaoRelativa > 0.5, r1.estado.posicaoRelativa);
t('largura coerente', r1.estado.larguraPercentual > 0 && r1.estado.larguraPercentual < 20, r1.estado.larguraPercentual);

// preco rompendo para cima da banda superior
const rompe = mk([...Array.from({ length: 60 }, () => 100), 140]);
const r2 = bandas(rompe);
t('rompimento acima da banda', r2.estado.posicao === 'acima', r2.estado.posicao);

const afunda = mk([...Array.from({ length: 60 }, () => 100), 60]);
t('queda abaixo da banda', bandas(afunda).estado.posicao === 'abaixo');

// compressao: movimentos grandes e depois mercado parado
const comprime = mk([...Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 12), ...Array.from({ length: 40 }, () => 100)]);
const r3 = bandas(comprime);
t('detecta compressao depois da volatilidade', r3.estado.squeeze === true, r3.estado.compressaoPercentual);
t('compressao abaixo de 40%', r3.estado.compressaoPercentual <= 40);

t('poucos candles devolve null', bandas(alta.slice(0, 10)) === null);
t('aceita parametros proprios', bandas(alta, { periodo: 10, desvios: 3 }).estado.superior > bandas(alta, { periodo: 10, desvios: 2 }).estado.superior);
t('aceita candles com close', bandas(alta.map(c => ({ close: c.c }))) != null);
t('largura alinhada ao tamanho', r1.largura.length === 100 && r1.largura[5] === null);

console.log(f ? '\n' + f + ' falhas' : '\n' + ok + ' verificacoes do bollinger passaram');
process.exit(f ? 1 : 0);
