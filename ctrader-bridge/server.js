/**
 * Ponte cTrader Open API → VECTRA
 *
 * O navegador não fala TCP/protobuf nem pode guardar o client secret, então
 * esta ponte fica no servidor: autentica com o cTrader, pede as velas e os
 * preços ao vivo e entrega em JSON para o painel.
 *
 * Protocolo: TLS + mensagens JSON com prefixo de 4 bytes (big-endian) do
 * tamanho. O host/porta muda entre demo e real (env CTRADER_ENV).
 *
 * Nada aqui executa ordem: só leitura (trendbars e spots).
 */
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';

const CLIENT_ID = process.env.CTRADER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.CTRADER_CLIENT_SECRET || '';
const ACCOUNT_ID = process.env.CTRADER_ACCOUNT_ID || '';
const REDIRECT = process.env.CTRADER_REDIRECT || 'https://atlas-vectra-ui.onrender.com/ctrader-callback';
const AMBIENTE = process.env.CTRADER_ENV || 'demo';
const HOST = AMBIENTE === 'live' ? 'live1.p.ctrader.com' : 'demo1.p.ctrader.com';
const PORTA = AMBIENTE === 'live' ? 5035 : 5036;

// payloadTypes — conferir contra help.ctrader.com/open-api/messages antes do uso
const T = {
  APP_AUTH_REQ: 2100, APP_AUTH_RES: 2101,
  ACC_AUTH_REQ: 2102, ACC_AUTH_RES: 2103,
  GET_ACCOUNTS_REQ: 2149, GET_ACCOUNTS_RES: 2150,
  GET_TRENDBARS_REQ: 2137, GET_TRENDBARS_RES: 2138,
  SUBSCRIBE_SPOTS_REQ: 2127, SUBSCRIBE_SPOTS_RES: 2128,
  SPOT_EVENT: 2131,
};

const PERIODO = { m1: 1, m5: 5, m15: 6, m30: 7, h1: 8, h4: 9, d1: 12 };

function log(...a) { console.log('[ctrader]', ...a); }

/* ---------- conexão ---------- */
function conectar() {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host: HOST, port: PORTA, servername: HOST, rejectUnauthorized: true }, () => {
      log('conectado', HOST + ':' + PORTA);
      resolve(s);
    });
    s.on('error', reject);
    s.setNoDelay(true);
  });
}

function enviar(sock, payloadType, payload, clientMsgId) {
  const corpo = JSON.stringify({ clientMsgId: clientMsgId || Date.now(), payloadType, payload });
  const tam = Buffer.byteLength(corpo);
  const cab = Buffer.alloc(4); cab.writeUInt32BE(tam, 0);
  sock.write(Buffer.concat([cab, Buffer.from(corpo)]));
}

function leitor(sock) {
  let buf = Buffer.alloc(0);
  const espera = [];
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4) {
      const tam = buf.readUInt32BE(0);
      if (buf.length < 4 + tam) break;
      const corpo = buf.subarray(4, 4 + tam).toString('utf8');
      buf = buf.subarray(4 + tam);
      let msg; try { msg = JSON.parse(corpo); } catch { continue; }
      const i = espera.findIndex((e) => e.tipo === msg.payloadType);
      if (i >= 0) { const e = espera.splice(i, 1)[0]; e.resolver(msg.payload); }
    }
  });
  return (tipo, ms) => new Promise((resolver, rejeitar) => {
    espera.push({ tipo, resolver });
    setTimeout(() => rejeitar(new Error('timeout ' + tipo)), ms || 15000);
  });
}

