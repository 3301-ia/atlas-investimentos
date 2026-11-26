# VECTRA · Estratégia Escada de Travas para Freqtrade
#
# Implementação baseada no relatório técnico de 20/11/2026 (seções 22-25).
#
# Parâmetros (Anexo A):
#   - Ativo: BTCUSDT (qualquer par compatível)
#   - Tempo gráfico: 15m
#   - Entrada: cruzamento EMA 8 × EMA 16 com RSI 14 (>55 compra, <45 venda)
#   - Stop: 1,0 ATR(14)
#   - Alvo: 2,0 R
#   - Escada: travas em 1/3, 2/3, 3/3, 4/3 e 5/3 de R, fator 0,60
#   - Trava: alvo +0,5R, corte −0,5R
#   - Reserva: 10% do resultado do período (Regra do Lucas)
#
# Uso:
#   freqtrade trade --strategy VectraEscada --config user_data/config.json
#
# ─── O QUE FOI CORRIGIDO NESTA VERSÃO ───────────────────────────────
# 1. A versão anterior nunca abria trava: adjust_trade_position só roda com
#    position_adjustment_enable = True, que não existia no arquivo.
# 2. Faltava minimal_roi, obrigatório: o Freqtrade recusa carregar a classe
#    sem ele.
# 3. custom_stoploss devolvia uma fração do preço de entrada como se fosse
#    distância até o preço atual: o stop saía do lugar a cada vela. Agora o
#    stop é um preço fixo e a distância é recalculada contra o preço atual.
# 4. Só o alvo era registrado na auditoria; stops não entravam e, por isso,
#    o acerto e a sequência de perdas nunca viam as perdas — os disjuntores
#    ficavam cegos. Agora toda saída registra.
# 5. Os disjuntores não seguiam a seção 25: acerto < 33% é reduzir lote (não
#    desligar) e o limite de 28% (desligar) não existia. Corrigido.
# 6. Estatísticas viviam só na memória: reiniciar o robô zerava os
#    disjuntores. Agora persistem em user_data/vectra_estado.json.
# 7. talib deixou de ser obrigatório: EMA, RSI e ATR são calculados em pandas,
#    iguais aos do backtest de referência.
#
# ─── A ESCADA NÃO MORA AQUI ─────────────────────────────────────────
# O Freqtrade não mantém posição contrária no mesmo par ao mesmo tempo, e um
# mantenedor confirmou que não vai suportar (issue #7386: "No we don't - and
# we're unlikely to support this in the near future"). Reduzir a posição no
# lugar da trava é outra coisa, não é o mecanismo do relatório.
#
# Por isso esta estratégia opera SOMENTE a posição principal: entrada, stop de
# 1,0 ATR, alvo de 2R, registro de auditoria e disjuntores. A escada, com cada
# trava como posição contrária separada, roda em ../executor/vectra_executor.py.
#
# Usar as duas ao mesmo tempo no mesmo par não funciona: elas brigariam pela
# mesma posição. Escolha uma:
#   · escada completa  -> executor (posições contrárias de verdade)
#   · só principal     -> esta estratégia no Freqtrade
#
#   freqtrade trade --strategy VectraEscada --config user_data/config.json

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from freqtrade.strategy import DecimalParameter, IntParameter, IStrategy
from freqtrade.persistence import Trade

logger = logging.getLogger(__name__)


# ─── Indicadores em pandas (sem TA-Lib) ─────────────────────────────
def ema(serie: pd.Series, periodo: int) -> pd.Series:
    return serie.ewm(span=periodo, adjust=False).mean()


def rsi(serie: pd.Series, periodo: int = 14) -> pd.Series:
    delta = serie.diff()
    ganho = delta.clip(lower=0.0)
    perda = (-delta).clip(lower=0.0)
    # Média de Wilder: o mesmo cálculo do backtest de referência.
    media_ganho = ganho.ewm(alpha=1.0 / periodo, adjust=False).mean()
    media_perda = perda.ewm(alpha=1.0 / periodo, adjust=False).mean()
    rs = media_ganho / media_perda.replace(0.0, np.nan)
    saida = 100.0 - (100.0 / (1.0 + rs))
    return saida.fillna(50.0)


