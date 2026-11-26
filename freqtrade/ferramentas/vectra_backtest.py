#!/usr/bin/env python3
"""VECTRA · Backtest reprodutível da escada de travas.

Implementação fiel ao Anexo B do relatório técnico de 20/11/2026, em Python
puro (só numpy), sem biblioteca de backtest. É a referência para conferir se
qualquer outra implementação (JS do painel, estratégia Freqtrade) continua
fiel ao estudo.

Uso:
    python3 vectra_backtest.py m15.json
    python3 vectra_backtest.py m15.json --lote 0.01 --json saida.json

Formato da série (o mesmo da ponte de velas):
    [[tempo, abertura, fechamento, máxima, mínima, volume], ...]
ou CSV com cabeçalho time,open,close,high,low,volume.

Referência do relatório (21.000 velas BTCUSDT 15m, 0,01 lote):
    599 ciclos · US$ 684,52 · 44,2% acerto · queda US$ 15,45 · 75,3% travas
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

REFERENCIA = {
    "ciclos": 599,
    "resultado": 684.52,
    "principal": 169.16,
    "travas": 515.34,
    "acerto": 0.442,
    "queda": 15.45,
    "pior_sequencia": 11,
    "reserva": 68.45,
    "tolerancia": 0.02,
    "niveis": [
        {"nivel": 1 / 3, "aberturas": 388, "acerto": 0.75},
        {"nivel": 2 / 3, "aberturas": 318, "acerto": 0.93},
        {"nivel": 1.0, "aberturas": 241, "acerto": 0.93},
        {"nivel": 4 / 3, "aberturas": 169, "acerto": 0.98},
        {"nivel": 5 / 3, "aberturas": 103, "acerto": 1.0},
    ],
}

PADRAO = {
    "lote": 0.01,
    "ema_rapida": 8,
    "ema_lenta": 16,
    "rsi_periodo": 14,
    "rsi_compra": 55.0,
    "rsi_venda": 45.0,
    "atr_periodo": 14,
    "stop_atr": 1.0,
    "alvo_r": 2.0,
    "niveis": [1 / 3, 2 / 3, 1.0, 4 / 3, 5 / 3],
    "fator": 0.60,
    "alvo_trava": 0.5,
    "corte_trava": 0.5,
    "reserva_pct": 0.10,
}


# ─── Série ───────────────────────────────────────────────────────────
def carregar(caminho: str | Path) -> List[dict]:
    caminho = Path(caminho)
    if caminho.suffix.lower() == ".csv":
        velas = []
        with caminho.open(newline="", encoding="utf-8") as arquivo:
            for linha in csv.DictReader(arquivo):
                velas.append({
                    "t": int(float(linha.get("time") or linha.get("t") or 0)),
                    "o": float(linha["open"]),
                    "c": float(linha["close"]),
                    "h": float(linha["high"]),
                    "l": float(linha["low"]),
                    "v": float(linha.get("volume") or 0),
                })
        return velas

    bruto = json.loads(caminho.read_text(encoding="utf-8"))
    if isinstance(bruto, dict) and "velas" in bruto:
        bruto = bruto["velas"]
    velas = []
    for item in bruto:
        if isinstance(item, (list, tuple)):
            # Ordem da ponte: tempo, abertura, FECHAMENTO, máxima, mínima, volume.
            velas.append({"t": item[0], "o": float(item[1]), "c": float(item[2]),
                          "h": float(item[3]), "l": float(item[4]),
                          "v": float(item[5]) if len(item) > 5 else 0.0})
        else:
            velas.append({
                "t": item.get("t", item.get("time")),
                "o": float(item.get("o", item.get("open"))),
                "c": float(item.get("c", item.get("close"))),
                "h": float(item.get("h", item.get("high"))),
                "l": float(item.get("l", item.get("low"))),
                "v": float(item.get("v", item.get("volume", 0)) or 0),
            })
    return velas


def validar(velas: Sequence[dict]) -> Optional[str]:
    """Passo 2 do Anexo B: aborta se uma única vela for inconsistente."""
    for i, v in enumerate(velas):
        if v["h"] < v["o"] or v["h"] < v["c"]:
            return f"vela {i}: máxima menor que abertura ou fechamento (série em OHLC?)"
        if v["l"] > v["o"] or v["l"] > v["c"]:
            return f"vela {i}: mínima maior que abertura ou fechamento (série em OHLC?)"
    return None


# ─── Indicadores (idênticos aos do backtest JS) ──────────────────────
def ema(valores: np.ndarray, periodo: int) -> np.ndarray:
    k = 2.0 / (periodo + 1)
    saida = np.empty(len(valores), dtype=float)
    atual = float(valores[0])
    for i, valor in enumerate(valores):
        atual = float(valor) if i == 0 else float(valor) * k + atual * (1 - k)
        saida[i] = atual
    return saida


def rsi(valores: np.ndarray, periodo: int = 14) -> np.ndarray:
    saida = np.full(len(valores), 50.0)
    ganho = perda = 0.0
    for i in range(1, len(valores)):
        delta = float(valores[i]) - float(valores[i - 1])
        alta = max(delta, 0.0)
        baixa = max(-delta, 0.0)
        if i == 1:
            ganho, perda = alta, baixa
        else:
            ganho = (ganho * (periodo - 1) + alta) / periodo
            perda = (perda * (periodo - 1) + baixa) / periodo
        saida[i] = 100.0 if perda == 0 else 100.0 - 100.0 / (1.0 + ganho / perda)
    return saida


def atr(velas: Sequence[dict], periodo: int = 14) -> np.ndarray:
    n = len(velas)
    tr = np.zeros(n)
    saida = np.full(n, np.nan)
    for i in range(1, n):
        tr[i] = max(
            velas[i]["h"] - velas[i]["l"],
            abs(velas[i]["h"] - velas[i - 1]["c"]),
            abs(velas[i]["l"] - velas[i - 1]["c"]),
        )
    atual = None
    for j in range(periodo, n):
        if atual is None:
            atual = float(tr[j - periodo + 1:j + 1].sum() / periodo)
        else:
            atual = (atual * (periodo - 1) + tr[j]) / periodo
        saida[j] = atual
    return saida


# ─── Motor ───────────────────────────────────────────────────────────
def rodar(velas: Sequence[dict], **cfg) -> dict:
    C = dict(PADRAO)
    C.update({k: v for k, v in cfg.items() if v is not None})

    erro = validar(velas)
    if erro:
        return {"erro": erro}

    n = len(velas)
    fechamentos = np.array([v["c"] for v in velas], dtype=float)
    e_rapida = ema(fechamentos, C["ema_rapida"])
    e_lenta = ema(fechamentos, C["ema_lenta"])
    rsi14 = rsi(fechamentos, C["rsi_periodo"])
    atr14 = atr(velas, C["atr_periodo"])

    ciclos: List[dict] = []
    equity = topo = queda_max = 0.0
    seq_perdas = max_seq = 0
    reserva_periodo = reserva_giro = 0.0

    pos: Optional[dict] = None

    def fechar(preco: float, motivo: str, indice: int) -> None:
        nonlocal pos, equity, topo, queda_max, seq_perdas, max_seq, reserva_periodo, reserva_giro
        p = pos
        for trava in p["travas"]:
            if trava["estado"] == "aberta":
                trava["resultado"] = (trava["preco"] - preco) * (-p["lado"]) * trava["tamanho"]
                trava["estado"] = "encerrada"
                p["pnl_travas"] += trava["resultado"]

        principal = (preco - p["entrada"]) * p["lado"] * p["tamanho"]
        total = principal + p["pnl_travas"]
        risco_usd = p["risco"] * p["tamanho"]
        ciclos.append({
            "ciclo_id": len(ciclos) + 1,
            "i": p["i"],
            "saida_i": indice,
            "lado": p["lado"],
            "preco_entrada": p["entrada"],
            "saida_principal": preco,
            "motivo_saida": motivo,
            "atr_entrada": p["atr"],
            "risco_usd": risco_usd,
            "resultado_principal": principal,
            "resultado_travas": p["pnl_travas"],
            "resultado_total": total,
            "resultado_r": total / risco_usd if risco_usd else 0.0,
            "travas": [dict(t) for t in p["travas"]],
        })
        equity += total
        if total > 0:
            reserva_giro += total * C["reserva_pct"]
            seq_perdas = 0
        else:
            seq_perdas += 1
            max_seq = max(max_seq, seq_perdas)
        topo = max(topo, equity)
        queda_max = max(queda_max, topo - equity)
        pos = None

    i = 1
    while i < n:
        if np.isnan(atr14[i]):
            i += 1
            continue
        v = velas[i]

        if pos is None:
            sinal = 0
            if e_rapida[i - 1] <= e_lenta[i - 1] and e_rapida[i] > e_lenta[i] and rsi14[i] > C["rsi_compra"]:
                sinal = 1
            elif e_rapida[i - 1] >= e_lenta[i - 1] and e_rapida[i] < e_lenta[i] and rsi14[i] < C["rsi_venda"]:
                sinal = -1
            if sinal:
                risco = C["stop_atr"] * float(atr14[i])
                entrada = v["c"]
                pos = {
                    "lado": sinal, "i": i, "entrada": entrada, "atr": float(atr14[i]),
                    "risco": risco, "tamanho": C["lote"],
                    "stop": entrada - sinal * risco,
                    "alvo": entrada + sinal * C["alvo_r"] * risco,
                    "travas": [], "usados": set(), "pnl_travas": 0.0,
                }
            i += 1
            continue

        lado = pos["lado"]
        # Passo 6: stop antes de alvo (ordem conservadora).
        if lado == 1 and v["l"] <= pos["stop"]:
            fechar(min(pos["stop"], v["o"]), "stop", i)
            i += 1
            continue
        if lado == -1 and v["h"] >= pos["stop"]:
            fechar(max(pos["stop"], v["o"]), "stop", i)
            i += 1
            continue
        if lado == 1 and v["h"] >= pos["alvo"]:
            fechar(pos["alvo"], "alvo", i)
            i += 1
            continue
        if lado == -1 and v["l"] <= pos["alvo"]:
            fechar(pos["alvo"], "alvo", i)
            i += 1
            continue

        # Abertura de travas.
        for k, nivel_r in enumerate(C["niveis"]):
            if k in pos["usados"]:
                continue
            nivel = pos["entrada"] + lado * nivel_r * pos["risco"]
            tocou = v["h"] >= nivel if lado == 1 else v["l"] <= nivel
            if tocou:
                pos["travas"].append({
                    "nivel": nivel_r, "preco": nivel, "lado": -lado,
                    "tamanho": C["fator"] * C["lote"],
                    "alvo": nivel - lado * C["alvo_trava"] * pos["risco"],
                    "corte": nivel + lado * C["corte_trava"] * pos["risco"],
                    "aberta_i": i, "estado": "aberta", "resultado": 0.0,
                })
                pos["usados"].add(k)

        # Fechamento de travas.
        for trava in pos["travas"]:
            if trava["estado"] != "aberta":
                continue
            if lado == 1:
                if v["l"] <= trava["alvo"]:
                    trava["resultado"] = (trava["preco"] - trava["alvo"]) * trava["tamanho"]
                    trava["estado"] = "alvo"
                    pos["pnl_travas"] += trava["resultado"]
                elif v["h"] >= trava["corte"]:
                    trava["resultado"] = (trava["preco"] - trava["corte"]) * trava["tamanho"]
                    trava["estado"] = "corte"
                    pos["pnl_travas"] += trava["resultado"]
            else:
                if v["h"] >= trava["alvo"]:
                    trava["resultado"] = (trava["alvo"] - trava["preco"]) * trava["tamanho"]
                    trava["estado"] = "alvo"
                    pos["pnl_travas"] += trava["resultado"]
                elif v["l"] <= trava["corte"]:
                    trava["resultado"] = (trava["corte"] - trava["preco"]) * trava["tamanho"]
                    trava["estado"] = "corte"
                    pos["pnl_travas"] += trava["resultado"]

        i += 1

    if pos is not None:
        fechar(velas[-1]["c"], "fim_serie", n - 1)

    # ─── Estatísticas ────────────────────────────────────────────────
    total_principal = sum(c["resultado_principal"] for c in ciclos)
    total_travas = sum(c["resultado_travas"] for c in ciclos)
    acertos = sum(1 for c in ciclos if c["resultado_total"] > 0)
    partes = total_principal + total_travas

    nivel_stats = []
    for nivel_r in C["niveis"]:
        aberturas = acertos_nivel = cortes = encerradas = 0
        pnl = 0.0
        ciclos_com = 0
        for c in ciclos:
            teve = False
            for t in c["travas"]:
                if abs(t["nivel"] - nivel_r) > 0.01:
                    continue
                teve = True
                pnl += t["resultado"]
                if t["estado"] == "alvo":
                    aberturas += 1
                    acertos_nivel += 1
                elif t["estado"] == "corte":
                    aberturas += 1
                    cortes += 1
                else:
                    encerradas += 1
            if teve:
                ciclos_com += 1
        nivel_stats.append({
            "nivel": nivel_r,
            "aberturas": aberturas,
            "acertos": acertos_nivel,
            "cortes": cortes,
            "encerradas": encerradas,
            "acerto": acertos_nivel / aberturas if aberturas else 0.0,
            "pnl": pnl,
            "ciclos_com": ciclos_com,
            "pct_ciclos": ciclos_com / len(ciclos) if ciclos else 0.0,
        })

    metade = len(ciclos) // 2

    def sumarizar(lista: List[dict]) -> dict:
        lucro = sum(c["resultado_total"] for c in lista)
        ganhos = sum(1 for c in lista if c["resultado_total"] > 0)
        return {"ciclos": len(lista), "lucro": lucro,
                "acerto": ganhos / len(lista) if lista else 0.0}

    duracoes = sorted(c["saida_i"] - c["i"] for c in ciclos)

    return {
        "config": {k: (list(v) if isinstance(v, (list, tuple)) else v) for k, v in C.items()},
        "velas": n,
        "ciclos": len(ciclos),
        "resultado": equity,
        "media_ciclo": equity / len(ciclos) if ciclos else 0.0,
        "acerto": acertos / len(ciclos) if ciclos else 0.0,
        "queda_maxima": queda_max,
        "pior_sequencia": max_seq,
        "lucro_queda": equity / queda_max if queda_max > 0 else float("inf"),
        "principal": total_principal,
        "travas": total_travas,
        "pct_principal": total_principal / partes if partes else 0.0,
        "pct_travas": total_travas / partes if partes else 0.0,
        "reserva": equity * C["reserva_pct"],
        "reserva_giro_positivo": reserva_giro,
        "pior_ciclo": min((c["resultado_total"] for c in ciclos), default=0.0),
        "melhor_ciclo": max((c["resultado_total"] for c in ciclos), default=0.0),
        "duracao_media": (sum(duracoes) / len(duracoes)) if duracoes else 0.0,
        "duracao_mediana": duracoes[len(duracoes) // 2] if duracoes else 0,
        "primeira_metade": sumarizar(ciclos[:metade]),
        "segunda_metade": sumarizar(ciclos[metade:]),
        "nivel_stats": nivel_stats,
        "ciclos_lista": ciclos,
    }


# ─── Conferência e impressão ─────────────────────────────────────────
def conferir(resultado: dict) -> List[dict]:
    if not resultado or "erro" in resultado:
        return [{"nome": "execução", "ok": False, "obtido": resultado.get("erro") if resultado else "sem resultado"}]

    itens = []

    def item(nome, obtido, esperado, tolerancia):
        diferenca = abs(obtido - esperado) / abs(esperado) if esperado else abs(obtido)
        itens.append({"nome": nome, "obtido": obtido, "esperado": esperado,
                      "diferenca": diferenca, "ok": diferenca <= tolerancia})

    item("resultado", resultado["resultado"], REFERENCIA["resultado"], 0.02)
    item("principal", resultado["principal"], REFERENCIA["principal"], 0.02)
    item("travas", resultado["travas"], REFERENCIA["travas"], 0.02)
    item("acerto", resultado["acerto"], REFERENCIA["acerto"], 0.03)
    item("queda máxima", resultado["queda_maxima"], REFERENCIA["queda"], 0.05)
    itens.append({"nome": "ciclos", "obtido": resultado["ciclos"], "esperado": REFERENCIA["ciclos"],
                  "ok": resultado["ciclos"] == REFERENCIA["ciclos"]})
    itens.append({"nome": "pior sequência", "obtido": resultado["pior_sequencia"],
                  "esperado": REFERENCIA["pior_sequencia"],
                  "ok": resultado["pior_sequencia"] == REFERENCIA["pior_sequencia"]})

    for ref, stats in zip(REFERENCIA["niveis"], resultado["nivel_stats"]):
        itens.append({
            "nome": f"aberturas nível {ref['nivel']:.3f}R",
            "obtido": stats["aberturas"], "esperado": ref["aberturas"],
            "ok": stats["aberturas"] == ref["aberturas"],
        })
    return itens


def imprimir(resultado: dict, arquivo=sys.stdout) -> None:
    if not resultado or "erro" in resultado:
        print(f"[VECTRA BACKTEST] {resultado.get('erro') if resultado else 'sem resultado'}", file=arquivo)
        return

    def linha(rotulo, valor):
        print(f" {rotulo:<16}{valor}", file=arquivo)

    print("\n═══════════════════════════════════════════════════", file=arquivo)
    print(" VECTRA · Backtest da Escada de Travas", file=arquivo)
    print("═══════════════════════════════════════════════════", file=arquivo)
    linha("Velas:", resultado["velas"])
    linha("Ciclos:", resultado["ciclos"])
    linha("Resultado:", f"US$ {resultado['resultado']:.2f}")
    linha("Média/ciclo:", f"US$ {resultado['media_ciclo']:.2f}")
    linha("Acerto:", f"{resultado['acerto'] * 100:.1f}%")
    linha("Queda máxima:", f"US$ {resultado['queda_maxima']:.2f}")
    linha("Pior sequência:", resultado["pior_sequencia"])
    linha("Lucro/Queda:", f"{resultado['lucro_queda']:.1f}")
    print("─────────────────────────────────────────────────", file=arquivo)
    linha("Principal:", f"US$ {resultado['principal']:.2f} ({resultado['pct_principal'] * 100:.1f}%)")
    linha("Travas:", f"US$ {resultado['travas']:.2f} ({resultado['pct_travas'] * 100:.1f}%)")
    linha("Reserva (10%):", f"US$ {resultado['reserva']:.2f}")
    print("─────────────────────────────────────────────────", file=arquivo)
    print(" Por nível:", file=arquivo)
    for stats in resultado["nivel_stats"]:
        print(
            f"   {stats['nivel']:.3f}R: {stats['aberturas']} aberturas, "
            f"{stats['acerto'] * 100:.0f}% acerto, {stats['pct_ciclos'] * 100:.1f}% dos ciclos, "
            f"US$ {stats['pnl']:.2f}",
            file=arquivo,
        )
    print("─────────────────────────────────────────────────", file=arquivo)
    print(f" 1ª metade: {resultado['primeira_metade']['ciclos']} ciclos, "
          f"US$ {resultado['primeira_metade']['lucro']:.2f}, "
          f"{resultado['primeira_metade']['acerto'] * 100:.1f}% acerto", file=arquivo)
    print(f" 2ª metade: {resultado['segunda_metade']['ciclos']} ciclos, "
          f"US$ {resultado['segunda_metade']['lucro']:.2f}, "
          f"{resultado['segunda_metade']['acerto'] * 100:.1f}% acerto", file=arquivo)
    print("═══════════════════════════════════════════════════", file=arquivo)

    itens = conferir(resultado)
    falhas = [i for i in itens if not i["ok"]]
    if not falhas:
        print(" ✓ REPRODUÇÃO OK: todos os números do relatório conferem.", file=arquivo)
    else:
        print(" ⚠ DIVERGÊNCIA do relatório:", file=arquivo)
        for item_falho in falhas:
            print(f"   · {item_falho['nome']}: obtido {item_falho['obtido']}, "
                  f"esperado {item_falho['esperado']}", file=arquivo)
    print("", file=arquivo)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Backtest da escada de travas (VECTRA)")
    parser.add_argument("serie", help="JSON ou CSV com as velas")
    parser.add_argument("--lote", type=float, default=PADRAO["lote"])
    parser.add_argument("--fator", type=float, default=PADRAO["fator"])
    parser.add_argument("--json", dest="saida", help="grava o resultado completo em JSON")
    args = parser.parse_args(argv)

    velas = carregar(args.serie)
    resultado = rodar(velas, lote=args.lote, fator=args.fator)
    imprimir(resultado)

    if args.saida and "erro" not in resultado:
        Path(args.saida).write_text(
            json.dumps(resultado, ensure_ascii=False, default=float), encoding="utf-8"
        )

    return 0 if "erro" not in resultado and all(i["ok"] for i in conferir(resultado)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