/* ---------- sessão ---------- */
let sessao = null;
async function abrirSessao() {
  if (sessao && !sessao.sock.destroyed) return sessao;
  const sock = await conectar();
  const esperar = leitor(sock);
  const p1 = esperar(T.APP_AUTH_RES);
  enviar(sock, T.APP_AUTH_REQ, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  await p1;
  if (ACCOUNT_ID) {
    const p2 = esperar(T.ACC_AUTH_RES);
    enviar(sock, T.ACC_AUTH_REQ, { ctidTraderAccountId: Number(ACCOUNT_ID) });
    await p2;
  }
  log('autenticado, conta', ACCOUNT_ID || '(pendente)');
  sessao = { sock, esperar };
  return sessao;
}

/* ---------- rotas ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'https://x');
  const j = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };

  if (url.pathname === '/saude') return j({ ok: true, ambiente: AMBIENTE, host: HOST + ':' + PORTA, credenciais: !!CLIENT_ID, conta: ACCOUNT_ID || null });

  if (url.pathname === '/entrar') {
    const u = 'https://openapi.ctrader.com/apps/authorize?client_id=' + encodeURIComponent(CLIENT_ID) +
      '&redirect_uri=' + encodeURIComponent(REDIRECT) + '&response_type=code&scope=accounts';
    res.writeHead(302, { location: u }); return res.end();
  }

  if (url.pathname === '/ctrader-callback') {
    const code = url.searchParams.get('code');
    if (!code) return j({ ok: false, erro: 'sem code' }, 400);
    const corpo = new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT,
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    });
    const r = await fetch('https://openapi.ctrader.com/apps/token', { method: 'POST', body: corpo });
    const t = await r.json();
    log('token', r.status);
    return j({ ok: r.ok, token: r.ok ? { access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in } : t });
  }

  if (url.pathname === '/velas') {
    const sym = (url.searchParams.get('simbolo') || 'BTCUSD').toUpperCase();
    const tf = url.searchParams.get('tempo') || '15m';
    const qtd = Math.min(Number(url.searchParams.get('qtd') || 300), 5000);
    try {
      const { sock, esperar } = await abrirSessao();
      const espera = esperar(T.GET_TRENDBARS_RES, 20000);
      const agora = Date.now();
      enviar(sock, T.GET_TRENDBARS_REQ, {
        ctidTraderAccountId: Number(ACCOUNT_ID), symbolId: Number(sym), period: PERIODO[tf] || 6,
        fromTimestamp: agora - 1000 * 60 * 60 * 24 * 30, toTimestamp: agora, count: qtd,
      });
      const r = await espera;
      const velas = (r.trendbar || []).map((b) => ({
        time: Math.floor((Number(b.utcTimestampInMinutes) * 60) + (b.volume ? 0 : 0)),
        open: b.low / 100000, high: b.high / 100000, low: b.low / 100000, close: (b.low + b.deltaOpen + b.deltaClose) / 100000,
      }));
      return j({ ok: true, simbolo: sym, tempo: tf, velas: velas.slice(-qtd) });
    } catch (e) { return j({ ok: false, erro: String(e.message || e) }, 502); }
  }

  if (url.pathname === '/spot') {
    try {
      const { sock } = await abrirSessao();
      const sym = (url.searchParams.get('simbolo') || 'BTCUSD').toUpperCase();
      enviar(sock, T.SUBSCRIBE_SPOTS_REQ, { ctidTraderAccountId: Number(ACCOUNT_ID), symbolId: [Number(sym)] });
      return j({ ok: true, inscrito: sym });
    } catch (e) { return j({ ok: false, erro: String(e.message || e) }, 502); }
  }

  if (url.pathname === '/contas') {
    // descobre o ctidTraderAccountId a partir do token do OAuth
    const token = url.searchParams.get('token') || process.env.CTRADER_ACCESS_TOKEN || '';
    try {
      const sock = await conectar();
      const esperar = leitor(sock);
      const p1 = esperar(T.APP_AUTH_RES);
      enviar(sock, T.APP_AUTH_REQ, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
      await p1;
      const p2 = esperar(T.GET_ACCOUNTS_RES);
      enviar(sock, T.GET_ACCOUNTS_REQ, { accessToken: token });
      const r = await p2;
      sock.destroy();
      const contas = (r.ctidTraderAccount || []).map((c) => ({ conta: c.ctidTraderAccountId, demo: c.isLive === false, broker: c.brokerNameId || null }));
      return j({ ok: true, contas });
    } catch (e) { return j({ ok: false, erro: String(e.message || e) }, 502); }
  }

  return j({ ok: true, rotas: ['/saude', '/entrar', '/ctrader-callback', '/contas', '/velas', '/spot'] });
});

const PORTA_HTTP = Number(process.env.PORT || 8080);
server.listen(PORTA_HTTP, () => log('ponte ouvindo na', PORTA_HTTP));
