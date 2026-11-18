/**
 * Ponte cTrader Open API → VECTRA  (protocolo: TLS + protobuf)
 *
 * Testado contra a API real: o quadro é [4 bytes BE = tamanho][envelope protobuf],
 * onde o envelope tem payloadType no campo 1 e o payload no campo 2.
 * Campos confirmados na prática: ProtoOAApplicationAuthReq usa
 * payloadType=1, clientId=2, clientSecret=3.
 *
 * Só leitura: velas (trendbars) e preços ao vivo (spots). Nenhuma ordem.
 */
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';

const CLIENT_ID = process.env.CTRADER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET || '';
const ACCOUNT_ID = process.env.CTRADER_ACCOUNT_ID || '';
let TOKEN = process.env.CTRADER_ACCESS_TOKEN || '';
const REDIRECT = process.env.CTRADER_REDIRECT || '';
const AMBIENTE = process.env.CTRADER_ENV || 'live';
const HOST = AMBIENTE === 'live' ? 'live.ctraderapi.com' : 'demo.ctraderapi.com';
const PORTA = AMBIENTE === 'live' ? 5035 : 5036;

const T = {
  APP_AUTH_REQ: 2100, APP_AUTH_RES: 2101,
  ACC_AUTH_REQ: 2102, ACC_AUTH_RES: 2103,
  GET_ACCOUNTS_REQ: 2149, GET_ACCOUNTS_RES: 2150,
  GET_TRENDBARS_REQ: 2137, GET_TRENDBARS_RES: 2138,
  SUBSCRIBE_SPOTS_REQ: 2127, SUBSCRIBE_SPOTS_RES: 2128,
  SPOT_EVENT: 2131, ERROR_RES: 2142,
};
const PERIODO = { m1: 1, m5: 5, m15: 6, m30: 7, h1: 8, h4: 9, d1: 12 };
const log = (...a) => console.log('[ctrader]', ...a);

/* ---------- protobuf mínimo ---------- */
const vint = (n) => { const o = []; let v = Number(n); while (v > 127) { o.push((v & 127) | 128); v = Math.floor(v / 128); } o.push(v); return Buffer.from(o); };
const cab = (n, w) => vint((n << 3) | w);
const sCampo = (n, s) => { const b = Buffer.from(String(s), 'utf8'); return Buffer.concat([cab(n, 2), vint(b.length), b]); };
const iCampo = (n, v) => Buffer.concat([cab(n, 0), vint(v)]);
const envelopar = (payloadType, payload) => Buffer.concat([iCampo(1, payloadType), cab(2, 2), vint(payload.length), payload]);

function enviar(sock, payloadType, payload) {
  const corpo = envelopar(payloadType, payload);
  const h = Buffer.alloc(4); h.writeUInt32BE(corpo.length, 0);
  sock.write(Buffer.concat([h, corpo]));
}

function lerCampos(buf) {
  const out = []; let i = 0;
  const rv = () => { let r = 0, s = 0, b; do { b = buf[i++]; r += (b & 127) * Math.pow(2, s); s += 7; } while (b & 128); return r; };
  while (i < buf.length) {
    const k = rv(), campo = k >> 3, tipo = k & 7;
    if (tipo === 0) out.push([campo, rv()]);
    else if (tipo === 2) { const n = rv(); out.push([campo, buf.subarray(i, i + n)]); i += n; }
    else if (tipo === 5) { out.push([campo, buf.readUInt32LE(i)]); i += 4; }
    else if (tipo === 1) { i += 8; }
    else break;
  }
  return out;
}

/* ---------- conexão ---------- */
function conectar() {
  return new Promise((res, rej) => {
    const s = tls.connect({ host: HOST, port: PORTA, servername: HOST }, () => res(s));
    s.on('error', rej); s.setNoDelay(true);
  });
}

function leitor(sock) {
  let buf = Buffer.alloc(0); const espera = [];
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4) {
      const tam = buf.readUInt32BE(0);
      if (tam <= 0 || tam > 5e6) { buf = Buffer.alloc(0); break; }
      if (buf.length < 4 + tam) break;
      const corpo = buf.subarray(4, 4 + tam); buf = buf.subarray(4 + tam);
      const campos = lerCampos(corpo);
      const pt = campos.find((c) => c[0] === 1); const pl = campos.find((c) => c[0] === 2);
      if (!pt) continue;
      const msg = { payloadType: pt[1], payload: pl ? pl[1] : Buffer.alloc(0) };
      const i = espera.findIndex((e) => e.tipo === msg.payloadType);
      if (i >= 0) espera.splice(i, 1)[0].res(msg);
    }
  });
  return (tipo, ms) => new Promise((res, rej) => { espera.push({ tipo, res }); setTimeout(() => rej(new Error('timeout ' + tipo)), ms || 15000); });
}

function erro(msg) {
  const c = lerCampos(msg.payload);
  // ProtoOAErrorRes: campo 3 = errorCode, campo 4 = description
  const txt = c.filter((x) => x[0] === 3 || x[0] === 4).map((x) => x[1].toString('utf8')).join(': ');
  return txt || 'erro sem texto';
}

/* ---------- sessão ---------- */
let sessao = null;
async function abrirSessao() {
  if (sessao && !sessao.sock.destroyed) return sessao;
  const sock = await conectar(); const esperar = leitor(sock);
  const pErr = esperar(T.ERROR_RES, 12000).catch(() => null);
  const p1 = esperar(T.APP_AUTH_RES);
  enviar(sock, T.APP_AUTH_REQ, Buffer.concat([sCampo(2, CLIENT_ID), sCampo(3, CLIENT_SECRET)]));
  const r1 = await Promise.race([p1, pErr.then((e) => ({ erro: e ? erro(e) : 'sem resposta' }))]);
  if (r1.erro) throw new Error('app auth: ' + r1.erro);
  if (ACCOUNT_ID && TOKEN) {
    const p2 = esperar(T.ACC_AUTH_RES);
    enviar(sock, T.ACC_AUTH_REQ, Buffer.concat([iCampo(1, Number(ACCOUNT_ID)), sCampo(2, TOKEN)]));
    await p2;
  }
  sessao = { sock, esperar };
  return sessao;
}
const sField = sCampo;

