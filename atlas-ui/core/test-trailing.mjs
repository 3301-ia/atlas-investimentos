import { trailingStop } from './trailing.js';
let ok = 0, falhas = 0;
function t(nome, cond) { if (cond) { ok++; console.log('  ok  ' + nome); } else { falhas++; console.log('  FALHA ' + nome); } }

function monta(seq) {
  // seq: array de closes; high/low abrem +-0.5% para dar ATR
  return seq.map((c, i) => ({ time: 1700000000 + i * 60, open: i ? seq[i-1] : c, high: c * 1.004, low: c * 0.996, close: c }));
}

const sobe = monta(Array.from({ length: 80 }, (_, i) => 100 + i * 0.5));
const r1 = trailingStop(sobe);
t('devolve serie no tendao de alta', r1 && r1.serie.length > 20);
t('lado de alta', r1.estado.lado === 'alta');
t('stop abaixo do preco', r1.estado.stop < r1.estado.preco);
t('dentro do stop', r1.estado.dentro === true);
const vals = r1.serie.map(s => s.value);
let monotono = true;
for (let i = 30; i < vals.length; i++) if (vals[i] < vals[i-1] - 1e-9) monotono = false;
t('catraca: stop nunca recua na alta', monotono);
t('viradas zero no tendao limpo', r1.estado.viradas === 0);

const cai = monta(Array.from({ length: 80 }, (_, i) => 140 - i * 0.5));
const r2 = trailingStop(cai);
t('lado de baixa na queda', r2.estado.lado === 'baixa');
t('stop acima do preco na baixa', r2.estado.stop > r2.estado.preco);

// alta longa e depois tombo forte: precisa virar o lado
const vira = monta([...Array.from({ length: 60 }, (_, i) => 100 + i), ...Array.from({ length: 25 }, (_, i) => 159 - i * 3)]);
const r3 = trailingStop(vira);
t('vira o lado depois do tombo', r3.estado.lado === 'baixa' && r3.estado.viradas >= 1);
t('registra a virada', r3.estado.ultimaVirada != null);

t('poucos candles devolve null', trailingStop(sobe.slice(0, 10)) === null);
t('aceita parametros proprios', trailingStop(sobe, { mult: 1.2 }).estado.distancia < r1.estado.distancia + 1e-6);
t('distancia em porcentagem coerente', r1.estado.distanciaPercentual > 0 && r1.estado.distanciaPercentual < 20);

console.log(falhas ? '\n' + falhas + ' falhas' : '\n' + ok + ' verificacoes do trailing passaram');
process.exit(falhas ? 1 : 0);
