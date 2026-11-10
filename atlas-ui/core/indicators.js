// Núcleo puro de indicadores do Atlas Vectra.
// Regra do arquivo: nenhuma referência a tela, documento, canvas, DOM ou
// biblioteca externa. Só entra série, sai série. Isso permite rodar o mesmo
// cálculo no navegador, no Node e no robô, e comparar por hash.
export const CORE_VERSION = '1.0.0';

const isNum = v => typeof v === 'number' && Number.isFinite(v);

export function ema(values, len) {
  const out = new Array(values.length).fill(null);
  if (!(len > 0)) return out;
  const k = 2 / (len + 1);
  let prev = null, seed = 0, n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isNum(v)) continue;
    if (prev === null) { seed += v; n++; if (n === len) { prev = seed / len; out[i] = prev; } }
    else { prev = v * k + prev * (1 - k); out[i] = prev; }
  }
  return out;
}

export function sma(values, len) {
  const out = new Array(values.length).fill(null);
  let sum = 0, q = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isNum(v)) { sum += v; q++; }
    if (q > len) { const old = values[i - len]; if (isNum(old)) sum -= old; q--; }
    if (q >= len && i >= len - 1) out[i] = sum / len;
  }
  return out;
}

// ZLEMA: EMA sobre a série desatrasada. lag = (len - 1) / 2.
export function zlema(values, len) {
  const lag = Math.floor((len - 1) / 2);
  const d = values.map((v, i) => {
    const b = values[i - lag];
    if (!isNum(v) || !isNum(b)) return null;
    return v + (v - b);
  });
  const e = ema(d, len);
  return e.map((v, i) => (isNum(values[i]) && isNum(v) ? v : null));
}

// KAMA: média adaptativa de Kaufman. Erro = |preço - preço de n atrás|,
// ruído = soma dos passos absolutos no mesmo intervalo.
export function kama(values, len = 10, fast = 2, slow = 30) {
  const out = new Array(values.length).fill(null);
  const fs = 2 / (fast + 1), ss = 2 / (slow + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < len) continue;
    const atual = values[i], antes = values[i - len];
    if (!isNum(atual) || !isNum(antes)) continue;
    let ruido = 0, ok = true;
    for (let j = i - len + 1; j <= i; j++) {
      const a = values[j], b = values[j - 1];
      if (!isNum(a) || !isNum(b)) { ok = false; break; }
      ruido += Math.abs(a - b);
    }
    if (!ok || ruido === 0) continue;
    const er = Math.abs(atual - antes) / ruido;
    const sc = Math.pow(er * (fs - ss) + ss, 2);
    prev = prev === null ? atual : prev + sc * (atual - prev);
    out[i] = prev;
  }
  return out;
}

export function atr(candles, len = 14) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const p = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - p), Math.abs(c.low - p));
  });
  return ema(tr, len);
}

export function rsi(values, len = 14) {
  const out = new Array(values.length).fill(null);
  let up = 0, dn = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= len) { up += g; dn += l; if (i === len) { up /= len; dn /= len; out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn); } }
    else { up = (up * (len - 1) + g) / len; dn = (dn * (len - 1) + l) / len; out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn); }
  }
  return out;
}

// Ribbon de 8 EMAs, do mesmo jeito que o painel desenha.
export const RIBBON_LENS = [8, 13, 21, 34, 55, 89, 144, 233];
export function ribbon(values, lens = RIBBON_LENS) {
  return lens.map(len => ema(values, len));
}

// Empilhamento do ribbon: 1 = todas em ordem de alta, -1 = ordem de baixa,
// 0 = desalinhado. Lido só na última posição fechada.
export function ribbonAlinhamento(linhas, i) {
  const vals = linhas.map(l => l[i]);
  if (vals.some(v => !isNum(v))) return 0;
  let alta = true, baixa = true;
  for (let k = 1; k < vals.length; k++) {
    if (!(vals[k - 1] > vals[k])) alta = false;
    if (!(vals[k - 1] < vals[k])) baixa = false;
  }
  return alta ? 1 : (baixa ? -1 : 0);
}

export function closes(candles) { return candles.map(c => c.close); }
