/* VECTRA · Ω-Score · modelo de probabilidade
 *
 * Estudo do gráfico da Onchain Mind: cada ponto é um dia do histórico do BTC.
 * O eixo vertical é a faixa de Ω daquele dia, o horizontal é o retorno de 12
 * meses para frente, a linha branca é a mediana da faixa e o número à direita é
 * a chance de ter ficado no lucro depois de um ano.
 *
 * A fórmula do Ω é a mesma do painel (aberta, de preço), então isto é um estudo
 * próprio e não a cópia do modelo fechado deles.
 */
(function () {
  const ID = 'omega-prob';
  const ZONAS = [
    { nome: 'Extrema acumulação', de: 0, ate: 12.5 },
    { nome: 'Valor profundo', de: 12.5, ate: 25 },
    { nome: 'Abaixo da média', de: 25, ate: 37.5 },
    { nome: 'Levemente abaixo', de: 37.5, ate: 50 },
    { nome: 'Perto do justo', de: 50, ate: 62.5 },
    { nome: 'Acima da média', de: 62.5, ate: 75 },
    { nome: 'Sobreaquecido', de: 75, ate: 87.5 },
    { nome: 'Euforia extrema', de: 87.5, ate: 101 },
  ];
  const MARCA = ['-90%', '-50%', '-25%', '0%', '+25%', '+50%', '+100%', '+200%', '+400%', '+800%', '+1600%', '+3200%', '+6400%'];
  const VALOR = [-0.9, -0.5, -0.25, 0, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];

  const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  function ema(v, n) {
    const a = 2 / (n + 1); let e = media(v.slice(0, n)); const out = new Array(v.length).fill(null);
    out[n - 1] = e;
    for (let i = n; i < v.length; i++) { e = v[i] * a + e * (1 - a); out[i] = e; }
    return out;
  }
  function rsi(v, n = 14) {
    const out = new Array(v.length).fill(null);
    for (let i = n; i < v.length; i++) {
      let g = 0, p = 0;
      for (let k = i - n + 1; k <= i; k++) { const d = v[k] - v[k - 1]; if (d > 0) g += d; else p -= d; }
      g /= n; p /= n;
      out[i] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
    }
    return out;
  }
  const lim = (x) => Math.max(0, Math.min(100, x));

  async function historico(onProgress) {
    const cacheKey = 'vx_omega_prob_btc_1d';
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (cached && Array.isArray(cached.v) && cached.v.length > 500 && (Date.now() - cached.em) < 43200000) {
        return cached.v;
      }
    } catch (e) {}

    // 300 velas por pedido: pagina de 2015 até hoje
    const inicio = new Date('2015-06-01T00:00:00Z').getTime();
    const fim = Date.now();
    const janelas = [];
    for (let cursor = inicio; cursor < fim; cursor += 300 * 86400000) {
      janelas.push([cursor, Math.min(cursor + 300 * 86400000, fim)]);
    }
    const todas = [];
    for (let i = 0; i < janelas.length; i += 3) {
      const lote = janelas.slice(i, i + 3);
      if (onProgress) onProgress(Math.min(i + lote.length, janelas.length), janelas.length);
      const resps = await Promise.all(lote.map(async ([de, ate]) => {
        const u = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start=${new Date(de).toISOString()}&end=${new Date(ate).toISOString()}`;
        try {
          const r = await fetch(u);
          if (!r.ok) return [];
          const j = await r.json();
          return Array.isArray(j) ? j : [];
        } catch (e) { return []; }
      }));
      resps.forEach((j) => { if (j.length) todas.push(...j); });
      if (i + 3 < janelas.length) await new Promise((res) => setTimeout(res, 150));
    }
    const mapa = new Map();
    todas.forEach((c) => mapa.set(c[0], c));
    const serie = [...mapa.values()].sort((a, b) => a[0] - b[0]).map((c) => ({ time: c[0], close: c[4] }));
    if (serie.length > 500) {
      try { localStorage.setItem(cacheKey, JSON.stringify({ em: Date.now(), v: serie })); } catch (e) {}
    }
    return serie;
  }

  function omegaSerie(closes) {
    const e50 = ema(closes, 50), e200 = ema(closes, 200), r = rsi(closes, 14);
    const out = [];
    for (let i = 0; i < closes.length; i++) {
      if (e200[i] == null || r[i] == null) { out.push(null); continue; }
      const a200 = ((closes[i] - e200[i]) / e200[i]) * 100;
      const a50 = ((closes[i] - e50[i]) / e50[i]) * 100;
      const jan = closes.slice(Math.max(0, i - 90), i + 1);
      const max = Math.max(...jan);
      const queda = ((max - closes[i]) / max) * 100;
      const s = closes.slice(Math.max(1, i - 30), i + 1);
      const ret = s.slice(1).map((x, k) => Math.log(x / s[k]));
      const m = media(ret);
      const vol = Math.sqrt(media(ret.map((x) => (x - m) ** 2))) * 100;
      const score = lim(50 + a200 * 1.6) * 0.3 + lim(50 + a50 * 3) * 0.2 + lim(r[i]) * 0.25 + lim(100 - queda * 3.2) * 0.15 + lim(vol * 28) * 0.1;
      out.push(Math.round(score));
    }
    return out;
  }

  function zona(score) {
    const i = ZONAS.findIndex((z) => score >= z.de && score < z.ate);
    return i < 0 ? ZONAS.length - 1 : i;
  }

  function desenhar(svg, dados, scoreAtual) {
    const L = 150, R = 90, T = 34, B = 52, W = 1180, H = 470;
    const altura = (H - T - B) / ZONAS.length;
    const x = (ret) => {
      const v = Math.max(-0.9, Math.min(64, ret));
      const t = Math.log10(v + 1) / Math.log10(65);
      return L + t * (W - L - R);
    };
    const partes = [];
    partes.push(`<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" style="font-family:Inter,system-ui,sans-serif">`);
    partes.push(`<rect width="${W}" height="${H}" fill="#12161f"/>`);
    ZONAS.forEach((z, i) => {
      const y = T + i * altura;
      partes.push(`<rect x="0" y="${y}" width="${W}" height="${altura}" fill="${i % 2 ? '#151a24' : '#12161f'}"/>`);
      partes.push(`<text x="${L - 12}" y="${y + altura / 2 + 4}" text-anchor="end" fill="#8a92a6" font-size="11">${z.nome}</text>`);
    });
    MARCA.forEach((m, i) => {
      const px = x(VALOR[i]);
      partes.push(`<line x1="${px}" y1="${T}" x2="${px}" y2="${H - B}" stroke="${VALOR[i] === 0 ? '#3b4355' : '#1e242f'}" stroke-width="1"/>`);
      partes.push(`<text x="${px}" y="${H - B + 20}" text-anchor="middle" fill="#6d7688" font-size="10">${m}</text>`);
    });
    const grupos = ZONAS.map(() => []);
    dados.forEach((d) => grupos[d.zona].push(d));
    const resumo = grupos.map((g) => {
      const rets = g.map((d) => d.ret).sort((a, b) => a - b);
      const mediana = rets.length ? rets[Math.floor(rets.length / 2)] : null;
      const subiu = g.length ? Math.round((g.filter((d) => d.ret > 0).length / g.length) * 100) : null;
      return { n: g.length, mediana, subiu };
    });
    grupos.forEach((g, i) => {
      const y = T + i * altura + altura / 2;
      if (i === zona(scoreAtual)) partes.push(`<rect x="4" y="${T + i * altura + 2}" width="${W - 8}" height="${altura - 4}" fill="none" stroke="#3d7bff" stroke-width="1.5" rx="4"/>`);
      g.forEach((d, k) => {
        const jitter = ((k % 7) - 3) * (altura / 22);
        partes.push(`<circle cx="${x(d.ret).toFixed(1)}" cy="${(y + jitter).toFixed(1)}" r="2.4" fill="${d.ret >= 0 ? '#2fbf9b' : '#e0555a'}" fill-opacity=".78"/>`);
      });
      const s = resumo[i];
      if (s.mediana != null) partes.push(`<line x1="${x(s.mediana)}" y1="${T + i * altura + 6}" x2="${x(s.mediana)}" y2="${T + (i + 1) * altura - 6}" stroke="#e7ebf3" stroke-width="1.4"/>`);
      partes.push(`<text x="${W - 20}" y="${y + 4}" text-anchor="end" fill="#9aa3b8" font-size="11">${s.subiu != null ? s.subiu + '% subiu' : '--'}</text>`);
      partes.push(`<text x="${W - 20}" y="${y + 18}" text-anchor="end" fill="#5f677a" font-size="9">${s.n} dias</text>`);
    });
    partes.push(`<text x="${L}" y="${H - 8}" fill="#6d7688" font-size="10">retorno de 12 meses para frente · cada ponto é um dia de BTC desde 2015</text>`);
    partes.push(`<text x="${W - 20}" y="${H - 8}" text-anchor="end" fill="#6d7688" font-size="10">Ω hoje: ${scoreAtual} · ${ZONAS[zona(scoreAtual)].nome}</text>`);
    partes.push('</svg>');
    svg.innerHTML = partes.join('');
  }

  function montar() {
    if (document.getElementById(ID)) return document.getElementById(ID);
    const c = document.createElement('div');
    c.id = ID;
    c.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0a0d14;display:none;flex-direction:column;font-family:Inter,system-ui,sans-serif;color:#dfe3ea';
    c.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid #242935">
        <b style="font-size:12px;letter-spacing:.18em">Ω-SCORE · MODELO DE PROBABILIDADE</b>
        <span id="op-status" style="font-size:11px;color:#7c8496">carregando histórico…</span>
        <button id="op-fechar" style="margin-left:auto;background:transparent;border:1px solid #242935;color:#dfe3ea;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:10px">Fechar</button>
      </div>
      <div id="op-area" style="flex:1;min-height:0;padding:8px 12px 12px"></div>`;
    document.body.appendChild(c);
    c.querySelector('#op-fechar').onclick = () => { c.style.display = 'none'; };
    return c;
  }

  async function abrir() {
    const c = montar();
    c.style.display = 'flex';
    const area = c.querySelector('#op-area');
    const status = c.querySelector('#op-status');
    if (area.dataset.pronto) return;
    status.textContent = 'carregando histórico…';
    try {
      const h = await historico((feito, total) => {
        status.textContent = `carregando histórico… (${feito}/${total})`;
      });
      if (!h.length) throw new Error('histórico indisponível');
      const closes = h.map((x) => x.close);
      const scores = omegaSerie(closes);
      const dados = [];
      for (let i = 0; i < closes.length - 365; i++) {
        if (scores[i] == null) continue;
        dados.push({ zona: zona(scores[i]), ret: closes[i + 365] / closes[i] - 1 });
      }
      const atual = [...scores].reverse().find((s) => s != null);
      area.innerHTML = '<svg id="op-svg"></svg>';
      desenhar(area.querySelector('#op-svg'), dados, atual);
      area.dataset.pronto = '1';
      status.textContent = `${h.length} dias de BTC · ${dados.length} amostras com 12 meses à frente`;
    } catch (e) {
      status.textContent = 'erro: ' + (e.message || e);
    }
  }

  function botao() {
    const nav = document.querySelector('.side-nav-top') || document.querySelector('.side-nav');
    if (!nav || document.getElementById('nav-omega-prob')) return;
    const it = document.createElement('div');
    it.className = 'nav-item'; it.id = 'nav-omega-prob'; it.title = 'Ω-Score: modelo de probabilidade do retorno de 12 meses';
    it.innerHTML = '<span class="nav-icon">Ω%</span><span class="nav-lbl">Prob</span>';
    it.onclick = abrir;
    try{nav.insertBefore(it, nav.children[2] || null)}catch(e){nav.appendChild(it)}
  }
  window.VectraOmegaProb = { abrir };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', botao); else botao();
  setTimeout(botao, 3200);
})();
