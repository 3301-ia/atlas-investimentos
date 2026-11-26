#!/usr/bin/env python3
"""Testes da implementação VECTRA da escada de travas.

Roda sem Freqtrade e sem TA-Lib instalados: os módulos do Freqtrade são
substituídos por stubs mínimos, e o motor de backtest é testado de verdade
sobre a série real.

    python3 test_vectra_escada.py [caminho_da_serie.json]

O teste de backtest procura a série em, nesta ordem: argumento, variável de
ambiente VECTRA_SERIE, ../dados/m15.json, ./m15.json. Sem série, esse bloco é
pulado (o resto roda normalmente).
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import types
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

AQUI = Path(__file__).resolve().parent

# A estratégia mora em user_data/strategies; este teste, em ferramentas/.
for _candidato in (AQUI, AQUI.parent / "user_data" / "strategies", AQUI / ".." / "user_data" / "strategies"):
    _candidato = _candidato.resolve()
    if (_candidato / "vectra_escada.py").exists() and str(_candidato) not in sys.path:
        sys.path.insert(0, str(_candidato))

# ─── Stubs do Freqtrade ──────────────────────────────────────────────
def _instalar_stubs() -> None:
    if "freqtrade.strategy" in sys.modules:
        return

    class _Parametro:
        def __init__(self, *args, default=None, **kwargs):
            self._valor = default
            self.default = default

        @property
        def value(self):
            return self._valor

    class IStrategy:  # noqa: N801 - nome exigido pelo Freqtrade
        def __init__(self, config=None):
            self.config = config or {}
            self.dp = None

    modulo_strategy = types.ModuleType("freqtrade.strategy")
    modulo_strategy.IStrategy = IStrategy
    modulo_strategy.DecimalParameter = _Parametro
    modulo_strategy.IntParameter = _Parametro

    modulo_freqtrade = types.ModuleType("freqtrade")
    modulo_freqtrade.strategy = modulo_strategy

    modulo_persistence = types.ModuleType("freqtrade.persistence")

    class Trade:  # pragma: no cover - só para o import
        pass

    modulo_persistence.Trade = Trade
    modulo_freqtrade.persistence = modulo_persistence

    sys.modules.setdefault("freqtrade", modulo_freqtrade)
    sys.modules.setdefault("freqtrade.strategy", modulo_strategy)
    sys.modules.setdefault("freqtrade.persistence", modulo_persistence)


_instalar_stubs()

import vectra_backtest as bt  # noqa: E402
from vectra_escada import VectraEscada  # noqa: E402

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


# ─── Apoio ───────────────────────────────────────────────────────────
class DPFake:
    """Data provider mínimo: uma série de velas com ATR estável."""

    def __init__(self, preco: float = 100.0, atr: float = 2.0, n: int = 60):
        base = preco - atr * n / 2
        self.df = pd.DataFrame({
            "open": np.linspace(base, preco, n),
            "close": np.linspace(base, preco, n),
            "high": np.linspace(base, preco, n) + atr / 2,
            "low": np.linspace(base, preco, n) - atr / 2,
            "volume": np.ones(n),
        })

    def get_pair_dataframe(self, pair=None, timeframe=None):
        return self.df


class TradeFake:
    def __init__(self, aberto=100.0, quantidade=0.01, curto=False, id_=1):
        self.id = id_
        self.pair = "BTC/USDT"
        self.open_rate = aberto
        self.amount = quantidade
        self.stake_amount = aberto * quantidade
        self.is_short = curto


def nova_estrategia(tmp: Path) -> VectraEscada:
    estrategia = VectraEscada({"user_data_dir": str(tmp)})
    estrategia.dp = DPFake()
    return estrategia


# ─── Testes ──────────────────────────────────────────────────────────
def testar_configuracao(tmp: Path) -> None:
    print("\n[1] Configuração obrigatória do Freqtrade")
    estrategia = nova_estrategia(tmp)
    teste("minimal_roi existe", getattr(estrategia, "minimal_roi", None) is not None)
    # A escada saiu do Freqtrade de propósito: reduzir a posição não é trava.
    teste("estratégia não mexe na posição (escada fora do Freqtrade)",
          not hasattr(estrategia, "adjust_trade_position"))
    teste("use_custom_stoploss ligado", estrategia.use_custom_stoploss is True)
    teste("timeframe 15m", estrategia.timeframe == "15m")
    teste("startup_candle_count definido", estrategia.startup_candle_count >= 20)
    teste("NIVEIS em terços de R", [round(n, 3) for n in estrategia.NIVEIS] == [0.333, 0.667, 1.0, 1.333, 1.667])


def testar_stop_fixo(tmp: Path) -> None:
    print("\n[2] Stop de 1,0 ATR é um preço fixo (não anda com o preço)")
    estrategia = nova_estrategia(tmp)
    trade = TradeFake(aberto=100.0)
    info = estrategia._iniciar_info(trade)
    teste("ATR lido do data provider", info["atr"] > 0, f"atr={info['atr']}")
    teste("stop abaixo da entrada na compra", info["stop_preco"] < 100.0)
    teste("alvo a 2R", abs((info["alvo_preco"] - 100.0) / (100.0 - info["stop_preco"]) - 2.0) < 1e-6)

    # Com o preço em 110, o stop calculado continua no mesmo preço absoluto.
    razao = estrategia.custom_stoploss("BTC/USDT", trade, datetime.now(timezone.utc), 110.0, 0.10)
    stop_recalculado = 110.0 * (1 + razao)
    teste("stop absoluto preservado a 110", abs(stop_recalculado - info["stop_preco"]) < 1e-6,
          f"{stop_recalculado:.4f} vs {info['stop_preco']:.4f}")

    # Preço já abaixo do stop: devolve o piso, não um valor positivo.
    razao2 = estrategia.custom_stoploss("BTC/USDT", trade, datetime.now(timezone.utc), 50.0, -0.5)
    teste("stop nunca vira positivo", razao2 < 0, f"razao={razao2}")


def testar_principal(tmp: Path) -> None:
    print("\n[3] A estratégia opera só a principal (a escada vive no executor)")
    estrategia = nova_estrategia(tmp)
    trade = TradeFake(aberto=100.0)
    info = estrategia._iniciar_info(trade)
    risco = info["risco_preco"]
    agora = datetime.now(timezone.utc)

    teste("info não guarda travas", info.get("travas") == [])
    teste("sem adjust_trade_position", not hasattr(estrategia, "adjust_trade_position"))

    # O alvo de 2R é o que fecha a posição principal.
    preco_alvo = 100.0 + 2.0 * risco
    saida = estrategia.custom_exit("BTC/USDT", trade, agora, preco_alvo, 0.2)
    teste("saída no alvo de 2R", saida == "alvo_2r", str(saida))

    # Antes do alvo, não sai.
    teste("não sai antes do alvo",
          estrategia.custom_exit("BTC/USDT", trade, agora, 100.0 + 1.5 * risco, 0.1) is None)


def testar_auditoria_e_disjuntores(tmp: Path) -> None:
    print("\n[4] Auditoria registra perda e disjuntores reagem")
    estrategia = nova_estrategia(tmp)
    agora = datetime.now(timezone.utc)

    # 25 ciclos perdidos registrados pelo caminho de saída.
    for i in range(25):
        trade = TradeFake(aberto=100.0, id_=100 + i)
        info = estrategia._iniciar_info(trade)
        estrategia.confirm_trade_exit(
            "BTC/USDT", trade, "market", trade.amount, info["stop_preco"],
            "gtc", "stop_loss", agora,
        )

    stats = estrategia._get_stats()
    teste("25 ciclos registrados", stats["ciclos"] == 25, f"{stats['ciclos']}")
    teste("acerto 0% (perdas contabilizadas)", estrategia._acerto(stats) == 0.0)
    teste("sequência de perdas contada", stats["seq_perdas"] == 25)
    teste("queda acumulada positiva", stats["queda"] > 0)

    motivo = estrategia._motivo_bloqueio(stats, agora)
    teste("disjuntor bloqueia com acerto 0%", motivo is not None, f"{motivo}")

    # Estado persistido em disco.
    teste("estado gravado em disco", (tmp / "vectra_estado.json").exists())
    outra = VectraEscada({"user_data_dir": str(tmp)})
    outra.dp = DPFake()
    teste("estado relido no reinício", outra._get_stats()["ciclos"] == 25)

    # Log de auditoria com os campos da seção 24.
    log = tmp / "logs" / "vectra_auditoria.jsonl"
    teste("log JSONL criado", log.exists())
    if log.exists():
        registro = json.loads(log.read_text(encoding="utf-8").splitlines()[0])
        campos = {"ciclo_id", "lado", "preco_entrada", "atr_entrada", "risco_usd",
                  "saida_principal", "motivo_saida", "resultado_principal",
                  "resultado_travas", "resultado_total", "resultado_r", "travas"}
        teste("registro tem os campos da seção 24", campos.issubset(registro.keys()),
              f"faltando: {campos - set(registro.keys())}")
        teste("motivo da saída registrado", registro["motivo_saida"] == "stop_loss")

    # Faixa de alerta: acerto entre 28% e 33% reduz o lote, não desliga.
    alerta = VectraEscada({"user_data_dir": str(tmp / "alerta")})
    alerta._stats = alerta._stats_vazias()
    alerta._stats.update({"ciclos": 100, "acertos": 30, "queda": 5.0, "seq_perdas": 2})
    teste("faixa de alerta não bloqueia", alerta._motivo_bloqueio(alerta._stats, agora) is None)
    teste("faixa de alerta reduz o lote", alerta.custom_stake_amount(
        "BTC/USDT", agora, 100.0, 20.0, 1.0, 100.0, 1.0, None, "long") == 10.0)

    # Queda acima de 46,35 desliga.
    critico = VectraEscada({"user_data_dir": str(tmp / "critico")})
    critico._stats = critico._stats_vazias()
    critico._stats.update({"ciclos": 100, "acertos": 60, "queda": 50.0, "seq_perdas": 1})
    teste("queda crítica bloqueia", critico._motivo_bloqueio(critico._stats, agora) is not None)


def testar_backtest(serie: Path) -> None:
    print("\n[5] Backtest fiel ao relatório")
    if not serie.exists():
        print(f"  (pulado: série não encontrada em {serie})")
        return
    resultado = bt.rodar(bt.carregar(serie))
    teste("sem erro de validação", "erro" not in resultado, resultado.get("erro", ""))
    if "erro" in resultado:
        return
    itens = bt.conferir(resultado)
    for item in itens:
        if "diferenca" in item:
            teste(f"{item['nome']} confere", item["ok"],
                  f"obtido {item['obtido']:.4f}, esperado {item['esperado']:.4f}")
        else:
            teste(f"{item['nome']} confere", item["ok"],
                  f"obtido {item['obtido']}, esperado {item['esperado']}")

    # A trava do erro histórico: série em OHLC tem de ser recusada.
    velas = bt.carregar(serie)
    trocadas = [{"t": v["t"], "o": v["o"], "h": v["c"], "l": v["h"], "c": v["l"], "v": v["v"]} for v in velas]
    teste("série em OHLC é recusada", "erro" in bt.rodar(trocadas))


def achar_serie(argumento: str | None) -> Path:
    candidatos = []
    if argumento:
        candidatos.append(Path(argumento))
    if os.environ.get("VECTRA_SERIE"):
        candidatos.append(Path(os.environ["VECTRA_SERIE"]))
    candidatos += [AQUI / "m15.json", AQUI.parent / "dados" / "m15.json", AQUI / "dados" / "m15.json"]
    for caminho in candidatos:
        if caminho.exists():
            return caminho
    return Path("m15.json")


def main() -> int:
    print("VECTRA · testes da escada de travas")
    serie = achar_serie(sys.argv[1] if len(sys.argv) > 1 else None)

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        testar_configuracao(tmp)
        testar_stop_fixo(tmp)
        testar_principal(tmp / "principal")
        testar_auditoria_e_disjuntores(tmp / "auditoria")

    testar_backtest(serie)

    print(f"\n{OK} ok, {FALHAS} falha(s)")
    return 0 if FALHAS == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
