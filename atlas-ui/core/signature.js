// Assinatura de sinal. Serialização canônica (chaves ordenadas) sobre o
// payload, resumida em SHA-256. O mesmo payload gera sempre o mesmo hash,
// em qualquer máquina, no navegador ou no robô.
export function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  const k = Object.keys(v).sort();
  return '{' + k.map(x => JSON.stringify(x) + ':' + canon(v[x])).join(',') + '}';
}

const te = new TextEncoder();

async function sha256hex(txt) {
  const c = globalThis.crypto;
  if (c && c.subtle) {
    const b = await c.subtle.digest('SHA-256', te.encode(txt));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(txt, 'utf8').digest('hex');
}

export async function assinarSinal(sinal) {
  const payload = {
    core: sinal.core, rules: sinal.rules, params: sinal.params,
    ativo: sinal.ativo || 'BTC-USD', t: sinal.t, lado: sinal.lado,
    entrada: sinal.entrada, stop: sinal.stop, alvo: sinal.alvo,
  };
  return { payload, hash: await sha256hex(canon(payload)) };
}

export async function assinarConjunto(sinais) {
  const hashes = [];
  for (const s of sinais) hashes.push((await assinarSinal(s)).hash);
  return { quantidade: hashes.length, hash: await sha256hex(hashes.join('|')), hashes };
}

export { sha256hex };