def atr(df: pd.DataFrame, periodo: int = 14) -> pd.Series:
    alta, baixa, fech = df["high"], df["low"], df["close"]
    anterior = fech.shift(1)
    tr = pd.concat([alta - baixa, (alta - anterior).abs(), (baixa - anterior).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1.0 / periodo, adjust=False).mean()


class VectraEscada(IStrategy):
    """
    VECTRA · Escada de Travas

    A escada não é proteção: é o motor econômico. No estudo, 75,3% do
    resultado vem das travas.
    """

    # ─── Configuração ────────────────────────────────────────────────
    INTERFACE_VERSION = 3
    timeframe = "15m"
    can_short = True

    # O stop operacional é 1,0 ATR (custom_stoploss). Este valor é apenas o
    # teto técnico do Freqtrade: custom_stoploss não pode afrouxar além do
    # stoploss inicial, então ele precisa ser folgado. Com -0.05 o stop de
    # 1 ATR era cortado em qualquer volatilidade acima de 5% e o mecanismo
    # deixava de ser o do relatório. O relatório usa -0.05 porque na amostra
    # o ATR de 15m ficou bem abaixo disso.
    stoploss = -0.20
    use_custom_stoploss = True
    trailing_stop = False
    # Obrigatório: sem minimal_roi o Freqtrade não carrega a estratégia.
    # Valor alto de propósito: a saída é a escada, não o ROI.
    minimal_roi = {"0": 10.0}

    process_only_new_candles = True
    startup_candle_count = 40

    # ─── Parâmetros otimizáveis ──────────────────────────────────────
    ema_rapida = IntParameter(5, 15, default=8, space="buy")
    ema_lenta = IntParameter(10, 30, default=16, space="buy")
    rsi_periodo = IntParameter(10, 20, default=14, space="buy")
    rsi_compra = IntParameter(50, 65, default=55, space="buy")
    rsi_venda = IntParameter(35, 50, default=45, space="buy")
    atr_periodo = IntParameter(10, 20, default=14, space="buy")

    stop_atr = DecimalParameter(0.5, 2.0, default=1.0, decimals=1, space="sell")
    alvo_r = DecimalParameter(1.5, 3.0, default=2.0, decimals=1, space="sell")
    fator_trava = DecimalParameter(0.3, 1.0, default=0.6, decimals=2, space="sell")
    alvo_trava = DecimalParameter(0.3, 1.0, default=0.5, decimals=1, space="sell")
    corte_trava = DecimalParameter(0.3, 1.0, default=0.5, decimals=1, space="sell")

    # ─── Constantes do relatório ─────────────────────────────────────
    NIVEIS = (1 / 3, 2 / 3, 1.0, 4 / 3, 5 / 3)
    RESERVA_PCT = 0.10

    # Disjuntores (seção 25)
    ACERTO_DESLIGAR = 0.28
    ACERTO_REDUZIR = 0.33
    QUEDA_PAUSAR = 30.0
    QUEDA_DESLIGAR = 46.35
    NIVEL1_REVISAR = 0.60
    SEQ_PERDAS_MAX = 15
    PAUSA_HORAS = 24

    def __init__(self, config: dict) -> None:
        super().__init__(config)
        self._trades: Dict[str, dict] = {}
        self._registrados: set = set()
        self._atr_cache: Dict[str, tuple] = {}
        self._stats: Optional[dict] = None

    # ─── Caminhos de estado ──────────────────────────────────────────
    @property
    def _dir_userdata(self) -> Path:
        base = self.config.get("user_data_dir") if isinstance(self.config, dict) else None
        return Path(base) if base else Path("user_data")

    @property
    def log_path(self) -> Path:
        return self._dir_userdata / "logs" / "vectra_auditoria.jsonl"

    @property
    def estado_path(self) -> Path:
        return self._dir_userdata / "vectra_estado.json"

    # ─── Indicadores ─────────────────────────────────────────────────
    def populate_indicators(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        dataframe["ema_rapida"] = ema(dataframe["close"], self.ema_rapida.value)
        dataframe["ema_lenta"] = ema(dataframe["close"], self.ema_lenta.value)
        dataframe["rsi"] = rsi(dataframe["close"], self.rsi_periodo.value)
        dataframe["atr"] = atr(dataframe, self.atr_periodo.value)
        return dataframe

    # ─── Entradas ────────────────────────────────────────────────────
    def populate_entry_trend(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        dataframe["enter_long"] = 0
        dataframe["enter_short"] = 0

        cruza_alta = (
            (dataframe["ema_rapida"] > dataframe["ema_lenta"])
            & (dataframe["ema_rapida"].shift(1) <= dataframe["ema_lenta"].shift(1))
            & (dataframe["rsi"] > self.rsi_compra.value)
        )
        cruza_baixa = (
            (dataframe["ema_rapida"] < dataframe["ema_lenta"])
            & (dataframe["ema_rapida"].shift(1) >= dataframe["ema_lenta"].shift(1))
            & (dataframe["rsi"] < self.rsi_venda.value)
        )

        dataframe.loc[cruza_alta, "enter_long"] = 1
        dataframe.loc[cruza_baixa, "enter_short"] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: pd.DataFrame, metadata: dict) -> pd.DataFrame:
        # Saídas são gerenciadas em custom_exit / custom_stoploss.
        dataframe["exit_long"] = 0
        dataframe["exit_short"] = 0
        return dataframe

    # ─── Estado por trade ────────────────────────────────────────────
    def _chave(self, trade: Trade) -> str:
        return str(getattr(trade, "id", None) or id(trade))

    def _lado(self, trade: Trade) -> int:
        return -1 if getattr(trade, "is_short", False) else 1

    def _atr_do_par(self, pair: str, preco_fallback: float) -> float:
        """ATR(14) da última vela fechada, com cache por vela."""
        try:
            df = self.dp.get_pair_dataframe(pair=pair, timeframe=self.timeframe)
            if df is not None and len(df) > 2:
                marca = (len(df), str(df.index[-1]))
                guardado = self._atr_cache.get(pair)
                if guardado and guardado[0] == marca:
                    return guardado[1]
                serie = atr(df, self.atr_periodo.value)
                valor = float(serie.iloc[-1])
                if np.isfinite(valor) and valor > 0:
                    self._atr_cache[pair] = (marca, valor)
                    return valor
        except Exception as erro:  # pragma: no cover - depende do runtime
            logger.debug("VECTRA: ATR indisponível para %s (%s)", pair, erro)
        return preco_fallback * 0.01

    def _iniciar_info(self, trade: Trade) -> dict:
        """Calcula risco, stop e alvo na abertura e guarda no trade."""
        lado = self._lado(trade)
        entrada = float(trade.open_rate)
        atr_valor = self._atr_do_par(trade.pair, entrada)
        risco_preco = self.stop_atr.value * atr_valor
        quantidade = float(trade.amount or 0) or 1.0

        info = {
            "lado": lado,
            "entrada": entrada,
            "atr": atr_valor,
            "risco_preco": risco_preco,
            "risco_usd": risco_preco * quantidade,
            "stop_preco": entrada - lado * risco_preco,
            "alvo_preco": entrada + lado * self.alvo_r.value * risco_preco,
            "travas": [],
            "aberta_em": datetime.now(timezone.utc).isoformat(),
        }
        self._trades[self._chave(trade)] = info
        return info

    def _info(self, trade: Trade) -> Optional[dict]:
        return self._trades.get(self._chave(trade))

    # ─── Stop fixo de 1,0 ATR (seção 22) ─────────────────────────────
    def custom_stoploss(
        self,
        pair: str,
        trade: Trade,
        current_time: datetime,
        current_rate: float,
        current_profit: float,
        after_fill: bool = False,
        **kwargs,
    ) -> Optional[float]:
        info = self._info(trade) or self._iniciar_info(trade)
        stop = info["stop_preco"]
        if not stop or not current_rate:
            return None
        # custom_stoploss devolve distância relativa ao preço ATUAL, não à
        # entrada. Sem isso o stop andava junto com o preço.
        razao = (stop - current_rate) / current_rate
        if razao >= -0.001:
            return -0.001
        return max(razao, self.stoploss)

    # ─── Saída no alvo de 2R (seção 22) ──────────────────────────────
    def custom_exit(
        self,
        pair: str,
        trade: Trade,
        current_time: datetime,
        current_rate: float,
        current_profit: float,
        **kwargs,
    ):
        info = self._info(trade) or self._iniciar_info(trade)
        lucro_r = self._lucro_em_r(trade, current_rate, info)
        # Tolerância: (104 - 100) * 1 / 2,0167 dá 1,999999999999997 e a
        # comparação direta deixaria de sair exatamente no alvo.
        if lucro_r >= self.alvo_r.value - 1e-9:
            return "alvo_2r"
        return None

    def _lucro_em_r(self, trade: Trade, preco: float, info: dict) -> float:
        risco = info.get("risco_preco") or 0.0
        if risco <= 0:
            return 0.0
        return (preco - info["entrada"]) * info["lado"] / risco

    # ─── Escada ──────────────────────────────────────────────────────
    # Não implementada aqui de propósito. Ver o aviso no topo do arquivo e o
    # executor em ../executor/vectra_executor.py. Qualquer redução parcial
    # desta posição seria uma trava falsa.

    # ─── Disjuntores (seção 25) ──────────────────────────────────────
    def _stats_vazias(self) -> dict:
        return {
            "ciclos": 0, "acertos": 0, "equity": 0.0, "topo": 0.0,
            "queda": 0.0, "seq_perdas": 0, "reserva": 0.0,
            "nivel_aberturas": [0, 0, 0, 0, 0], "nivel_acertos": [0, 0, 0, 0, 0],
            "pausado_ate": None,
        }

    def _get_stats(self) -> dict:
        if self._stats is None:
            dados = None
            try:
                if self.estado_path.exists():
                    dados = json.loads(self.estado_path.read_text(encoding="utf-8"))
            except Exception as erro:  # pragma: no cover
                logger.warning("VECTRA: estado ilegível (%s), começando do zero", erro)
            base = self._stats_vazias()
            if isinstance(dados, dict):
                base.update({k: v for k, v in dados.items() if k in base})
            self._stats = base
        return self._stats

    def _salvar_stats(self, stats: dict) -> None:
        try:
            self.estado_path.parent.mkdir(parents=True, exist_ok=True)
            self.estado_path.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as erro:  # pragma: no cover
            logger.error("VECTRA: não consegui salvar o estado (%s)", erro)

    def _acerto(self, stats: dict) -> float:
        return stats["acertos"] / stats["ciclos"] if stats["ciclos"] else 0.0

    def _motivo_bloqueio(self, stats: dict, agora: Optional[datetime] = None) -> Optional[str]:
        """Devolve o motivo do bloqueio, ou None se pode operar."""
        if stats["ciclos"] < 20:
            return None

        pausado_ate = stats.get("pausado_ate")
        if pausado_ate:
            try:
                limite = datetime.fromisoformat(pausado_ate)
                referencia = agora or datetime.now(timezone.utc)
                if limite.tzinfo is None:
                    limite = limite.replace(tzinfo=timezone.utc)
                if referencia < limite:
                    return f"pausa até {limite.isoformat()}"
            except Exception:
                pass

        acerto = self._acerto(stats)
        if acerto < self.ACERTO_DESLIGAR:
            return f"acerto {acerto:.1%} abaixo de {self.ACERTO_DESLIGAR:.0%}"
        if stats["queda"] > self.QUEDA_DESLIGAR:
            return f"queda US$ {stats['queda']:.2f} acima de US$ {self.QUEDA_DESLIGAR:.2f}"
        if stats["seq_perdas"] > self.SEQ_PERDAS_MAX:
            return f"{stats['seq_perdas']} perdas seguidas acima de {self.SEQ_PERDAS_MAX}"
        if stats["queda"] > self.QUEDA_PAUSAR:
            return f"queda US$ {stats['queda']:.2f} acima de US$ {self.QUEDA_PAUSAR:.2f}"
        return None

    def confirm_trade_entry(
        self,
        pair: str,
        order_type: str,
        amount: float,
        rate: float,
        time_in_force: str,
        current_time: datetime,
        entry_tag: Optional[str],
        side: str,
        **kwargs,
    ) -> bool:
        stats = self._get_stats()
        motivo = self._motivo_bloqueio(stats, current_time)
        if motivo:
            logger.warning("VECTRA DISJUNTOR: entrada bloqueada — %s", motivo)
            # Queda acima do limite de pausa agenda a pausa de 24 h.
            if stats["queda"] > self.QUEDA_PAUSAR and not stats.get("pausado_ate"):
                stats["pausado_ate"] = (
                    (current_time or datetime.now(timezone.utc)) + timedelta(hours=self.PAUSA_HORAS)
                ).isoformat()
                self._salvar_stats(stats)
            return False

        # Acerto entre 28% e 33%: opera com metade do lote.
        if stats["ciclos"] >= 20 and self._acerto(stats) < self.ACERTO_REDUZIR:
            logger.warning(
                "VECTRA DISJUNTOR: acerto %.1f%% entre %.0f%% e %.0f%% — lote pela metade",
                self._acerto(stats) * 100, self.ACERTO_DESLIGAR * 100, self.ACERTO_REDUZIR * 100,
            )
        return True

    def custom_stake_amount(
        self,
        pair: str,
        current_time: datetime,
        current_rate: float,
        proposed_stake: float,
        min_stake: Optional[float],
        max_stake: float,
        leverage: float,
        entry_tag: Optional[str],
        side: str,
        **kwargs,
    ) -> float:
        """Reduz o lote pela metade quando o acerto está na faixa de alerta."""
        stats = self._get_stats()
        if stats["ciclos"] >= 20 and self._acerto(stats) < self.ACERTO_REDUZIR:
            reduzido = proposed_stake / 2
            if min_stake and reduzido < min_stake:
                return min_stake
            return reduzido
        return proposed_stake

    # ─── Registro e auditoria (seção 24) ─────────────────────────────
    def confirm_trade_exit(
        self,
        pair: str,
        trade: Trade,
        order_type: str,
        amount: float,
        rate: float,
        time_in_force: str,
        exit_reason: str,
        current_time: datetime,
        **kwargs,
    ) -> bool:
        # Chamado em toda saída (alvo, stop, ROI, manual): é o único ponto em
        # que a perda também é registrada. A versão anterior só registrava o
        # alvo, e por isso o acerto nunca caía.
        chave = self._chave(trade)
        if chave in self._registrados:
            return True
        self._registrados.add(chave)

        info = self._info(trade)
        if info is None:
            info = self._iniciar_info(trade)

        lado = info["lado"]
        quantidade = float(trade.amount or 0) or 1.0
        principal = (rate - info["entrada"]) * lado * quantidade
        travas = sum(t.get("resultado", 0.0) for t in info["travas"])
        total = principal + travas
        risco_usd = info["risco_usd"] or 0.0

        registro = {
            "timestamp": (current_time or datetime.now(timezone.utc)).isoformat(),
            "ciclo_id": f"{trade.pair}_{chave}",
            "par": trade.pair,
            "lado": "venda" if lado == -1 else "compra",
            "abertura": info.get("aberta_em"),
            "preco_entrada": info["entrada"],
            "atr_entrada": info["atr"],
            "risco_usd": risco_usd,
            "saida_principal": rate,
            "motivo_saida": exit_reason,
            "resultado_principal": principal,
            "resultado_travas": travas,
            "resultado_total": total,
            "resultado_r": total / risco_usd if risco_usd else 0.0,
            "travas": info["travas"],
        }

        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as arquivo:
                arquivo.write(json.dumps(registro, ensure_ascii=False) + "\n")
        except Exception as erro:  # pragma: no cover
            logger.error("VECTRA AUDITORIA: falha ao gravar (%s)", erro)

        stats = self._get_stats()
        stats["ciclos"] += 1
        if total > 0:
            stats["acertos"] += 1
            stats["seq_perdas"] = 0
            stats["reserva"] += total * self.RESERVA_PCT
        else:
            stats["seq_perdas"] += 1

        for trava in info["travas"]:
            for indice, nivel in enumerate(self.NIVEIS):
                if abs(trava["nivel"] - nivel) < 0.01:
                    if trava["estado"] in ("alvo", "corte"):
                        stats["nivel_aberturas"][indice] += 1
                        if trava["estado"] == "alvo":
                            stats["nivel_acertos"][indice] += 1
                    break

        stats["equity"] += total
        if stats["equity"] > stats["topo"]:
            stats["topo"] = stats["equity"]
        queda = stats["topo"] - stats["equity"]
        if queda > stats["queda"]:
            stats["queda"] = queda

        acerto_nivel1 = (
            stats["nivel_acertos"][0] / stats["nivel_aberturas"][0]
            if stats["nivel_aberturas"][0] else 0.0
        )
        if stats["nivel_aberturas"][0] >= 20 and acerto_nivel1 < self.NIVEL1_REVISAR:
            logger.warning(
                "VECTRA DISJUNTOR: nível 1 com acerto %.0f%% abaixo de %.0f%% — revisar o alvo da trava",
                acerto_nivel1 * 100, self.NIVEL1_REVISAR * 100,
            )

        self._salvar_stats(stats)
        self._trades.pop(chave, None)
        return True
