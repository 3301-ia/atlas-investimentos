// VECTRA · Backtest reprodutível da escada de travas
//
// Implementação fiel ao Anexo B do relatório técnico de 20/11/2026.
// Roda no navegador (window.VectraBacktest) e em Node (module.exports).
//
// Procedimento (Anexo B):
//   1. Carregar velas no formato tempo, abertura, fechamento, máxima, mínima, volume
//   2. Validar que máxima >= abertura e >= fechamento, mínima <= abertura e <= fechamento
//   3. Calcular EMA 8, EMA 16, RSI 14, ATR 14
//   4. Gerar cruzamentos com confirmação de RSI
//   5. Para cada cruzamento, percorrer velas: stop, alvo, abertura/fechamento de travas
//   6. Ordem conservadora: stop antes de alvo
//   7. Somar resultado por ciclo em USD com 0,01 lote
//   8. Calcular drawdown, acerto, sequência de perdas, resultado por metade
//
// CORREÇÃO DE LEITURA (seção 2 do relatório): a ponte entrega a vela na ordem
//   [tempo, abertura, fechamento, máxima, mínima, volume]
// e NÃO em OHLC. Ler como OHLC troca a máxima pelo fechamento e inverte o
// gatilho dos stops. Aqui a ordem da ponte é a padrão e a validação do passo 2
// aborta a série se ela estiver em OHLC, em vez de produzir resultado falso.
(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) raiz.VectraBacktest = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /* ── Referência do relatório (para conferência automática) ────────── */
  var REFERENCIA = {
    ciclos: 599,
    resultado: 684.52,
    principal: 169.16,
    travas: 515.34,
    acerto: 0.442,
    queda: 15.45,
    piorSequencia: 11,
    reserva: 68.45,
    tolerancia: 0.02,
    niveis: [
      { nivel: 1 / 3, aberturas: 388, acerto: 0.75, pctCiclos: 0.648 },
      { nivel: 2 / 3, aberturas: 318, acerto: 0.93, pctCiclos: 0.531 },
      { nivel: 1.0, aberturas: 241, acerto: 0.93, pctCiclos: 0.402 },
      { nivel: 4 / 3, aberturas: 169, acerto: 0.98, pctCiclos: 0.282 },
      { nivel: 5 / 3, aberturas: 103, acerto: 1.0, pctCiclos: 0.172 }
    ]
  };

  /* ── Configuração padrão (Anexo A) ──────────────────────────────── */
  var DEFAULTS = {
    ativo: 'BTCUSDT',
    tf: '15m',
    lote: 0.01,
    emaRapida: 8,
    emaLenta: 16,
    rsiPeriodo: 14,
    rsiCompra: 55,
    rsiVenda: 45,
    atrPeriodo: 14,
    stopATR: 1.0,
    alvoR: 2.0,
    niveis: [1 / 3, 2 / 3, 1, 4 / 3, 5 / 3],
    fator: 0.60,
    alvoTrava: 0.5,
    corteTrava: 0.5,
    reservaPct: 0.10,
    // false = regra do relatório (a trava aberta na vela pode fechar na mesma vela)
    // true  = conservador (a trava só fecha a partir da vela seguinte)
    travaSoNaVelaSeguinte: false,
    // Trava encerrada junto com o ciclo: o relatório soma com o sinal
    // invertido (18 travas, +US$ 9,30 que deveriam ser -US$ 9,30).
    // false reproduz o documento; true aplica a contabilidade correta.
    corrigirSinalEncerrada: false
  };

  /* ── Normalização da série ──────────────────────────────────────── */
  // Aceita [t, abertura, fechamento, máxima, mínima, volume] (formato da ponte)
  // ou objetos {t|time, o|open, h|high, l|low, c|close, v|volume}.
  function normalizarVelas(velas, ordem) {
    var out = [], i, v;
    ordem = ordem || 'ponte';
    for (i = 0; i < velas.length; i++) {
      v = velas[i];
      if (Array.isArray(v)) {
        if (ordem === 'ohlc') out.push({ t: v[0], o: v[1], h: v[2], l: v[3], c: v[4], v: v[5] });
        else out.push({ t: v[0], o: v[1], c: v[2], h: v[3], l: v[4], v: v[5] });
      } else {
        out.push({
          t: v.t != null ? v.t : v.time,
          o: num(v.o != null ? v.o : v.open),
          h: num(v.h != null ? v.h : v.high),
          l: num(v.l != null ? v.l : v.low),
          c: num(v.c != null ? v.c : v.close),
          v: num(v.v != null ? v.v : v.volume)
        });
      }
    }
    return out;
  }

  function num(x) { var n = Number(x); return isFinite(n) ? n : NaN; }

  /* ── Indicadores ────────────────────────────────────────────────── */
  function ema(src, p) {
    var k = 2 / (p + 1), out = [], s = null;
    for (var i = 0; i < src.length; i++) {
      s = s === null ? src[i] : src[i] * k + s * (1 - k);
      out.push(s);
    }
    return out;
  }

  function rsi(src, p) {
    var out = new Array(src.length).fill(50), g = 0, l = 0;
    for (var i = 1; i < src.length; i++) {
      var d = src[i] - src[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i === 1) { g = up; l = dn; }
      else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; }
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }

  function atr(velas, p) {
    var tr = [0], out = new Array(velas.length).fill(null), s = null, i, j, k, q;
    for (i = 1; i < velas.length; i++) {
      tr[i] = Math.max(
        velas[i].h - velas[i].l,
        Math.abs(velas[i].h - velas[i - 1].c),
        Math.abs(velas[i].l - velas[i - 1].c)
      );
    }
    for (j = p; j < velas.length; j++) {
      if (s === null) { q = 0; for (k = j - p + 1; k <= j; k++) q += tr[k]; s = q / p; }
      else s = (s * (p - 1) + tr[j]) / p;
      out[j] = s;
    }
    return out;
  }

  /* ── Validação (Passo 2 do Anexo B) ──────────────────────────────── */
  function validar(velas) {
    for (var i = 0; i < velas.length; i++) {
      var v = velas[i];
      if (!isFinite(v.o) || !isFinite(v.h) || !isFinite(v.l) || !isFinite(v.c)) {
        return { ok: false, vela: i, erro: 'vela com preço não numérico' };
      }
      if (v.h < v.o || v.h < v.c) return { ok: false, vela: i, erro: 'máxima < abertura ou fechamento' };
      if (v.l > v.o || v.l > v.c) return { ok: false, vela: i, erro: 'mínima > abertura ou fechamento' };
    }
    return { ok: true };
  }

  // Normaliza + valida, com a trava do erro histórico de leitura.
  function prepararVelas(velas, ordem) {
    var v = normalizarVelas(velas, ordem);
    var ok = validar(v);
    if (ok.ok) return { velas: v };
    if (!ordem) {
      var alt = normalizarVelas(velas, 'ohlc');
      if (validar(alt).ok) {
        return {
          erro: 'A série parece estar em OHLC (abertura, máxima, mínima, fechamento), não no formato da ponte ' +
            '(tempo, abertura, fechamento, máxima, mínima). A vela ' + ok.vela + ' falhou: ' + ok.erro +
            '. Corrija a ordem da série ou passe ordem "ohlc" de propósito.'
        };
      }
    }
    return { erro: 'Validação falhou na vela ' + ok.vela + ': ' + ok.erro };
  }

  /* ── Motor principal do backtest ────────────────────────────────── */
  function rodar(velasBrutas, cfg) {
    cfg = cfg || {};
    var C = {}, k;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) {
      C[k] = cfg[k] !== undefined ? cfg[k] : DEFAULTS[k];
    }

    var prep = prepararVelas(velasBrutas, cfg.ordem);
    if (prep.erro) return { erro: prep.erro };
    var velas = prep.velas;

    // Indicadores
    var closes = velas.map(function (v) { return v.c; });
    var e8 = ema(closes, C.emaRapida);
    var e16 = ema(closes, C.emaLenta);
    var r14 = rsi(closes, C.rsiPeriodo);
    var a14 = atr(velas, C.atrPeriodo);

    var ciclos = [];
    var pos = null;
    var equity = 0, topo = 0, quedaMax = 0;
    var seqPerdas = 0, maxSeq = 0;
    var reservaPeriodo = 0, reservaGiroPositivo = 0;
    var i, j;

    function fecharCiclo(preco, motivo) {
      var p = pos;
      p.travas.forEach(function (t) {
        if (t.estado === 'aberta') {
          t.resultado = C.corrigirSinalEncerrada
            ? (preco - t.preco) * t.lado * t.tamanho
            : (t.preco - preco) * (-p.lado) * t.tamanho;
          t.estado = 'encerrada';
          p.pnlTravas += t.resultado;
        }
      });
      var principal = (preco - p.entrada) * p.lado * p.tamanho;
      var total = principal + p.pnlTravas;
      ciclos.push({
        ciclo_id: ciclos.length + 1,
        i: p.i,
        saida_i: p.saida_i,
        lado: p.lado,
        preco_entrada: p.entrada,
        saida_principal: preco,
        motivo_saida: motivo,
        atr_entrada: p.atr,
        risco_preco: p.risco,
        risco_usd: p.risco * p.tamanho,
        resultado_principal: principal,
        resultado_travas: p.pnlTravas,
        resultado_total: total,
        resultado_r: total / (p.risco * p.tamanho),
        travas: p.travas.slice()
      });
      equity += total;
      if (total > 0) { reservaGiroPositivo += total * C.reservaPct; seqPerdas = 0; }
      else { seqPerdas++; if (seqPerdas > maxSeq) maxSeq = seqPerdas; }
      if (equity > topo) topo = equity;
      var dd = topo - equity;
      if (dd > quedaMax) quedaMax = dd;
      pos = null;
    }

    for (i = 1; i < velas.length; i++) {
      if (a14[i] == null) continue;
      var v = velas[i];

      /* Entrada (Passo 4) */
      if (!pos) {
        var sinal = 0;
        if (e8[i - 1] <= e16[i - 1] && e8[i] > e16[i] && r14[i] > C.rsiCompra) sinal = 1;
        else if (e8[i - 1] >= e16[i - 1] && e8[i] < e16[i] && r14[i] < C.rsiVenda) sinal = -1;
        if (sinal) {
          var risco = C.stopATR * a14[i];
          pos = {
            lado: sinal, i: i, saida_i: i, entrada: v.c, atr: a14[i], risco: risco, tamanho: C.lote,
            stop: v.c - sinal * risco, alvo: v.c + sinal * C.alvoR * risco,
            travas: [], usados: {}, pnlTravas: 0
          };
        }
        continue;
      }

      /* Passo 6: stop antes de alvo (ordem conservadora) */
      var fechou = false;
      if (pos.lado === 1 && v.l <= pos.stop) {
        pos.saida_i = i;
        fecharCiclo(Math.min(pos.stop, v.o), 'stop');
        fechou = true;
      } else if (pos.lado === -1 && v.h >= pos.stop) {
        pos.saida_i = i;
        fecharCiclo(Math.max(pos.stop, v.o), 'stop');
        fechou = true;
      } else if (pos.lado === 1 && v.h >= pos.alvo) {
        pos.saida_i = i;
        fecharCiclo(pos.alvo, 'alvo');
        fechou = true;
      } else if (pos.lado === -1 && v.l <= pos.alvo) {
        pos.saida_i = i;
        fecharCiclo(pos.alvo, 'alvo');
        fechou = true;
      }
      // A trava nunca abre no mesmo instante em que o ciclo fecha (seção 22).
      if (fechou) continue;

      /* Abertura de travas (Passo 6) */
      for (j = 0; j < C.niveis.length; j++) {
        if (pos.usados[j]) continue;
        var niv = C.niveis[j];
        var nivel = pos.entrada + pos.lado * niv * pos.risco;
        if ((pos.lado === 1 && v.h >= nivel) || (pos.lado === -1 && v.l <= nivel)) {
          pos.travas.push({
            nivel: niv, preco: nivel, lado: -pos.lado, tamanho: C.fator * C.lote,
            alvo: nivel - pos.lado * C.alvoTrava * pos.risco,
            corte: nivel + pos.lado * C.corteTrava * pos.risco,
            aberta_i: i, estado: 'aberta', resultado: 0
          });
          pos.usados[j] = 1;
        }
      }

      /* Fechamento de travas (Passo 6) */
      pos.travas.forEach(function (t) {
        if (t.estado !== 'aberta') return;
        if (C.travaSoNaVelaSeguinte && t.aberta_i >= i) return;
        if (pos.lado === 1) {
          if (v.l <= t.alvo) { t.resultado = (t.preco - t.alvo) * t.tamanho; t.estado = 'alvo'; pos.pnlTravas += t.resultado; }
          else if (v.h >= t.corte) { t.resultado = (t.preco - t.corte) * t.tamanho; t.estado = 'corte'; pos.pnlTravas += t.resultado; }
        } else {
          if (v.h >= t.alvo) { t.resultado = (t.alvo - t.preco) * t.tamanho; t.estado = 'alvo'; pos.pnlTravas += t.resultado; }
          else if (v.l <= t.corte) { t.resultado = (t.corte - t.preco) * t.tamanho; t.estado = 'corte'; pos.pnlTravas += t.resultado; }
        }
      });
    }

    // Posição aberta no fim da série
    if (pos) {
      pos.saida_i = velas.length - 1;
      fecharCiclo(velas[velas.length - 1].c, 'fim_serie');
    }

    /* ── Estatísticas ─────────────────────────────────────────────── */
    var totalPrincipal = 0, totalTravas = 0, acertos = 0;
    ciclos.forEach(function (c) {
      totalPrincipal += c.resultado_principal;
      totalTravas += c.resultado_travas;
      if (c.resultado_total > 0) acertos++;
    });
    var partes = totalPrincipal + totalTravas;

    // Por nível: aberturas = travas que fecharam em alvo ou corte.
    // As travas encerradas junto com o ciclo principal não contam como
    // abertura, que é a contabilização do relatório (388/318/241/169/103).
    var nivelStats = C.niveis.map(function (niv) {
      var ab = 0, ac = 0, cortes = 0, encerradas = 0, pnl = 0, ciclosCom = 0;
      ciclos.forEach(function (c) {
        var teve = false;
        c.travas.forEach(function (t) {
          if (Math.abs(t.nivel - niv) > 0.01) return;
          teve = true;
          pnl += t.resultado;
          if (t.estado === 'alvo') { ab++; ac++; }
          else if (t.estado === 'corte') { ab++; cortes++; }
          else encerradas++;
        });
        if (teve) ciclosCom++;
      });
      return {
        nivel: niv, aberturas: ab, acertos: ac, cortes: cortes, encerradas: encerradas,
        acerto: ab > 0 ? ac / ab : 0, pnl: pnl,
        ciclosCom: ciclosCom, pctCiclos: ciclos.length ? ciclosCom / ciclos.length : 0
      };
    });

    // Distribuição dos ciclos (seção 10 do relatório)
    var faixas = { perdaMaior1R: 0, perdaAte1R: 0, empate: 0, ganho1a3R: 0, ganhoAcima3R: 0 };
    ciclos.forEach(function (c) {
      var r = c.resultado_r;
      if (r < -1) faixas.perdaMaior1R++;
      else if (r < 0) faixas.perdaAte1R++;
      else if (r <= 1) faixas.empate++;
      else if (r <= 3) faixas.ganho1a3R++;
      else faixas.ganhoAcima3R++;
    });

    var metade = Math.floor(ciclos.length / 2);
    function sumarizar(lista) {
      var s = 0, a = 0;
      lista.forEach(function (c) { s += c.resultado_total; if (c.resultado_total > 0) a++; });
      return { ciclos: lista.length, lucro: s, acerto: lista.length ? a / lista.length : 0 };
    }

    var duracoes = ciclos.map(function (c) { return c.saida_i - c.i; });
    duracoes.sort(function (a, b) { return a - b; });

    return {
      config: C,
      velas: velas.length,
      ciclos: ciclos.length,
      resultado: equity,
      mediaCiclo: ciclos.length ? equity / ciclos.length : 0,
      acerto: ciclos.length ? acertos / ciclos.length : 0,
      quedaMaxima: quedaMax,
      piorSequencia: maxSeq,
      lucroQueda: quedaMax > 0 ? equity / quedaMax : Infinity,
      principal: totalPrincipal,
      travas: totalTravas,
      pctPrincipal: partes !== 0 ? totalPrincipal / partes : 0,
      pctTravas: partes !== 0 ? totalTravas / partes : 0,
      // Reserva do relatório (seção 21): 10% do resultado do período.
      reserva: equity * C.reservaPct,
      // Regra do Lucas lida como "10% de cada giro positivo" (Anexo A).
      reservaGiroPositivo: reservaGiroPositivo,
      piorCiclo: ciclos.length ? Math.min.apply(null, ciclos.map(function (c) { return c.resultado_total; })) : 0,
      melhorCiclo: ciclos.length ? Math.max.apply(null, ciclos.map(function (c) { return c.resultado_total; })) : 0,
      duracaoMedia: duracoes.length ? duracoes.reduce(function (a, b) { return a + b; }, 0) / duracoes.length : 0,
      duracaoMediana: duracoes.length ? duracoes[Math.floor(duracoes.length / 2)] : 0,
      faixas: faixas,
      primeiraMetade: sumarizar(ciclos.slice(0, metade)),
      segundaMetade: sumarizar(ciclos.slice(metade)),
      nivelStats: nivelStats,
      listaCiclos: ciclos
    };
  }

  /* ── Conferência contra o relatório ─────────────────────────────── */
  function conferir(r) {
    if (!r || r.erro) return { ok: false, erro: r && r.erro };
    var itens = [];
    function item(nome, obtido, esperado, tol, unidade) {
      var dif = esperado === 0 ? Math.abs(obtido) : Math.abs(obtido - esperado) / Math.abs(esperado);
      itens.push({
        nome: nome, obtido: obtido, esperado: esperado, unidade: unidade || '',
        dif: dif, ok: dif <= (tol === undefined ? REFERENCIA.tolerancia : tol)
      });
    }
    item('resultado', r.resultado, REFERENCIA.resultado, 0.02, 'US$');
    item('principal', r.principal, REFERENCIA.principal, 0.02, 'US$');
    item('travas', r.travas, REFERENCIA.travas, 0.02, 'US$');
    item('acerto', r.acerto, REFERENCIA.acerto, 0.03, '%');
    item('queda máxima', r.quedaMaxima, REFERENCIA.queda, 0.05, 'US$');
    itens.push({ nome: 'ciclos', obtido: r.ciclos, esperado: REFERENCIA.ciclos, unidade: '', dif: Math.abs(r.ciclos - REFERENCIA.ciclos) / REFERENCIA.ciclos, ok: r.ciclos === REFERENCIA.ciclos });
    itens.push({ nome: 'pior sequência', obtido: r.piorSequencia, esperado: REFERENCIA.piorSequencia, unidade: '', dif: 0, ok: r.piorSequencia === REFERENCIA.piorSequencia });
    REFERENCIA.niveis.forEach(function (ref, k) {
      var s = r.nivelStats[k];
      if (!s) return;
      itens.push({
        nome: 'aberturas nível ' + (k + 1), obtido: s.aberturas, esperado: ref.aberturas, unidade: '',
        dif: ref.aberturas ? Math.abs(s.aberturas - ref.aberturas) / ref.aberturas : 0,
        ok: s.aberturas === ref.aberturas
      });
    });
    return { ok: itens.every(function (i) { return i.ok; }), itens: itens };
  }

  /* ── Relatório no console ───────────────────────────────────────── */
  function imprimir(r, log) {
    log = log || (typeof console !== 'undefined' ? console : { log: function () {} });
    if (!r || r.erro) { log.log('[VECTRA BACKTEST] ' + (r && r.erro)); return; }
    var f = function (v, c) { return Number(v).toFixed(c == null ? 2 : c); };
    log.log('\n═══════════════════════════════════════════════════');
    log.log(' VECTRA · Backtest da Escada de Travas');
    log.log('═══════════════════════════════════════════════════');
    log.log(' Velas:          ' + r.velas);
    log.log(' Ciclos:         ' + r.ciclos);
    log.log(' Resultado:      US$ ' + f(r.resultado));
    log.log(' Média/ciclo:    US$ ' + f(r.mediaCiclo));
    log.log(' Acerto:         ' + f(r.acerto * 100, 1) + '%');
    log.log(' Queda máxima:   US$ ' + f(r.quedaMaxima));
    log.log(' Pior sequência: ' + r.piorSequencia);
    log.log(' Lucro/Queda:    ' + f(r.lucroQueda, 1));
    log.log('─────────────────────────────────────────────────');
    log.log(' Principal:      US$ ' + f(r.principal) + ' (' + f(r.pctPrincipal * 100, 1) + '%)');
    log.log(' Travas:         US$ ' + f(r.travas) + ' (' + f(r.pctTravas * 100, 1) + '%)');
    log.log(' Reserva (10%):  US$ ' + f(r.reserva));
    log.log('─────────────────────────────────────────────────');
    log.log(' Por nível:');
    r.nivelStats.forEach(function (n) {
      log.log('   ' + n.nivel.toFixed(3) + 'R: ' + n.aberturas + ' aberturas, ' +
        f(n.acerto * 100, 0) + '% acerto, ' + f(n.pctCiclos * 100, 1) + '% dos ciclos, US$ ' + f(n.pnl));
    });
    log.log('─────────────────────────────────────────────────');
    log.log(' 1ª metade: ' + r.primeiraMetade.ciclos + ' ciclos, US$ ' + f(r.primeiraMetade.lucro) + ', ' + f(r.primeiraMetade.acerto * 100, 1) + '% acerto');
    log.log(' 2ª metade: ' + r.segundaMetade.ciclos + ' ciclos, US$ ' + f(r.segundaMetade.lucro) + ', ' + f(r.segundaMetade.acerto * 100, 1) + '% acerto');
    log.log('═══════════════════════════════════════════════════');

    var conf = conferir(r);
    if (conf.ok) log.log(' ✓ REPRODUÇÃO OK: todos os números do relatório conferem.');
    else {
      log.log(' ⚠ DIVERGÊNCIA do relatório:');
      conf.itens.filter(function (i) { return !i.ok; }).forEach(function (i) {
        log.log('   · ' + i.nome + ': obtido ' + i.obtido + ', esperado ' + i.esperado + ' ' + i.unidade);
      });
    }
    log.log('');
  }

  return {
    rodar: rodar,
    imprimir: imprimir,
    validar: validar,
    conferir: conferir,
    normalizarVelas: normalizarVelas,
    defaults: DEFAULTS,
    referencia: REFERENCIA
  };
});
