// Testes do núcleo de alertas. Roda sem tela: node core/test-alertas.mjs
import assert from 'node:assert/strict';
import {
  cruzamentoMedia, swingFib, precoDoNivel, avaliar, estadoInicial,
  distancia, rotulo, assinarAlerta, ALERTA_PARAMS,
} from './alertas.js';

let ok = 0;
function t(nome, fn) { fn(); ok++; console.log('  ok  ' + nome); }

// série que sobe, corrige e rompe de novo; usada para achar as travessias
function velas(closes) {
  return closes.map((c, i) => ({ t: 1700000000 + i * 60, o: c, h: c + 5, l: c - 5, c }));
}

const queda = [];
for (let i = 0; i < 40; i++) queda.push(100 - i * 0.5);
const alta = [];
for (let i = 0; i < 25; i++) alta.push(80 + i * 1.2);
const serie = velas([...queda, ...alta]);

t('cruzamento de médias encontra a perna de alta', () => {
  const c = cruzamentoMedia(serie, 9, 18);
  assert.equal(c.lado, 'alta');
  assert.ok(c.t > serie[20].t);
  assert.ok(c.rapida > c.lenta);
});

t('série curta não inventa cruzamento', () => {
  assert.equal(cruzamentoMedia(velas([1, 2, 3]), 9, 18), null);
});

t('swing e níveis de Fibonacci batem com a conta', () => {
  const cs = velas([100, 110, 120, 90, 95, 105, 115, 125, 130]);
  const s = swingFib(cs, 21);
  assert.equal(s.alto, 135);   // 130 + 5 de máxima
  assert.equal(s.baixo, 85);   // 90 - 5 de mínima
  assert.equal(s.direcao, 'alta'); // fundo antes do topo => perna de alta
  const meio = precoDoNivel(cs, 0.5, 21);
  assert.ok(Math.abs(meio - (135 - 50 * 0.5)) < 0.001);
  assert.ok(Math.abs(precoDoNivel(cs, 0.618, 21) - (135 - 50 * 0.618)) < 0.001);
});

t('alerta de preço dispara uma vez e rearma depois de voltar', () => {
  const a = { tipo: 'preco', direcao: 'acima', preco: 105 };
  let est = estadoInicial();

  let r = avaliar(a, est, { preco: 100, candles: serie, agora: 1 });  // primeira leitura
  assert.equal(r.disparou, false);
  est = r.estado;

  r = avaliar(a, est, { preco: 104, candles: serie, agora: 2 });
  assert.equal(r.disparou, false);
  est = r.estado;

  r = avaliar(a, est, { preco: 105.5, candles: serie, agora: 3 });
  assert.equal(r.disparou, true);
  assert.equal(r.evento.lado, 'alta');
  assert.equal(r.evento.alvo, 105);
  est = r.estado;

  // mesmo movimento: não repete
  r = avaliar(a, est, { preco: 106.2, candles: serie, agora: 4 });
  assert.equal(r.disparou, false);
  est = r.estado;

  // volta para longe do alvo e rearma
  r = avaliar(a, est, { preco: 103, candles: serie, agora: 5 });
  assert.equal(r.disparou, false);
  est = r.estado;

  // rompe de novo: dispara outra vez
  r = avaliar(a, est, { preco: 105.4, candles: serie, agora: 6 });
  assert.equal(r.disparou, true);
  assert.equal(r.estado.disparos, 2);
});

t('direção filtra o lado do disparo', () => {
  const a = { tipo: 'preco', direcao: 'abaixo', preco: 95 };
  let est = estadoInicial();
  est = avaliar(a, est, { preco: 100, candles: serie }).estado;
  const r = avaliar(a, est, { preco: 99, candles: serie });
  assert.equal(r.disparou, false, 'subida não deve disparar alerta de queda');
  const r2 = avaliar(a, r.estado, { preco: 94.9, candles: serie });
  assert.equal(r2.disparou, true);
  assert.equal(r2.evento.lado, 'baixa');
});

