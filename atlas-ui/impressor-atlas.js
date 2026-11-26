// VECTRA · Impressor de dados
//
// O painel lia a série, usava e jogava fora. Quando a corretora não respondia,
// robô e backtest ficavam sem histórico. Este módulo "imprime" cada leitura numa
// planilha persistente no próprio navegador (IndexedDB): junta o que já existe
// com o que chegou, sem repetir vela, e guarda as últimas 4.000 por par/tempo.
// Do mesmo depósito sai CSV para abrir no Excel/Sheets.
//
// Conceito de operação: o depósito é a fonte que o robô consulta antes de pedir
// à rede — o histórico já lido nunca mais é perdido.
(function () {
  'use strict';
  if (window.ImpressorAtlas) return;

  var DB_NOME = 'vectra-historico';
  var STORE = 'series';
  var TFS = ['5m', '15m', '1h', '4h', '1d'];   // principal + alternados
  var MAX_VELAS = 4000;
  var AUTO_MS = 60000;
  var el = {};
  var S = { auto: null, rodando: false, ultimo: null };

  /* ── banco ───────────────────────────────────────────────────────── */
  var aberto = null;
  function banco() {
    if (aberto) return aberto;
    aberto = new Promise(function (ok, falha) {
      var req = indexedDB.open(DB_NOME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'chave' });
      };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { falha(req.error); };
    });
    return aberto;
  }

  function lerSerie(chave) {
    return banco().then(function (db) {
      return new Promise(function (ok, falha) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(chave);
        req.onsuccess = function () { ok(req.result || null); };
        req.onerror = function () { falha(req.error); };
      });
    });
  }

  function gravarSerie(registro) {
    return banco().then(function (db) {
      return new Promise(function (ok, falha) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(registro);
        tx.oncomplete = function () { ok(registro); };
        tx.onerror = function () { falha(tx.error); };
      });
    });
  }

  function listarSeries() {
    return banco().then(function (db) {
      return new Promise(function (ok, falha) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { ok(req.result || []); };
        req.onerror = function () { falha(req.error); };
      });
    });
  }

  function apagarTudo() {
    return banco().then(function (db) {
      return new Promise(function (ok, falha) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = function () { ok(true); };
        tx.onerror = function () { falha(tx.error); };
      });
    });
  }

  /* ── impressão ───────────────────────────────────────────────────── */
  function chaveDe(sym, tf) { return sym + '|' + tf; }

  function juntar(antigas, novas) {
    var mapa = {};
    (antigas || []).concat(novas || []).forEach(function (c) {
      if (!c) return;
      var t = Number(c.time), fe = Number(c.close);
      if (!isfin(t) || !isfin(fe)) return;
      mapa[t] = {
        time: t,
        open: Number(c.open != null ? c.open : fe),
        high: Number(c.high != null ? c.high : fe),
        low: Number(c.low != null ? c.low : fe),
        close: fe,
        volume: Number(c.volume || 0)
      };
    });
    var out = Object.keys(mapa).map(Number).sort(function (a, b) { return a - b; }).map(function (t) { return mapa[t]; });
    return out.length > MAX_VELAS ? out.slice(-MAX_VELAS) : out;
  }

  function isfin(v) { return typeof v === 'number' && isFinite(v); }

  // imprime um par em todos os tempos (principal + alternados)
  async function imprimirPar(sym) {
    var feito = [];
    for (var i = 0; i < TFS.length; i++) {
      var tf = TFS[i], chave = chaveDe(sym, tf);
      var velas = null;
      try { velas = await window.fetchCandles(sym, tf, 800); } catch (e) { velas = null; }
      if (!Array.isArray(velas) || !velas.length) continue;
      var registro = await lerSerie(chave);
      var juntas = juntar(registro ? registro.velas : [], velas);
      if (registro && juntas.length === registro.velas.length && juntas.length &&
          juntas[juntas.length - 1].time === registro.velas[registro.velas.length - 1].time) {
        feito.push({ sym: sym, tf: tf, velas: juntas.length, novo: 0 });
        continue;
      }
      var antes = registro ? registro.velas.length : 0;
      await gravarSerie({ chave: chave, sym: sym, tf: tf, velas: juntas, atualizado: Date.now() });
      feito.push({ sym: sym, tf: tf, velas: juntas.length, novo: Math.max(0, juntas.length - antes) });
    }
    return feito;
  }

  async function imprimirAgora() {
    if (S.rodando) return null;
    var sym = (typeof currentSym !== 'undefined' && currentSym) ? currentSym : 'BTCUSDT';
    S.rodando = true;
    if (el.linha) el.linha.textContent = 'imprimindo ' + sym + ' em ' + TFS.join(' · ') + '...';
    var feito = [];
    try {
      feito = await imprimirPar(sym);
      S.ultimo = { sym: sym, quando: Date.now(), feito: feito };
      if (el.linha) {
        var novo = feito.reduce(function (s, f) { return s + f.novo; }, 0);
        el.linha.textContent = 'imprimido ' + sym + ' · ' + feito.length + ' tempos · ' + novo + ' velas novas · ' + hora(Date.now());
      }
    } catch (e) {
      if (el.linha) el.linha.textContent = 'não consegui imprimir agora: ' + (e && e.message ? e.message : e);
    } finally {
      S.rodando = false;
      renderizar();
    }
    return S.ultimo;
  }

  async function imprimirTudo() {
    if (S.rodando) return null;
    var lista = (typeof ALL_SYMS !== 'undefined' && ALL_SYMS.length) ? ALL_SYMS.slice() : [(typeof currentSym !== 'undefined' ? currentSym : 'BTCUSDT')];
    S.rodando = true;
    var total = 0;
    try {
      for (var i = 0; i < lista.length; i++) {
        if (el.linha) el.linha.textContent = 'imprimindo ' + (i + 1) + '/' + lista.length + ' · ' + lista[i];
        var feito = await imprimirPar(lista[i]);
        total += feito.reduce(function (s, f) { return s + f.novo; }, 0);
        if (i % 4 === 3) renderizar();
      }
      if (el.linha) el.linha.textContent = lista.length + ' ativos impressos · ' + total + ' velas novas · ' + hora(Date.now());
    } catch (e) {
      if (el.linha) el.linha.textContent = 'parou em ' + (e && e.message ? e.message : e);
    } finally {
      S.rodando = false;
      renderizar();
    }
    return total;
  }

  /* ── planilha (CSV) ──────────────────────────────────────────────── */
  var CABECALHO = 'simbolo,tempo,tempo_iso,abertura,maxima,minima,fechamento,volume\r\n';

  function linhaCSV(r, c) {
    return r.sym + ',' + r.tf + ',' + new Date(c.time * 1000).toISOString() + ',' +
      c.open + ',' + c.high + ',' + c.low + ',' + c.close + ',' + c.volume + '\r\n';
  }

  function baixar(nome, texto) {
    var blob = new Blob(['\ufeff' + texto], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  async function baixarCSV(tf) {
    var series = await listarSeries();
    var alvo = tf ? series.filter(function (r) { return r.tf === tf; }) : series;
    if (!alvo.length) { if (el.linha) el.linha.textContent = 'nada impresso ainda para ' + (tf || 'nenhum tempo'); return 0; }
    var partes = [CABECALHO], total = 0;
    alvo.forEach(function (r) {
      r.velas.forEach(function (c) { partes.push(linhaCSV(r, c)); total++; });
    });
    var nome = 'vectra-historico' + (tf ? '-' + tf : '') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    baixar(nome, partes.join(''));
    if (el.linha) el.linha.textContent = nome + ' · ' + total + ' velas';
    return total;
  }

  /* ── leitura para o robô ─────────────────────────────────────────── */
  // O robô consulta o depósito antes da rede: histórico impresso nunca se perde.
  async function serie(sym, tf) {
    try {
      var r = await lerSerie(chaveDe(sym, tf));
      return r && Array.isArray(r.velas) && r.velas.length > 29 ? r.velas : null;
    } catch (e) { return null; }
  }

  /* ── interface ───────────────────────────────────────────────────── */
  function hora(t) {
    var d = new Date(t);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function dataCurta(t) {
    var d = new Date(t * 1000);
    return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' + hora(t * 1000);
  }
  function num(v) { return Number(v).toLocaleString('pt-BR'); }

  async function renderizar() {
    if (!el.tabela) return;
    var series = await listarSeries();
    series.sort(function (a, b) { return (a.sym + a.tf).localeCompare(b.sym + b.tf); });
    if (!series.length) {
      el.tabela.innerHTML = '<tr><td colspan="4" style="color:#8a8f98">nada impresso ainda — toque em imprimir</td></tr>';
    } else {
      el.tabela.innerHTML = series.map(function (r) {
        var p = r.velas[0], u = r.velas[r.velas.length - 1];
        return '<tr><td>' + r.sym.replace('USDT', '') + ' · ' + r.tf + '</td>' +
          '<td class="n">' + num(r.velas.length) + '</td>' +
          '<td class="n">' + dataCurta(p.time) + '</td>' +
          '<td class="n">' + dataCurta(u.time) + '</td></tr>';
      }).join('');
    }
    if (el.resumo) {
      var total = series.reduce(function (s, r) { return s + r.velas.length; }, 0);
      el.resumo.textContent = series.length
        ? series.length + ' séries · ' + num(total) + ' velas guardadas'
        : 'sem dados guardados';
    }
  }

  function estilo() {
    if (document.getElementById('imp-estilo')) return;
    var s = document.createElement('style');
    s.id = 'imp-estilo';
    s.textContent = [
      '#impressor-card{background:#fff;border:1px solid #e4e4e6;border-radius:12px;padding:10px 11px;font-family:Inter,system-ui,sans-serif;color:#1c1c1e;font-size:11px}',
      '#impressor-card *{box-sizing:border-box}',
      '.imp-topo{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;margin-bottom:8px}',
      '.imp-btn{border:1px solid #e4e4e6;background:#fff;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;color:#1c1c1e;min-height:32px;font-family:inherit}',
      '.imp-btn.on{background:#1f7a4d;border-color:#1f7a4d;color:#fff}',
      '.imp-linha{font-size:10px;color:#8a8f98;margin:0 0 8px;font-variant-numeric:tabular-nums}',
      '.imp-tabela{width:100%;border-collapse:collapse;font-size:10.5px;font-variant-numeric:tabular-nums}',
      '.imp-tabela th{text-align:left;font-size:8px;letter-spacing:.5px;text-transform:uppercase;color:#8a8f98;border-bottom:1px solid #e4e4e6;padding:3px 2px;font-weight:700}',
      '.imp-tabela td{border-bottom:1px solid #f2f2f4;padding:3px 2px;white-space:nowrap}',
      '.imp-tabela td.n,.imp-tabela th.n{text-align:right}',
      '.imp-nota{font-size:9.5px;color:#8a8f98;margin-top:8px;line-height:1.5}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function montar() {
    if (document.getElementById('impressor-card')) return;
    estilo();
    var card = document.createElement('div');
    card.id = 'impressor-card';
    card.style.display = 'none';
    card.innerHTML = [
      '<div class="imp-topo">',
      ' <button type="button" class="imp-btn" id="imp-agora">imprimir agora</button>',
      ' <button type="button" class="imp-btn" id="imp-tudo">imprimir todos</button>',
      ' <button type="button" class="imp-btn" id="imp-auto">atualizar sozinho</button>',
      ' <button type="button" class="imp-btn" id="imp-csv">baixar CSV</button>',
      ' <button type="button" class="imp-btn" id="imp-limpar">limpar</button>',
      '</div>',
      '<div class="imp-linha" id="imp-linha">pronto para imprimir — ' + TFS.join(' · ') + '</div>',
      '<div style="max-height:240px;overflow:auto"><table class="imp-tabela"><thead><tr><th>série</th><th class="n">velas</th><th class="n">de</th><th class="n">até</th></tr></thead><tbody id="imp-corpo"></tbody></table></div>',
      '<div class="imp-nota" id="imp-resumo">sem dados guardados</div>',
      '<div class="imp-nota">O depósito fica no navegador (IndexedDB) e sobrevive a recarregar a página: é a primeira fonte que o robô consulta antes de pedir à rede. O CSV sai com todas as séries guardadas, uma linha por vela.</div>'
    ].join('');
    document.body.appendChild(card);

    el.card = card;
    el.linha = card.querySelector('#imp-linha');
    el.tabela = card.querySelector('#imp-corpo');
    el.resumo = card.querySelector('#imp-resumo');
    el.auto = card.querySelector('#imp-auto');

    card.querySelector('#imp-agora').addEventListener('click', function () { imprimirAgora(); });
    card.querySelector('#imp-tudo').addEventListener('click', function () { imprimirTudo(); });
    card.querySelector('#imp-csv').addEventListener('click', function () { baixarCSV(null); });
    card.querySelector('#imp-limpar').addEventListener('click', function () {
      apagarTudo().then(function () { renderizar(); if (el.linha) el.linha.textContent = 'depósito limpo'; });
    });
    el.auto.addEventListener('click', function () { alternarAuto(); });

    renderizar();
  }

  function alternarAuto() {
    if (S.auto) {
      clearInterval(S.auto);
      S.auto = null;
      if (el.auto) el.auto.classList.remove('on');
      if (el.linha) el.linha.textContent = 'atualização automática desligada';
      return;
    }
    S.auto = setInterval(function () {
      if (document.visibilityState === 'visible' && !S.rodando) imprimirAgora();
    }, AUTO_MS);
    if (el.auto) el.auto.classList.add('on');
    if (el.linha) el.linha.textContent = 'atualizando a cada ' + Math.round(AUTO_MS / 1000) + 's (aba visível)';
  }

  function iniciar() {
    montar();
    // primeira impressão em segundo plano, sem competir com o gráfico
    setTimeout(function () { if (!S.rodando) imprimirAgora(); }, 8000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else setTimeout(iniciar, 400);

  window.ImpressorAtlas = {
    imprimirAgora: imprimirAgora,
    imprimirTudo: imprimirTudo,
    serie: serie,
    listar: listarSeries,
    baixarCSV: baixarCSV,
    limpar: apagarTudo,
    estado: S,
    tfs: TFS
  };
})();
