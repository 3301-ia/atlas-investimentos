import { simboloDeriv, ehFx, riscoDaOrdem, tamanhoPorRisco, contratoDeOrdem,
         validarContrato, lerResposta, velasDeTicks, APP_ID_PADRAO } from './deriv.js';

let ok = 0, falhou = 0;
const t = (n, c, ex) => { if (c) { ok++; console.log('  ok  ' + n); } else { falhou++; console.log('  FALHOU  ' + n + (ex != null ? ' :: ' + JSON.stringify(ex) : '')); } };

console.log('\n== simbolos ==');
t('BTC do painel vira cryBTCUSD', simboloDeriv('BTCUSDT') === 'cryBTCUSD');
t('EURUSD vira frxEURUSD', simboloDeriv('EURUSD') === 'frxEURUSD');
t('aceita simbolo ja da Deriv', simboloDeriv('frxXAUUSD') === 'frxXAUUSD');
t('ativo desconhecido devolve nulo', simboloDeriv('POLUSDT') === null);
t('reconhece cambio', ehFx('EURUSD') && !ehFx('BTCUSDT'));
t('app id 1089 por padrao', APP_ID_PADRAO === '1089');

console.log('\n== tamanho por risco ==');
const dim = tamanhoPorRisco({ equity: 100, riscoPct: 2, entrada: 71000, stop: 72000 });
t('risco de 2% de 100 = 2 dolares', dim.riscoUsd <= 2 && dim.riscoUsd > 0, dim);
t('tamanho nao passa do teto', +(dim.tamanho * dim.distancia).toFixed(4) <= 2);
const aperto = tamanhoPorRisco({ equity: 100, riscoPct: 2, entrada: 71000, stop: 71001 });
t('risco dividido por stop curto', Math.abs(aperto.riscoUsd - 2) < 0.01, aperto);
t('stop igual a entrada devolve nulo', tamanhoPorRisco({ equity: 100, riscoPct: 2, entrada: 100, stop: 100 }) === null);
t('equity zero devolve nulo', tamanhoPorRisco({ equity: 0, riscoPct: 2, entrada: 100, stop: 90 }) === null);
t('risco minusculo avisa', tamanhoPorRisco({ equity: 1, riscoPct: 0.01, entrada: 71000, stop: 72000 }).tamanho === 0);

console.log('\n== contrato ==');
const c = contratoDeOrdem({ sym: 'BTCUSDT', lado: 'venda', entrada: 71200, stop: 72100, alvo: 69400, equity: 100, riscoPct: 2 });
t('montou contrato', c.ok === true, c.erros);
t('lado venda vira MULTDOWN', c.contract_type === 'MULTDOWN');
t('stop em dinheiro igual ao risco', c.stop_loss === c.risco_usd, { s: c.stop_loss, r: c.risco_usd });
t('alvo calculado em dinheiro', c.take_profit > 0 && c.take_profit > c.stop_loss);
t('rr do contrato', c.rr > 1.5, c.rr);
t('validacao aprova', validarContrato(c).ok === true);
t('compra vira MULTUP', contratoDeOrdem({ sym: 'ETHUSDT', lado: 'compra', entrada: 100, stop: 95, alvo: 110, equity: 100, riscoPct: 2 }).contract_type === 'MULTUP');
t('ordem sem stop e recusada', contratoDeOrdem({ sym: 'BTCUSDT', lado: 'venda', entrada: 71200, equity: 100, riscoPct: 2 }).ok === false);
t('ativo sem par e recusado', contratoDeOrdem({ sym: 'POLUSDT', lado: 'venda', entrada: 10, stop: 11, equity: 100, riscoPct: 2 }).ok === false);
t('validar recusa stop maior que stake', validarContrato({ ok: true, contract_type: 'MULTUP', stake: 2, stop_loss: 5 }).ok === false);

console.log('\n== resposta da corretora ==');
t('erro da Deriv nunca vira sucesso', lerResposta({ error: { message: 'Token invalido', code: 'InvalidToken' } }).ok === false);
t('compra lida', lerResposta({ msg_type: 'buy', buy: { contract_id: 123, buy_price: 2, balance_after: 98, purchase_time: 1700000000 } }).contrato_id === 123);
t('autorizacao lida', lerResposta({ msg_type: 'authorize', authorize: { loginid: 'VR1', balance: 100, currency: 'USD', is_virtual: 1 } }).virtual === true);
t('resposta estranha nao vira ordem', lerResposta({ msg_type: 'tick' }).ok === false);
t('resposta nula nao quebra', lerResposta(null).ok === false);

console.log('\n== velas de tick ==');
const ticks = [];
for (let i = 0; i < 300; i++) ticks.push({ epoch: 1700000000 + i, quote: 70000 + (i % 7) });
const v60 = velasDeTicks(ticks, 60);
// 300 ticks de 1s que comecam no segundo :20 atravessam 6 baldes de minuto
t('agrupou em 6 velas de 1 minuto', v60.length === 6, v60.length);
t('a primeira abre no preco do primeiro tick', v60[0].open === 70000, v60[0]);
t('volume conta os ticks', v60.reduce((a, b) => a + b.volume, 0) === 300);
const v1 = velasDeTicks(ticks, 1);
t('1 segundo da uma vela por tick', v1.length === 300, v1.length);
t('tick invalido e descartado', velasDeTicks([{ epoch: 1, quote: null }, { epoch: 2, quote: 5 }], 1).length === 1);
t('lista vazia devolve vazio', velasDeTicks([], 60).length === 0);
t('nulo devolve vazio', velasDeTicks(null, 60).length === 0);

console.log('\n' + (falhou ? falhou + ' falharam' : 'todas as ' + ok + ' provas do roteador Deriv passaram'));
process.exit(falhou ? 1 : 0);