t('alerta de média só dispara em travessia nova', () => {
  const a = { tipo: 'ma', direcao: 'acima', rapida: 9, lenta: 18 };
  let est = estadoInicial();

  // primeira leitura: memoriza a travessia existente, não acorda ninguém
  let r = avaliar(a, est, { preco: 108, candles: serie });
  assert.equal(r.disparou, false);
  est = r.estado;

  // mesma série, mesma vela: silêncio
  r = avaliar(a, est, { preco: 108.5, candles: serie });
  assert.equal(r.disparou, false);
  est = r.estado;

  // chega uma vela nova que confirma outra travessia de alta
  const nova = [...serie];
  for (let i = 0; i < 12; i++) {
    const c = 80 + 24 * 1.2 + i * 0.9;
    nova.push({ t: 1700000000 + (serie.length + i) * 60, o: c, h: c + 5, l: c - 5, c });
  }
  r = avaliar(a, est, { preco: 135, candles: nova });
  // a travessia de alta continua sendo a mesma (t não muda), então não repete
  assert.equal(r.disparou, false);

  // agora uma perna de baixa nova e outra de alta mais adiante
  const baixaNova = [...nova];
  for (let i = 0; i < 30; i++) {
    const c = 135 - i * 2;
    baixaNova.push({ t: 1700000000 + (nova.length + i) * 60, o: c, h: c + 5, l: c - 5, c });
  }
  for (let i = 0; i < 30; i++) {
    const c = 75 + i * 2.5;
    baixaNova.push({ t: 1700000000 + (baixaNova.length) * 60, o: c, h: c + 5, l: c - 5, c });
  }
  const cAtual = cruzamentoMedia(baixaNova, 9, 18);
  assert.equal(cAtual.lado, 'alta');

  let est2 = estadoInicial();
  est2 = avaliar(a, est2, { preco: 150, candles: baixaNova }).estado; // memoriza
  const semNova = avaliar(a, est2, { preco: 151, candles: baixaNova });
  assert.equal(semNova.disparou, false);

  // nova vela muda o fechamento e mantém a travessia em outra posição
  const comNova = [...baixaNova];
  const c = 75 + 30 * 2.5 + 3;
  comNova.push({ t: 1700000000 + baixaNova.length * 60, o: c, h: c + 5, l: c - 5, c });
  const rMa = avaliar({ ...a, direcao: 'ambas' }, { ...est2, ultimoT: -1 }, { preco: 153, candles: comNova });
  assert.equal(rMa.disparou, true);
  assert.equal(rMa.evento.tipo, 'ma');
});

t('fibonacci usa o nível do swing corrente', () => {
  const a = { tipo: 'fib', direcao: 'acima', nivel: 0.618, swing: 21 };
  const cs = velas([100, 110, 120, 90, 95, 105, 115, 125, 130]);
  const alvo = precoDoNivel(cs, 0.618, 21);
  assert.ok(alvo > 85 && alvo < 135);
  let est = estadoInicial();
  est.avaliar = undefined;
  est = avaliar(a, est, { preco: alvo - 1, candles: cs }).estado;
  const r = avaliar(a, est, { preco: alvo + 0.5, candles: cs });
  assert.equal(r.disparou, true);
  assert.equal(r.evento.tipo, 'fib');
  assert.ok(Math.abs(r.evento.alvo - alvo) < 1e-9);
});

t('distância e rótulo', () => {
  const d = distancia({ tipo: 'preco', preco: 100 }, { preco: 90 });
  assert.equal(d.pontos, 10);
  assert.ok(Math.abs(d.percentual - 11.1111) < 0.01);
  assert.equal(rotulo({ tipo: 'ma', rapida: 9, lenta: 18, direcao: 'acima' }), 'Média 9/18 rompeu acima');
  assert.equal(rotulo({ tipo: 'preco', preco: 74100, direcao: 'abaixo' }), 'Preço 74100 perdeu abaixo');
});

t('assinatura da regra é estável', async () => {});  // placeholder substituído abaixo

// hash é assíncrono; roda no fim
const h1 = await assinarAlerta({ tipo: 'preco', direcao: 'acima', preco: 74100 });
const h2 = await assinarAlerta({ tipo: 'preco', direcao: 'acima', preco: 74100 });
const h3 = await assinarAlerta({ tipo: 'preco', direcao: 'abaixo', preco: 74100 });
assert.equal(h1.hash, h2.hash);
assert.notEqual(h1.hash, h3.hash);
assert.equal(h1.hash.length, 16);
console.log('  ok  assinatura estável da regra (' + h1.hash + ')');

t('parâmetros padrão do núcleo', () => {
  assert.equal(ALERTA_PARAMS.rapida, 9);
  assert.equal(ALERTA_PARAMS.lenta, 18);
});

console.log('\n' + ok + ' blocos de teste passaram');
