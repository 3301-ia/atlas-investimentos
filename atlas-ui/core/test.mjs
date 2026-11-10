// Teste determinístico do núcleo puro.
// Gera uma série fixa de candles, roda indicadores e regras, e resume tudo
// por hash. Duas execuções têm de dar exatamente o mesmo hash. Se um dia
// mudar sem querer, o hash muda e o robô recusa o sinal.
import { ema, zlema, kama, atr, rsi, ribbon, CORE_VERSION } from './indicators.js';
import { gerarSinais, RULES_VERSION } from './rules.js';
import { assinarConjunto, sha256hex, canon } from './signature.js';

function geradorSemente(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

export function candlesFixos(n = 600, seed = 20261110, base = 70000) {
  const rnd = geradorSemente(seed);
  const out = []; let preco = base;
  for (let i = 0; i < n; i++) {
    const abertura = preco;
    const passo = (rnd() - 0.48) * 90;
    const fechamento = abertura + passo;
    const alto = Math.max(abertura, fechamento) + rnd() * 40;
    const baixo = Math.min(abertura, fechamento) - rnd() * 40;
    out.push({ t: 1794300000 + i * 15, o: abertura, h: alto, l: baixo, c: fechamento, vol: 1 + rnd() });
    preco = fechamento;
  }
  return out;
}

function ultimo(arr) { for (let i = arr.length - 1; i >= 0; i--) if (typeof arr[i] === 'number') return arr[i]; return null; }

async function rodar() {
  const bruto = candlesFixos();
  const candles = bruto.map(c => ({ t: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.vol, fechado: true }));
  const cs = candles.map(c => c.close);
  const serie = {
    ema9: ultimo(ema(cs, 9)), ema21: ultimo(ema(cs, 21)), ema50: ultimo(ema(cs, 50)),
    zlema10: ultimo(zlema(cs, 10)), kama10: ultimo(kama(cs, 10)),
    atr14: ultimo(atr(candles, 14)), rsi14: ultimo(rsi(cs, 14)),
  };
  const sinais = gerarSinais(candles);
  const assinado = await assinarConjunto(sinais);
  const hashIndicadores = await sha256hex(canon(serie));
  return {
    core: CORE_VERSION, rules: RULES_VERSION,
    candles: candles.length, sinais: sinais.length,
    hashIndicadores, hashSinais: assinado.hash,
    ultimoSinal: sinais.length ? sinais[sinais.length - 1] : null,
    serie: Object.fromEntries(Object.entries(serie).map(([k, v]) => [k, v === null ? null : Math.round(v * 100) / 100])),
  };
}

const a = await rodar();
const b = await rodar();
const igual = a.hashIndicadores === b.hashIndicadores && a.hashSinais === b.hashSinais;
console.log(JSON.stringify({ ...a, determinismo: igual ? 'estavel' : 'INSTAVEL' }, null, 2));
if (!igual) process.exit(1);
