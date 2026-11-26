// VECTRA · teste da escada de travas contra o relatório de 20/11/2026
//
// Roda sem dependência nenhuma:
//   node atlas-ui/core/test-vectra-escada.mjs
//
// O critério é o protocolo de validação do relatório (seção 27): reproduzir
// 684,52 ± 2% e a mesma tabela por nível. Se este teste falhar, alguma regra
// mudou e nada mais vale.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');

let ok = 0, falhas = 0;
const t = (nome, cond, extra) => {
  if (cond) { ok++; console.log('  ok  ' + nome); }
  else { falhas++; console.log('  FALHA ' + nome + (extra ? ' :: ' + extra : '')); }
};

/* ── carregar o backtest (UMD) sem depender de ESM/CJS ────────────── */
function carregarBacktest() {
  const codigo = fs.readFileSync(path.join(RAIZ, 'vectra-backtest.js'), 'utf8');
  const sandbox = { module: { exports: {} }, console, globalThis: {} };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox);
  return sandbox.module.exports.rodar ? sandbox.module.exports : sandbox.globalThis.VectraBacktest;
}

const B = carregarBacktest();
t('backtest carregou', !!B && typeof B.rodar === 'function');

/* ── série real do estudo ─────────────────────────────────────────── */
const caminhoSerie = path.join(AQUI, 'dados', 'm15_btcusdt_15m.json');
t('série do estudo presente', fs.existsSync(caminhoSerie), caminhoSerie);
const velas = JSON.parse(fs.readFileSync(caminhoSerie, 'utf8'));

t('série tem 21.000 velas', velas.length === 21000, String(velas.length));

const r = B.rodar(velas);
t('sem erro de validação', !r.erro, r.erro);

if (!r.erro) {
  t('599 ciclos', r.ciclos === 599, String(r.ciclos));
  t('resultado 684,52 ± 2%', Math.abs(r.resultado - 684.52) / 684.52 <= 0.02, r.resultado.toFixed(2));
  t('principal 169,16 ± 2%', Math.abs(r.principal - 169.16) / 169.16 <= 0.02, r.principal.toFixed(2));
  t('travas 515,34 ± 2%', Math.abs(r.travas - 515.34) / 515.34 <= 0.02, r.travas.toFixed(2));
  t('acerto 44,2%', Math.abs(r.acerto - 0.442) <= 0.03, (r.acerto * 100).toFixed(1) + '%');
  t('queda máxima 15,45', Math.abs(r.quedaMaxima - 15.45) / 15.45 <= 0.05, r.quedaMaxima.toFixed(2));
  t('pior sequência 11', r.piorSequencia === 11, String(r.piorSequencia));
  t('travas respondem por 75,3% do lucro', Math.abs(r.pctTravas - 0.753) <= 0.02, (r.pctTravas * 100).toFixed(1) + '%');
  t('reserva de 10% = 68,45', Math.abs(r.reserva - 68.45) / 68.45 <= 0.02, r.reserva.toFixed(2));

  const esperado = [388, 318, 241, 169, 103];
  const acertoEsperado = [0.75, 0.93, 0.93, 0.98, 1.0];
  r.nivelStats.forEach((nivel, k) => {
    t('nível ' + (k + 1) + ' com ' + esperado[k] + ' aberturas', nivel.aberturas === esperado[k], String(nivel.aberturas));
    t('nível ' + (k + 1) + ' com acerto ' + (acertoEsperado[k] * 100) + '%',
      Math.abs(nivel.acerto - acertoEsperado[k]) <= 0.01, (nivel.acerto * 100).toFixed(0) + '%');
  });

  t('conferência completa contra o relatório', B.conferir(r).ok);

  /* ── o erro de sinal das travas encerradas com o ciclo ───────────── */
  const corrigido = B.rodar(velas, { corrigirSinalEncerrada: true });
  t('mesma contagem de ciclos com o sinal corrigido', corrigido.ciclos === 599, String(corrigido.ciclos));
  t('sinal corrigido dá 665,89 ± 2%', Math.abs(corrigido.resultado - 665.89) / 665.89 <= 0.02,
    corrigido.resultado.toFixed(2));
  t('diferença para o relatório é US$ 18,60 (18 travas)',
    Math.abs((r.resultado - corrigido.resultado) - 18.60) < 0.05,
    (r.resultado - corrigido.resultado).toFixed(2));
  t('tabela por nível não muda com a correção',
    JSON.stringify(corrigido.nivelStats.map(n => n.aberturas)) === JSON.stringify([388, 318, 241, 169, 103]));
}

/* ── a trava do erro histórico: série em OHLC tem de ser recusada ──── */
const emOhlc = velas.map(v => [v[0], v[1], v[3], v[4], v[2], v[5]]);
const rOhlc = B.rodar(emOhlc);
t('série lida como OHLC é recusada com mensagem', !!rOhlc.erro && /OHLC/.test(rOhlc.erro), rOhlc.erro);

/* ── normalização de objetos e de arrays ──────────────────────────── */
const comoObjeto = velas.map(v => ({ t: v[0], open: v[1], close: v[2], high: v[3], low: v[4], volume: v[5] }));
const rObjeto = B.rodar(comoObjeto);
t('aceita velas em objeto', !rObjeto.erro && Math.abs(rObjeto.resultado - r.resultado) < 0.01,
  rObjeto.erro || String(rObjeto.resultado));

/* ── a ordem de checagem é conservadora (Anexo B) ─────────────────── */
const conservador = B.rodar(velas, { travaSoNaVelaSeguinte: true });
t('modo conservador muda o resultado (stop/alvo antes, trava depois)',
  conservador.resultado < r.resultado, conservador.resultado.toFixed(2));

console.log('\n' + ok + ' ok, ' + falhas + ' falha(s)');
process.exit(falhas === 0 ? 0 : 1);
