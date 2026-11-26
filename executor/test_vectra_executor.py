#!/usr/bin/env python3
"""Testes do executor da escada de travas.

O ponto central: cada trava tem de ser uma POSIÇÃO SEPARADA e CONTRÁRIA à
principal, nunca uma redução parcial dela.

    python3 test_vectra_executor.py [serie.json]

Sem a série, o teste de replay é pulado e o resto roda.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
for _candidato in (AQUI, AQUI.parent / "freqtrade" / "ferramentas",
                   AQUI / ".." / "freqtrade" / "ferramentas"):
    _candidato = _candidato.resolve()
    if (_candidato / "vectra_backtest.py").exists() and str(_candidato) not in sys.path:
        sys.path.insert(0, str(_candidato))

import vectra_backtest as bt  # noqa: E402
import vectra_executor as ex  # noqa: E402

OK = 0
FALHAS = 0


def teste(nome: str, condicao, extra: str = "") -> None:
    global OK, FALHAS
    if condicao:
        OK += 1
        print(f"  ok   {nome}")
    else:
        FALHAS += 1
        print(f"  FALHA {nome}" + (f" :: {extra}" if extra else ""))


def achar_serie(argumento: str | None) -> Path:
    candidatos = []
    if argumento:
        candidatos.append(Path(argumento))
    if os.environ.get("VECTRA_SERIE"):
        candidatos.append(Path(os.environ["VECTRA_SERIE"]))
    candidatos += [
        AQUI.parent / "atlas-ui" / "core" / "dados" / "m15_btcusdt_15m.json",
        AQUI / ".." / "atlas-ui" / "core" / "dados" / "m15_btcusdt_15m.json",
        AQUI / "m15.json",
    ]
    for caminho in candidatos:
        if caminho.exists():
            return caminho
    return Path("m15.json")


# ─── 1. A trava é posição separada e contrária ───────────────────────
def testar_posicoes_separadas() -> None:
    print("\n[1] Trava é posição separada e contrária, não redução da principal")
    corretora = ex.CorretoraSimulada(lote=0.01)
    motor = ex.MotorVectra(corretora, lote=0.01, aplicar_disjuntores=False)

    motor.abrir_ciclo(1, 100.0, 2.0)          # compra, risco 2,0
    principal = motor.ciclo.principal
    teste("principal aberta como posição", principal is not None and principal.papel == "principal")
    teste("principal comprada", principal.lado == 1)
    teste("stop a 1 ATR", abs(motor.ciclo.stop - 98.0) < 1e-9, str(motor.ciclo.stop))
    teste("alvo a 2R", abs(motor.ciclo.alvo - 104.0) < 1e-9, str(motor.ciclo.alvo))

    # Preço alcança 1/3R: abre a trava.
    motor.abrir_travas(preco_max=100.0 + 2.0 / 3, preco_min=100.0)
    teste("uma trava aberta", len(motor.ciclo.travas) == 1)
    trava = motor.ciclo.travas[0]
    teste("trava é uma posição própria, com id diferente", trava.id != principal.id,
          f"{trava.id} vs {principal.id}")
    teste("trava é contrária à principal (venda contra compra)", trava.lado == -1, str(trava.lado))
    teste("trava é 0,60 do lote", abs(trava.tamanho - 0.006) < 1e-12, str(trava.tamanho))
    teste("trava aberta no preço do nível", abs(trava.preco_entrada - (100.0 + 2.0 / 3)) < 1e-9,
          str(trava.preco_entrada))
    teste("trava tem alvo e corte próprios",
          abs(trava.alvo - (trava.preco_entrada - 1.0)) < 1e-9 and
          abs(trava.corte - (trava.preco_entrada + 1.0)) < 1e-9,
          f"alvo {trava.alvo} corte {trava.corte}")

    # A principal continua inteira: nada foi reduzido.
    teste("principal segue com o lote inteiro", abs(principal.tamanho - 0.01) < 1e-12, str(principal.tamanho))
    teste("principal continua aberta", principal.estado == "aberta")

    # Trava fecha no alvo, com resultado próprio, sem tocar na principal.
    motor.fechar_travas(preco_max=100.0, preco_min=trava.alvo)
    teste("trava fechada no alvo", trava.motivo_saida == "alvo", str(trava.motivo_saida))
    teste("resultado da trava positivo", trava.resultado > 0, f"{trava.resultado:.6f}")
    teste("resultado da trava = 0,5R do tamanho dela",
          abs(trava.resultado - (0.5 * 2.0 * 0.006)) < 1e-9, f"{trava.resultado:.6f}")
    teste("principal intocada pela trava", principal.estado == "aberta" and abs(principal.tamanho - 0.01) < 1e-12)

    # Ciclo de venda: a trava tem de ser compra.
    corretora2 = ex.CorretoraSimulada(lote=0.01)
    motor2 = ex.MotorVectra(corretora2, lote=0.01, aplicar_disjuntores=False)
    motor2.abrir_ciclo(-1, 100.0, 2.0)
    motor2.abrir_travas(preco_max=100.0, preco_min=100.0 - 2.0 / 3)
    trava2 = motor2.ciclo.travas[0]
    teste("venda: trava é compra", trava2.lado == 1, str(trava2.lado))
    teste("venda: alvo da trava acima", trava2.alvo > trava2.preco_entrada, f"{trava2.alvo}")


# ─── 2. Contabilidade e disjuntores ─────────────────────────────────
def testar_contabilidade() -> None:
    print("\n[2] Contabilidade da trava encerrada com o ciclo")
    corretora = ex.CorretoraSimulada(lote=0.01)
    motor = ex.MotorVectra(corretora, lote=0.01, aplicar_disjuntores=False)
    motor.abrir_ciclo(1, 100.0, 2.0)
    motor.abrir_travas(preco_max=100.0 + 2.0 / 3, preco_min=100.0)
    trava = motor.ciclo.travas[0]

    # Principal fecha no alvo (104): a trava vendeu em ~100,67 e o preço subiu.
    motor.fechar_ciclo(104.0, "alvo")
    teste("trava encerrada junto com o ciclo", trava.motivo_saida == "encerrada_alvo", str(trava.motivo_saida))
    teste("trava contrária PERDE quando o preço sobe a favor da principal",
          trava.resultado < 0, f"{trava.resultado:.6f}")
    esperado = (104.0 - trava.preco_entrada) * (-1) * trava.tamanho
    teste("resultado da trava tem o sinal correto",
          abs(trava.resultado - esperado) < 1e-9, f"{trava.resultado:.6f} vs {esperado:.6f}")
    teste("ciclo registrado na auditoria", len(motor.ciclos) == 1)

    print("\n[3] Disjuntores da seção 25")
    motor3 = ex.MotorVectra(ex.CorretoraSimulada(lote=0.01), lote=0.01)
    motor3.ciclos = [{"resultado_total": -1.0} for _ in range(30)]
    motor3.seq_perdas = 30
    motor3.queda = 10.0
    motivo = motor3.motivo_bloqueio()
    teste("acerto 0% desliga", motivo is not None and "acerto" in motivo, str(motivo))

    motor4 = ex.MotorVectra(ex.CorretoraSimulada(lote=0.01), lote=0.01)
    motor4.ciclos = [{"resultado_total": 1.0} for _ in range(30)] + [{"resultado_total": -1.0} for _ in range(13)]
    motor4.queda = 5.0
    motor4.seq_perdas = 1
    teste("acerto 30% não desliga (reduz lote)", motor4.motivo_bloqueio() is None,
          str(motor4.motivo_bloqueio()))

    motor5 = ex.MotorVectra(ex.CorretoraSimulada(lote=0.01), lote=0.01)
    motor5.ciclos = [{"resultado_total": 1.0} for _ in range(30)]
    motor5.queda = 47.0
    teste("queda acima de 46,35 desliga", motor5.motivo_bloqueio() is not None, str(motor5.motivo_bloqueio()))

    motor6 = ex.MotorVectra(ex.CorretoraSimulada(lote=0.01), lote=0.01, aplicar_disjuntores=False)
    motor6.ciclos = [{"resultado_total": -1.0} for _ in range(30)]
    motor6.queda = 60.0
    teste("replay ignora disjuntores", motor6.motivo_bloqueio() is None)


# ─── 4. Replay contra o relatório ───────────────────────────────────
def testar_replay(serie: Path) -> None:
    print("\n[4] Replay sobre a série do estudo")
    if not serie.exists():
        print(f"  (pulado: série não encontrada em {serie})")
        return

    velas = bt.carregar(serie)
    motor = ex.rodar_replay(velas)
    r = motor.resumo()

    teste("599 ciclos", r["ciclos"] == 599, str(r["ciclos"]))
    teste("aberturas por nível iguais ao relatório",
          r["nivel_aberturas"] == [388, 318, 241, 169, 103], str(r["nivel_aberturas"]))
    # O critério da seção 27 é ordenação crescente. Nos próprios dados do
    # relatório o nível 3 fica 0,5 ponto abaixo do nível 2 (92,5% contra
    # 93,1%), então a tolerância de 1 ponto é o que o estudo sustenta.
    teste("acerto por nível crescente (tolerância de 1 ponto)",
          all(r["nivel_acerto"][k] <= r["nivel_acerto"][k + 1] + 0.01 for k in range(4)),
          str([round(a * 100, 1) for a in r["nivel_acerto"]]))
    teste("queda máxima 15,45", abs(r["queda"] - 15.45) < 0.05, f"{r['queda']:.2f}")
    teste("pior sequência 11", r["pior_sequencia"] == 11, str(r["pior_sequencia"]))
    teste("resultado 665,89 (sinal correto da trava encerrada)",
          abs(r["resultado"] - 665.89) / 665.89 <= 0.02, f"{r['resultado']:.2f}")
    teste("travas respondem por ~75% do lucro",
          abs(r["pct_travas"] - 0.746) < 0.02, f"{r['pct_travas'] * 100:.1f}%")

    # A prova de que as duas implementações concordam quando a conta é a mesma.
    backtest_correto = bt.rodar(velas, corrigir_sinal_encerrada=True)
    teste("executor e backtest corrigido dão o mesmo resultado",
          abs(backtest_correto["resultado"] - r["resultado"]) < 0.01,
          f"{backtest_correto['resultado']:.4f} vs {r['resultado']:.4f}")

    # E a diferença para o relatório é exatamente o erro de sinal.
    backtest_relatorio = bt.rodar(velas)
    teste("diferença para o relatório = 2 × soma das travas encerradas",
          abs((backtest_relatorio["resultado"] - r["resultado"]) - 18.60) < 0.05,
          f"{backtest_relatorio['resultado'] - r['resultado']:.2f}")

    # Nenhuma trava foi redução: toda trava tem id próprio e lado oposto.
    travas = [t for c in motor.ciclos for t in c["travas"]]
    teste("houve travas no replay", len(travas) > 1000, str(len(travas)))
    ids_unicos = len({(c["ciclo_id"], t["nivel"]) for c in motor.ciclos for t in c["travas"]})
    teste("cada trava é uma posição distinta", ids_unicos == len(travas), f"{ids_unicos} vs {len(travas)}")
    teste("toda trava é 0,60 do lote", all(abs(t["tamanho"] - 0.006) < 1e-12 for t in travas))


def main() -> int:
    print("VECTRA · testes do executor da escada")
    serie = achar_serie(sys.argv[1] if len(sys.argv) > 1 else None)
    testar_posicoes_separadas()
    testar_contabilidade()
    testar_replay(serie)
    print(f"\n{OK} ok, {FALHAS} falha(s)")
    return 0 if FALHAS == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
