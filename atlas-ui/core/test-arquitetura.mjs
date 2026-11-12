// Guarda de arquitetura: as regras que mantem a tela coerente entre si.
// Nao testa numero, testa desenho — o tipo de erro que so aparece depois,
// quando alguem volta a ler o preco do lugar errado.

import { readFileSync } from 'node:fs';

let ok = 0, falhou = 0;
const t = (n, c, ex) => { if (c) { ok++; console.log('  ok  ' + n); } else { falhou++; console.log('  FALHOU  ' + n + (ex != null ? ' :: ' + ex : '')); } };

const main = readFileSync('main.js', 'utf8');
const trailing = readFileSync('trailing-atlas.js', 'utf8');

console.log('\n== fonte unica de preco ==');
t('existe o snapshot de mercado (AtlasMercado)', main.includes('window.AtlasMercado'));
t('o tick alimenta o snapshot', /function updatePriceUI\(p\)\{\s*mercadoAtualizar\(p, 'tick'\)/.test(main));
t('carregar velas tambem alimenta', main.includes("mercadoAtualizar(v[v.length-1].close, 'deriv')"));
t('o snapshot sabe a idade da leitura', main.includes('function mercadoIdade()'));
t('leitura velha pode ser recusada', main.includes('function mercadoPrecoFresco('));

console.log('\n== chip do trailing ==');
t('chip le o preco vivo, nao o fechamento da vela', trailing.includes('comPrecoVivo(plano.estado)'));
t('nao voltou a usar plano.estado direto', !/estado\s*=\s*plano\.estado;/.test(trailing));
t('distancia recalculada do preco vivo', trailing.includes('copia.distancia = +dist.toFixed(2)'));
t('percentual recalculado do preco vivo', trailing.includes('copia.distanciaPercentual'));
t('titulo mostra a idade da leitura', trailing.includes('s atrás'));

console.log('\n== segundos ==');
t('vela de segundos nasce do livro de ticks', main.includes('function livroTick('));
t('livro de segundos monta varias granularidades', main.includes('const LIVRO_SEG = [1, 5, 15, 30]'));
t('amostrador ligado enquanto o tempo for de segundos', main.includes('livroLigar(tfToSeconds('));
t('troca de tempo liga/desliga o amostrador na hora', /currentTF=tf;candles=\[\];resetLive\(\);\s*try\{ livroLigar/.test(main));
t('sem vela de segundos a tela cai para 1m', main.includes("return await fetchCandles(sym, '1m', limit)"));
t('seletor tem 1s 5s 15s 30s', ['1s', '5s', '15s', '30s'].every(v => readFileSync('index.html', 'utf8').includes('"' + v + '"')));

console.log('\n== separacao de responsabilidade ==');
t('nucleo puro do deriv nao abre socket', !readFileSync('core/deriv.js', 'utf8').includes('new WebSocket'));
t('nucleo puro do imperial nao toca no DOM', !readFileSync('core/imperial.js', 'utf8').includes('document.'));
t('nucleo puro do trailing nao toca no DOM', !readFileSync('core/trailing.js', 'utf8').includes('document.'));

console.log('\n' + (falhou ? falhou + ' falharam' : 'todas as ' + ok + ' guardas de arquitetura passaram'));
process.exit(falhou ? 1 : 0);