/* ---------- OAuth: code -> access token ---------- */
async function trocarCodigo(code) {
  const corpo = new URLSearchParams({
    grant_type: 'authorization_code', code,
    redirect_uri: REDIRECT, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
  });
  const r = await fetch('https://openapi.ctrader.com/apps/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corpo,
  });
  const texto = await r.text();
  let j = {}; try { j = JSON.parse(texto); } catch (e) { j = { bruto: texto.slice(0, 200) }; }
  if (j.accessToken) { TOKEN = j.accessToken; log('token obtido, expira em', j.expiresIn, 's'); }
  return j;
}

/* ---------- rotas ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'https://x');
  const j = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };

  if (url.pathname === '/saude') return j({ ok: true, ambiente: AMBIENTE, host: HOST + ':' + PORTA, credenciais: !!CLIENT_ID, conta: ACCOUNT_ID || null, token: !!TOKEN });

  if (url.pathname === '/entrar') {
    const u = 'https://openapi.ctrader.com/apps/authorize?client_id=' + encodeURIComponent(CLIENT_ID) +
      '&redirect_uri=' + encodeURIComponent(process.env.CTRADER_REDIRECT || '') + '&response_type=code&scope=accounts';
    res.writeHead(302, { location: u }); return res.end();
  }

  if (url.pathname === '/callback' || url.pathname === '/token') {
    const code = url.searchParams.get('code') || '';
    if (!code) return j({ ok: false, erro: 'faltou o code' }, 400);
    try {
      const t = await trocarCodigo(code);
      if (!t.accessToken) return j({ ok: false, etapa: 'troca do code', resposta: t }, 502);
      return j({ ok: true, expiraEmSegundos: t.expiresIn, temRefresh: !!t.refreshToken, token: '•••' + String(t.accessToken).slice(-6) });
    } catch (e) { return j({ ok: false, erro: String(e.message || e) }, 502); }
  }

  if (url.pathname === '/teste-auth') {
    try { await abrirSessao(); return j({ ok: true, mensagem: 'aplicativo autenticado' }); }
    catch (e) { return j({ ok: false, erro: String(e.message || e) }, 502); }
  }

  if (url.pathname === '/contas') {
    const token = url.searchParams.get('token') || TOKEN;
    try {
      const sock = await conectar(); const esperar = leitor(sock);
      const p1 = esperar(T.APP_AUTH_RES);
      sock.write(envelopar(T.APP_AUTH_REQ, Buffer.concat([sCampo(2, CLIENT_ID), sCampo(3, CLIENT_SECRET)])));
      await p1;
      const p2 = esperar(T.GET_ACCOUNTS_RES);
      enviar(sock, T.GET_ACCOUNTS_REQ, sCampo(1, token));
      const r = await p2; sock.destroy();
      const contas = lerCampos(r.payload).filter((c) => c[0] === 1).map((c) => {
        const f = lerCampos(c[1]); const id = f.find((x) => x[0] === 1); const live = f.find((x) => x[0] === 2);
        return { conta: id ? id[1] : null, real: live ? live[1] === 1 : null };
      });
      return j({ ok: true, contas });
    } catch (e) { return j({ ok: false, erro: String(e.message || e) }, 502); }
  }

  if (url.pathname === '/velas') {
    const sym = Number(url.searchParams.get('simbolo') || 0);
    const tf = url.searchParams.get('tempo') || '15m';
    const qtd = Math.min(Number(url.searchParams.get('qtd') || 300), 5000);
    try {
      const { sock, esperar } = await abrirSessao();
      const agora = Date.now();
      const p = Buffer.concat([
        iCampo(1, Number(ACCOUNT_ID)), iCampo(2, agora - 1000 * 60 * 60 * 24 * 40),
        iCampo(3, agora), iCampo(4, PERIODO[tf] || 6), iCampo(5, sym), iCampo(6, qtd),
      ]);
      const espera = esperar(T.GET_TRENDBARS_RES, 20000);
      enviar(sock, T.GET_TRENDBARS_REQ, p);
      const r = await espera;
      const velas = lerCampos(r.payload).filter((c) => c[0] === 1).map((c) => {
        const f = lerCampos(c[1]);
        const g = (n) => (f.find((x) => x[0] === n) || [, 0])[1];
        const baixo = Number(g(2)) / 100000, deltaA = Number(g(3) || 0) / 100000, deltaF = Number(g(4) || 0) / 100000;
        return { time: Number(g(1)) * 60, low: baixo, open: baixo + deltaA, close: baixo + deltaF, high: Number(g(5)) / 100000 };
      }).map((v) => ({ time: v.time, open: v.open, high: v.high, low: v.low, close: v.close }));
      return j({ ok: true, simbolo: sym, tempo: tf, velas: velas.slice(-qtd) });
    } catch (e) { return j({ ok: false, erro: String(e.message || e) }, 502); }
  }

  return j({ ok: true, rotas: ['/saude', '/entrar', '/callback', '/teste-auth', '/contas', '/velas'] });
});

const P = Number(process.env.PORT || 8080);
server.listen(P, () => log('ponte ouvindo na', P, '| ambiente', AMBIENTE, HOST + ':' + PORTA));
