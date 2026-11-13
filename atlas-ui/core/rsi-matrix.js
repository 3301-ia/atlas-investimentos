/* ── RSI Matrix ────────────────────────────────────────────────────────────
   Núcleo puro (sem DOM, sem socket). É o RSI clássico com o que o indicador
   do Guto faz de mais útil: além do RSI e da EMA do RSI, ele resolve o
   caminho de volta — qual PREÇO o mercado precisa tocar para o RSI chegar
   num valor escolhido (27, 70, 30, o que você digitar). Com isso o nível
   vira uma linha de preço no gráfico, e não um número solto na tela.

   Regra de ouro: nunca estourar. Série suja é limpa antes da conta; se não
   der para calcular, devolve o motivo em vez de número inventado.          */
(function (raiz) {
  'use strict';

  var PADRAO = {
    fonte: 'close',            // close | open | high | low | hl2 | hlc3 | ohlc4
    rsiLen: 14,
    emaLen: 12,
    sobrecompra: 70,
    sobrevenda: 30,
    mostrarPainel: true,
    deslocamento: 35,
    mostrarNivelRsiEntrada: true,
    rsiEntrada: 27,
    mostrarRsiDoPreco: false,
    precoEntrada: 10000,
    decimais: 2,
    fundoInvisivel: false
  };

  function numero(v, reserva) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : reserva;
  }
  function limitar(v, min, max, reserva) {
    var n = numero(v, reserva);
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  // opções saneadas: qualquer coisa fora de faixa volta para o padrão
  function opcoes(op) {
    var o = op || {};
    return {
      fonte: ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'].indexOf(o.fonte) >= 0 ? o.fonte : PADRAO.fonte,
      rsiLen: Math.round(limitar(o.rsiLen, 2, 200, PADRAO.rsiLen)),
      emaLen: Math.round(limitar(o.emaLen, 1, 200, PADRAO.emaLen)),
      sobrecompra: limitar(o.sobrecompra, 51, 99, PADRAO.sobrecompra),
      sobrevenda: limitar(o.sobrevenda, 1, 49, PADRAO.sobrevenda),
      mostrarPainel: o.mostrarPainel !== false,
      deslocamento: Math.round(limitar(o.deslocamento, 0, 400, PADRAO.deslocamento)),
      mostrarNivelRsiEntrada: o.mostrarNivelRsiEntrada !== false,
      rsiEntrada: limitar(o.rsiEntrada, 1, 99, PADRAO.rsiEntrada),
      mostrarRsiDoPreco: o.mostrarRsiDoPreco === true,
      precoEntrada: limitar(o.precoEntrada, 0, 1e12, PADRAO.precoEntrada),
      decimais: Math.round(limitar(o.decimais, 0, 8, PADRAO.decimais)),
      fundoInvisivel: o.fundoInvisivel === true
    };
  }

  // série saneada: sem nulo, sem tempo repetido, em ordem crescente
  function limparVelas(velas) {
    if (!Array.isArray(velas)) return [];
    var saida = [], ultimoTempo = -Infinity;
    for (var i = 0; i < velas.length; i++) {
      var v = velas[i];
      if (!v || typeof v !== 'object') continue;
      var c = numero(v.close, NaN);
      if (!Number.isFinite(c) || c <= 0) continue;
      var t = numero(v.time, NaN);
      if (!Number.isFinite(t) || t <= ultimoTempo) continue;
      var abre = numero(v.open, c), alta = numero(v.high, c), baixa = numero(v.low, c);
      if (baixa <= 0 || alta <= 0) { alta = Math.max(c, abre); baixa = Math.min(c, abre); }
      saida.push({ time: t, open: abre, high: alta, low: baixa, close: c, volume: numero(v.volume, 0) });
      ultimoTempo = t;
    }
    return saida;
  }

  function valorFonte(v, fonte) {
    switch (fonte) {
      case 'open': return v.open;
      case 'high': return v.high;
      case 'low': return v.low;
      case 'hl2': return (v.high + v.low) / 2;
      case 'hlc3': return (v.high + v.low + v.close) / 3;
      case 'ohlc4': return (v.open + v.high + v.low + v.close) / 4;
      default: return v.close;
    }
  }

  function serieFonte(velas, fonte) {
    var s = new Array(velas.length);
    for (var i = 0; i < velas.length; i++) s[i] = valorFonte(velas[i], fonte);
    return s;
  }

  // RSI de Wilder, igual ao do gráfico: média suavizada, não média simples
  function rsi(valores, len) {
    var n = valores.length, saida = new Array(n);
    if (n < len + 1) return { valores: saida, ganho: null, perda: null };
    var ganho = 0, perda = 0, i;
    for (i = 1; i <= len; i++) {
      var d = valores[i] - valores[i - 1];
      if (d > 0) ganho += d; else perda -= d;
    }
    ganho /= len; perda /= len;
    saida[len] = perda === 0 ? 100 : (ganho === 0 ? 0 : 100 - 100 / (1 + ganho / perda));
    for (i = len + 1; i < n; i++) {
      var diff = valores[i] - valores[i - 1];
      var g = diff > 0 ? diff : 0, p = diff < 0 ? -diff : 0;
      ganho = (ganho * (len - 1) + g) / len;
      perda = (perda * (len - 1) + p) / len;
      saida[i] = perda === 0 ? 100 : (ganho === 0 ? 0 : 100 - 100 / (1 + ganho / perda));
    }
    return { valores: saida, ganho: ganho, perda: perda };
  }

  function ema(valores, len) {
    var n = valores.length, saida = new Array(n);
    if (!n || len < 1) return saida;
    var k = 2 / (len + 1), soma = 0, contou = 0, anterior = null;
    for (var i = 0; i < n; i++) {
      var v = valores[i];
      if (!Number.isFinite(v)) { saida[i] = anterior; continue; }
      if (anterior === null) {
        soma += v; contou++;
        if (contou >= Math.min(len, 20)) { anterior = soma / contou; saida[i] = anterior; }
        else saida[i] = null;
        continue;
      }
      anterior = v * k + anterior * (1 - k);
      saida[i] = anterior;
    }
    return saida;
  }

  /* Qual preço faz o RSI valer o alvo no PRÓXIMO fechamento?
     RSI = 100 * G / (G + L)  →  com R = RSI/(100-RSI), vale R = G/L.
     Na suavização de Wilder: G' = (G*(n-1) + ganho) / n, L' = (L*(n-1) + perda) / n.
     Se o preço subir (p > c): perda = 0, então G' = R * L * (n-1) / n  ...
     Resolvendo para os dois lados chegamos nas expressões abaixo.            */
  function precoParaRsi(args) {
    var c = numero(args.close, NaN), G = numero(args.ganho, NaN), L = numero(args.perda, NaN);
    var len = Math.round(limitar(args.len, 2, 200, 14));
    var alvo = limitar(args.alvoRsi, 1, 99, 50);
    var atual = numero(args.rsiAtual, NaN);
    if (!Number.isFinite(c) || c <= 0 || !Number.isFinite(G) || !Number.isFinite(L)) {
      return { preco: null, viavel: false, motivo: 'sem média de RSI ainda' };
    }
    if (alvo <= 0 || alvo >= 100) return { preco: null, viavel: false, motivo: 'RSI no limite' };

    var R = alvo / (100 - alvo), suave = len - 1;
    // o lado é decidido por onde o alvo está em relação ao RSI de agora:
    // alvo acima do atual exige preço subindo; abaixo, preço caindo
    var paraCima = !Number.isFinite(atual) ? true : alvo >= atual;
    var preco, lado, motivo = null;

    if (paraCima) {
      // G' = (G*suave + d)/len, L' = L*suave/len, com d = p - c
      var d = R * L * suave - G * suave;
      if (d < 0) { motivo = 'o alvo pede queda, não alta'; }
      preco = c + d; lado = 'alta';
    } else {
      // G' = G*suave/len, L' = (L*suave + x)/len, com x = c - p
      var x = (R > 0 ? G * suave / R : Infinity) - L * suave;
      if (x < 0) { motivo = 'o alvo pede alta, não queda'; }
      preco = c - x; lado = 'baixa';
      if (preco <= 0 && !motivo) { motivo = 'o movimento exigido passa do preço'; }
    }

    if (motivo || !Number.isFinite(preco) || preco <= 0) {
      return { preco: null, viavel: false, motivo: motivo || 'sem solução com esses parâmetros', lado: lado, alvoRsi: alvo };
    }
    var variacao = Math.abs(preco - c) / c;
    return {
      preco: preco, viavel: true, lado: lado, alvoRsi: alvo,
      distancia: preco - c, distanciaPct: (preco - c) / c * 100,
      extremo: variacao > 0.25
    };
  }

  // Se o próximo fechamento fosse esse preço, o RSI estaria em quanto?
  function rsiParaPreco(args) {
    var c = numero(args.close, NaN), G = numero(args.ganho, NaN), L = numero(args.perda, NaN);
    var len = Math.round(limitar(args.len, 2, 200, 14));
    var preco = numero(args.preco, NaN);
    if (!Number.isFinite(c) || !Number.isFinite(preco) || preco <= 0 || !Number.isFinite(G) || !Number.isFinite(L)) {
      return { rsi: null, viavel: false, motivo: 'faltam médias' };
    }
    var g = preco > c ? preco - c : 0, p = preco < c ? c - preco : 0;
    var Gp = (G * (len - 1) + g) / len, Lp = (L * (len - 1) + p) / len;
    if (Lp === 0) return { rsi: 100, viavel: true, preco: preco };
    if (Gp === 0) return { rsi: 0, viavel: true, preco: preco };
    return { rsi: 100 - 100 / (1 + Gp / Lp), viavel: true, preco: preco };
  }

  function calcular(velas, op) {
    try {
      var o = opcoes(op);
      var limpas = limparVelas(velas);
      var minimo = o.rsiLen + 3;
      if (limpas.length < minimo) {
        return {
          ok: false, motivo: 'faltam velas', faltam: minimo - limpas.length,
          barras: limpas.length, minimo: minimo, opcoes: o
        };
      }
      var fonte = serieFonte(limpas, o.fonte);
      var r = rsi(fonte, o.rsiLen);
      var e = ema(r.valores, o.emaLen);
      var serie = [];
      for (var i = 0; i < limpas.length; i++) {
        if (r.valores[i] == null && e[i] == null) continue;
        serie.push({ time: limpas[i].time, rsi: r.valores[i], ema: e[i] == null ? null : e[i] });
      }
      var ultimo = limpas[limpas.length - 1];
      var vr = r.valores[r.valores.length - 1];
      var ve = e[e.length - 1];
      if (vr == null) return { ok: false, motivo: 'RSI sem valor', barras: limpas.length, opcoes: o };

      var anterior = r.valores[r.valores.length - 2];
      var cruz = null;
      if (ve != null && anterior != null && typeof e[e.length - 2] === 'number') {
        var before = anterior - e[e.length - 2], now = vr - ve;
        if (before <= 0 && now > 0) cruz = 'subiu';
        if (before >= 0 && now < 0) cruz = 'desceu';
      }

      var niveis = [];
      if (o.mostrarNivelRsiEntrada) {
        niveis.push(montarNivel('RSI ' + arredondar(o.rsiEntrada, 2), o.rsiEntrada, ultimo.close, r, o.rsiLen, vr));
      }
      niveis.push(montarNivel('Sobrecompra ' + arredondar(o.sobrecompra, 2), o.sobrecompra, ultimo.close, r, o.rsiLen, vr));
      niveis.push(montarNivel('Sobrevenda ' + arredondar(o.sobrevenda, 2), o.sobrevenda, ultimo.close, r, o.rsiLen, vr));

      var doPreco = null;
      if (o.mostrarRsiDoPreco) {
        doPreco = rsiParaPreco({ close: ultimo.close, ganho: r.ganho, perda: r.perda, len: o.rsiLen, preco: o.precoEntrada });
      }

      var estado = 'neutro';
      if (vr >= o.sobrecompra) estado = 'sobrecompra';
      else if (vr <= o.sobrevenda) estado = 'sobrevenda';

      return {
        ok: true, opcoes: o, barras: limpas.length,
        preco: ultimo.close, tempo: ultimo.time,
        rsi: vr, emaRsi: ve, anterior: anterior || null,
        cruzamento: cruz, estado: estado,
        sobrecompra: o.sobrecompra, sobrevenda: o.sobrevenda,
        niveis: niveis, rsiDoPreco: doPreco,
        ganho: r.ganho, perda: r.perda,
        serie: serie
      };
    } catch (erro) {
      return { ok: false, motivo: 'erro na conta', detalhe: String(erro && erro.message || erro), opcoes: opcoes(op) };
    }
  }

  function montarNivel(rotulo, alvo, close, r, len, rsiAtual) {
    var res = precoParaRsi({
      close: close, ganho: r.ganho, perda: r.perda, len: len || 14,
      alvoRsi: alvo, rsiAtual: rsiAtual
    });
    if (!res.viavel) {
      return { rotulo: rotulo, rsi: alvo, preco: null, viavel: false, motivo: res.motivo, lado: res.lado };
    }
    return {
      rotulo: rotulo, rsi: alvo, preco: res.preco, viavel: true, lado: res.lado,
      distanciaPct: res.distanciaPct, extremo: res.extremo
    };
  }

  function arredondar(v, casas) {
    var n = numero(v, null);
    if (n === null) return '--';
    return Number(n.toFixed(casas == null ? 2 : casas)).toString();
  }

  var API = {
    PADRAO: PADRAO,
    opcoes: opcoes,
    limparVelas: limparVelas,
    rsi: rsi,
    ema: ema,
    precoParaRsi: precoParaRsi,
    rsiParaPreco: rsiParaPreco,
    calcular: calcular,
    versao: '1.0.0'
  };

  if (typeof raiz !== 'undefined' && raiz) { try { raiz.RSIMatrix = API; } catch (e) {} }
  return API;
})(typeof window !== 'undefined' ? window : globalThis);

// módulo ES (é assim que as telas do Atlas carregam os núcleos) + atalho global
const API = (typeof window !== 'undefined' && window.RSIMatrix) ? window.RSIMatrix : globalThis.RSIMatrix;
export const PADRAO = API.PADRAO;
export const opcoes = API.opcoes;
export const limparVelas = API.limparVelas;
export const rsi = API.rsi;
export const ema = API.ema;
export const precoParaRsi = API.precoParaRsi;
export const rsiParaPreco = API.rsiParaPreco;
export const calcular = API.calcular;
export const versao = API.versao;
export default API;
