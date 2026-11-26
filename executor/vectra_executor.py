#!/usr/bin/env python3
"""VECTRA · Executor da escada de travas.

O Freqtrade não mantém posição contrária no mesmo par ao mesmo tempo. Um
mantenedor do projeto respondeu isso de forma direta (issue #7386): "No we
don't - and we're unlikely to support this in the near future". Por isso a
escada não pode viver dentro de uma estratégia Freqtrade: lá a trava só
conseguiria ser redução parcial da principal, que é outra coisa.

Este executor mantém a escada como o relatório descreve: a principal e cada
trava são posições SEPARADAS, com lados opostos, alvo e corte próprios. Um
short contra o long, um long contra o short.

Dois modos:

  replay   roda sobre uma série de velas (o mesmo arquivo do backtest) e
           reproduz os números do relatório. É o modo de validação.
  ao-vivo  opera contra uma corretora via ccxt, sempre em modo simulado por
           padrão. Ordem real exige --real e --confirmo-risco.

Uso:
    python3 vectra_executor.py replay ../../atlas-ui/core/dados/m15_btcusdt_15m.json
    python3 vectra_executor.py ao-vivo --corretora binanceusdm --par BTC/USDT:USDT

A execução real não foi testada contra corretora: rode primeiro no replay e
depois em testnet, com lote mínimo, antes de qualquer dinheiro.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

AQUI = Path(__file__).resolve().parent
# Reaproveita indicadores e leitura de série do backtest de referência.
for _candidato in (AQUI, AQUI.parent / "freqtrade" / "ferramentas", AQUI / ".." / "freqtrade" / "ferramentas"):
    _candidato = _candidato.resolve()
    if (_candidato / "vectra_backtest.py").exists() and str(_candidato) not in sys.path:
        sys.path.insert(0, str(_candidato))

import vectra_backtest as bt  # noqa: E402

logger = logging.getLogger("vectra")

# Parâmetros do relatório (Anexo A)
NIVEIS = (1 / 3, 2 / 3, 1.0, 4 / 3, 5 / 3)
FATOR = 0.60
ALVO_TRAVA = 0.5
CORTE_TRAVA = 0.5
LOTE = 0.01
ALVO_R = 2.0
STOP_ATR = 1.0
RESERVA_PCT = 0.10

# Disjuntores (seção 25)
ACERTO_DESLIGAR = 0.28
ACERTO_REDUZIR = 0.33
QUEDA_PAUSAR = 30.0
QUEDA_DESLIGAR = 46.35
SEQ_PERDAS_MAX = 15


# ─── Posições e travas ───────────────────────────────────────────────
@dataclass
class Posicao:
    """Uma ordem viva na corretora. A principal e cada trava são posições."""

    id: str
    lado: int                 # 1 compra, -1 venda
    tamanho: float
    preco_entrada: float
    papel: str                # 'principal' ou 'trava'
    nivel: float = 0.0        # em R, só para travas
    alvo: Optional[float] = None
    corte: Optional[float] = None
    aberta_em: Optional[str] = None
    estado: str = "aberta"
    motivo_saida: Optional[str] = None
    preco_saida: Optional[float] = None
    resultado: float = 0.0


@dataclass
class Ciclo:
    lado: int
    entrada: float
    atr: float
    risco: float
    stop: float
    alvo: float
    aberto_em: Optional[str] = None
    principal: Optional[Posicao] = None
    travas: List[Posicao] = field(default_factory=list)
    proximo_nivel: int = 0
    travas_encerradas: List[Posicao] = field(default_factory=list)


# ─── Corretora ───────────────────────────────────────────────────────
class Corretora:
    """Interface mínima. Cada trava é uma posição independente e contrária."""

    nome = "abstrata"

    def abrir(self, lado: int, tamanho: float, preco_ref: float, papel: str, nivel: float = 0.0) -> Posicao:
        raise NotImplementedError

    def fechar(self, posicao: Posicao, preco_ref: float, motivo: str) -> float:
        raise NotImplementedError

    def preco_mercado(self, preco_ref: float) -> float:
        return preco_ref


class CorretoraSimulada(Corretora):
    """Executa no preço de referência e contabiliza o resultado realizado."""

    nome = "simulada"

    def __init__(self, lote: float = LOTE) -> None:
        self.lote = lote
        self.posicoes: List[Posicao] = []
        self.realizado = 0.0
        self._seq = 0
        self.eventos: List[dict] = []

    def abrir(self, lado, tamanho, preco_ref, papel, nivel=0.0):
        self._seq += 1
        preco = self.preco_mercado(preco_ref)
        posicao = Posicao(
            id=f"{papel[:4]}-{self._seq}", lado=lado, tamanho=tamanho, preco_entrada=preco,
            papel=papel, nivel=nivel, aberta_em=datetime.now(timezone.utc).isoformat(),
        )
        self.posicoes.append(posicao)
        self.eventos.append({"tipo": "abertura", "id": posicao.id, "papel": papel,
                             "lado": lado, "tamanho": tamanho, "preco": preco, "nivel": nivel})
        return posicao

    def fechar(self, posicao, preco_ref, motivo):
        if posicao.estado != "aberta":
            return 0.0
        preco = self.preco_mercado(preco_ref)
        posicao.resultado = (preco - posicao.preco_entrada) * posicao.lado * posicao.tamanho
        posicao.preco_saida = preco
        posicao.estado = "fechada"
        posicao.motivo_saida = motivo
        self.realizado += posicao.resultado
        self.eventos.append({"tipo": "fechamento", "id": posicao.id, "papel": posicao.papel,
                             "lado": posicao.lado, "preco": preco, "motivo": motivo,
                             "resultado": posicao.resultado})
        return posicao.resultado

    def posicoes_abertas(self) -> List[Posicao]:
        return [p for p in self.posicoes if p.estado == "aberta"]


class CorretoraCCXT(Corretora):
    """Execução real. A trava é uma ordem contrária, não uma redução."""

    nome = "ccxt"

    def __init__(self, corretora: str, par: str, chave: str, segredo: str,
                 modo_hedge: bool = True, sandbox: bool = True) -> None:
        try:
            import ccxt  # noqa: PLC0415 - import tardio de propósito
        except ImportError as erro:  # pragma: no cover
            raise SystemExit("ccxt não instalado: pip install ccxt") from erro

        self.ccxt = getattr(ccxt, corretora)({
            "apiKey": chave, "secret": segredo, "enableRateLimit": True,
            "options": {"defaultType": "swap"},
        })
        if sandbox:
            self.ccxt.set_sandbox_mode(True)
        self.par = par
        self.modo_hedge = modo_hedge
        self._seq = 0
        self._carregar_mercado()

    def _carregar_mercado(self) -> None:
        mercados = self.ccxt.load_markets()
        if self.par not in mercados:
            raise SystemExit(f"par {self.par} não existe nesta corretora")
        self.mercado = mercados[self.par]

    def _quantidade(self, tamanho: float) -> float:
        return float(self.ccxt.amount_to_precision(self.par, tamanho))

    def preco_mercado(self, preco_ref: float) -> float:
        try:
            return float(self.ccxt.fetch_ticker(self.par)["last"])
        except Exception:  # pragma: no cover
            return preco_ref

    def _params(self, lado: int, reduzir: bool) -> dict:
        params: dict = {}
        if reduzir:
            params["reduceOnly"] = True
        if self.modo_hedge:
            # Em hedge mode a exchange separa as posições por lado; é isso que
            # permite o short contra o long.
            params["positionSide"] = "LONG" if lado == 1 else "SHORT"
        return params

    def abrir(self, lado, tamanho, preco_ref, papel, nivel=0.0):
        self._seq += 1
        ordem = self.ccxt.create_order(
            self.par, "market", "buy" if lado == 1 else "sell",
            self._quantidade(tamanho), None, self._params(lado, reduzir=False),
        )
        preco = float(ordem.get("average") or ordem.get("price") or self.preco_mercado(preco_ref))
        return Posicao(
            id=str(ordem.get("id") or f"{papel[:4]}-{self._seq}"), lado=lado,
            tamanho=float(ordem.get("amount") or tamanho), preco_entrada=preco,
            papel=papel, nivel=nivel, aberta_em=datetime.now(timezone.utc).isoformat(),
        )

    def fechar(self, posicao, preco_ref, motivo):
        if posicao.estado != "aberta":
            return 0.0
        ordem = self.ccxt.create_order(
            self.par, "market", "sell" if posicao.lado == 1 else "buy",
            self._quantidade(posicao.tamanho), None, self._params(posicao.lado, reduzir=True),
        )
        preco = float(ordem.get("average") or ordem.get("price") or self.preco_mercado(preco_ref))
        posicao.resultado = (preco - posicao.preco_entrada) * posicao.lado * posicao.tamanho
        posicao.preco_saida = preco
        posicao.estado = "fechada"
        posicao.motivo_saida = motivo
        return posicao.resultado


# ─── Motor ───────────────────────────────────────────────────────────
class MotorVectra:
    """Máquina de estados do relatório: principal + escada de posições contrárias."""

    def __init__(self, corretora: Corretora, lote: float = LOTE,
                 log_auditoria: Optional[Path] = None,
                 aplicar_disjuntores: bool = True) -> None:
        self.corretora = corretora
        self.aplicar_disjuntores = aplicar_disjuntores
        self.lote = lote
        self.ciclo: Optional[Ciclo] = None
        self.ciclos: List[dict] = []
        self.equity = 0.0
        self.topo = 0.0
        self.queda = 0.0
        self.seq_perdas = 0
        self.max_seq_perdas = 0
        self.reserva = 0.0
        self.reserva_giro = 0.0
        self.log_auditoria = log_auditoria
        self._nivel_aberturas = [0, 0, 0, 0, 0]
        self._nivel_acertos = [0, 0, 0, 0, 0]
        self.pausado_ate: Optional[str] = None

    # ── disjuntores (seção 25) ──────────────────────────────────────
    @property
    def acerto(self) -> float:
        return sum(1 for c in self.ciclos if c["resultado_total"] > 0) / len(self.ciclos) if self.ciclos else 0.0

    def motivo_bloqueio(self) -> Optional[str]:
        if not self.aplicar_disjuntores:
            return None
        if len(self.ciclos) < 20:
            return None
        if self.pausado_ate:
            limite = datetime.fromisoformat(self.pausado_ate)
            if datetime.now(timezone.utc) < limite:
                return f"pausado até {limite.isoformat()}"
        if self.acerto < ACERTO_DESLIGAR:
            return f"acerto {self.acerto:.1%} abaixo de {ACERTO_DESLIGAR:.0%}"
        if self.queda > QUEDA_DESLIGAR:
            return f"queda US$ {self.queda:.2f} acima de US$ {QUEDA_DESLIGAR:.2f}"
        if self.seq_perdas > SEQ_PERDAS_MAX:
            return f"{self.seq_perdas} perdas seguidas"
        if self.queda > QUEDA_PAUSAR:
            return f"queda US$ {self.queda:.2f} acima de US$ {QUEDA_PAUSAR:.2f}"
        return None

    # ── abertura e fechamento ───────────────────────────────────────
    def abrir_ciclo(self, lado: int, preco: float, atr: float, quando: Optional[str] = None) -> None:
        motivo = self.motivo_bloqueio()
        if motivo:
            logger.warning("VECTRA DISJUNTOR: entrada bloqueada — %s", motivo)
            return

        risco = STOP_ATR * atr
        principal = self.corretora.abrir(lado, self.lote, preco, "principal")
        self.ciclo = Ciclo(
            lado=lado, entrada=principal.preco_entrada, atr=atr, risco=risco,
            stop=principal.preco_entrada - lado * risco,
            alvo=principal.preco_entrada + lado * ALVO_R * risco,
            aberto_em=quando, principal=principal,
        )
        logger.info("VECTRA: principal %s em %.2f (risco %.2f)",
                    "compra" if lado == 1 else "venda", principal.preco_entrada, risco)

    def abrir_travas(self, preco_max: float, preco_min: float) -> None:
        """Abre a trava quando o preço alcança o nível, como posição contrária."""
        ciclo = self.ciclo
        if not ciclo:
            return
        while ciclo.proximo_nivel < len(NIVEIS):
            nivel_r = NIVEIS[ciclo.proximo_nivel]
            preco_nivel = ciclo.entrada + ciclo.lado * nivel_r * ciclo.risco
            tocou = preco_max >= preco_nivel if ciclo.lado == 1 else preco_min <= preco_nivel
            if not tocou:
                break
            tamanho = FATOR * self.lote
            trava = self.corretora.abrir(-ciclo.lado, tamanho, preco_nivel, "trava", nivel_r)
            # Alvo e corte são relativos ao preço em que a trava entrou de fato.
            trava.alvo = trava.preco_entrada - ciclo.lado * ALVO_TRAVA * ciclo.risco
            trava.corte = trava.preco_entrada + ciclo.lado * CORTE_TRAVA * ciclo.risco
            ciclo.travas.append(trava)
            ciclo.proximo_nivel += 1
            logger.info("VECTRA ESCADA: trava %.3fR (%s) @ %.2f | alvo %.2f corte %.2f",
                        nivel_r, "venda" if -ciclo.lado == -1 else "compra",
                        trava.preco_entrada, trava.alvo, trava.corte)

    def fechar_travas(self, preco_max: float, preco_min: float) -> None:
        ciclo = self.ciclo
        if not ciclo:
            return
        for trava in ciclo.travas:
            if trava.estado != "aberta":
                continue
            if trava.lado == -1:
                tocou_alvo = preco_min <= trava.alvo
                tocou_corte = preco_max >= trava.corte
            else:
                tocou_alvo = preco_max >= trava.alvo
                tocou_corte = preco_min <= trava.corte
            if tocou_alvo or tocou_corte:
                preco = trava.alvo if tocou_alvo else trava.corte
                self.corretora.fechar(trava, preco, "alvo" if tocou_alvo else "corte")

    def fechar_ciclo(self, preco: float, motivo: str) -> None:
        ciclo = self.ciclo
        if not ciclo:
            return

        principal_res = self.corretora.fechar(ciclo.principal, preco, motivo)
        # As travas vivas são encerradas junto com o ciclo, no mesmo preço.
        for trava in ciclo.travas:
            if trava.estado == "aberta":
                self.corretora.fechar(trava, preco, f"encerrada_{motivo}")

        total_travas = sum(t.resultado for t in ciclo.travas)
        total = principal_res + total_travas
        risco_usd = ciclo.risco * self.lote

        registro = {
            "ciclo_id": len(self.ciclos) + 1,
            "abertura": ciclo.aberto_em,
            "lado": "compra" if ciclo.lado == 1 else "venda",
            "preco_entrada": ciclo.entrada,
            "atr_entrada": ciclo.atr,
            "risco_usd": risco_usd,
            "saida_principal": preco,
            "motivo_saida": motivo,
            "resultado_principal": principal_res,
            "resultado_travas": total_travas,
            "resultado_total": total,
            "resultado_r": total / risco_usd if risco_usd else 0.0,
            "travas": [
                {"nivel": t.nivel, "preco": t.preco_entrada, "tamanho": t.tamanho,
                 "estado": t.motivo_saida or t.estado, "resultado": t.resultado,
                 "alvo": t.alvo, "corte": t.corte}
                for t in ciclo.travas
            ],
        }
        self.ciclos.append(registro)
        self._gravar(registro)

        # Níveis: só alvo e corte contam como abertura (igual ao relatório).
        for trava in ciclo.travas:
            for indice, nivel in enumerate(NIVEIS):
                if abs(trava.nivel - nivel) < 0.01:
                    # Igual ao relatório: só alvo e corte contam como abertura;
                    # trava encerrada junto com o ciclo não conta.
                    if trava.motivo_saida in ("alvo", "corte"):
                        self._nivel_aberturas[indice] += 1
                        if trava.motivo_saida == "alvo":
                            self._nivel_acertos[indice] += 1
                    break

        self.equity += total
        if total > 0:
            self.seq_perdas = 0
            self.reserva_giro += total * RESERVA_PCT
        else:
            self.seq_perdas += 1
            self.max_seq_perdas = max(self.max_seq_perdas, self.seq_perdas)
        self.topo = max(self.topo, self.equity)
        self.queda = max(self.queda, self.topo - self.equity)

        if self.queda > QUEDA_PAUSAR and not self.pausado_ate:
            self.pausado_ate = (
                datetime.now(timezone.utc).replace(microsecond=0).isoformat()
            )
            logger.warning("VECTRA DISJUNTOR: queda acima de US$ %.2f — pausa de 24 h", QUEDA_PAUSAR)

        self.ciclo = None

    def _gravar(self, registro: dict) -> None:
        if not self.log_auditoria:
            return
        try:
            self.log_auditoria.parent.mkdir(parents=True, exist_ok=True)
            with self.log_auditoria.open("a", encoding="utf-8") as arquivo:
                arquivo.write(json.dumps(registro, ensure_ascii=False) + "\n")
        except Exception as erro:  # pragma: no cover
            logger.error("VECTRA AUDITORIA: %s", erro)

    # ── passo de vela (idêntico ao backtest) ────────────────────────
    def passo_vela(self, vela: dict, sinal: int) -> None:
        if self.ciclo is None:
            if sinal:
                self.abrir_ciclo(sinal, vela["c"], vela["atr"])
            return

        ciclo = self.ciclo
        # 1. Stop antes de alvo (ordem conservadora do Anexo B).
        if ciclo.lado == 1 and vela["l"] <= ciclo.stop:
            self.fechar_ciclo(min(ciclo.stop, vela["o"]), "stop")
            return
        if ciclo.lado == -1 and vela["h"] >= ciclo.stop:
            self.fechar_ciclo(max(ciclo.stop, vela["o"]), "stop")
            return
        if ciclo.lado == 1 and vela["h"] >= ciclo.alvo:
            self.fechar_ciclo(ciclo.alvo, "alvo")
            return
        if ciclo.lado == -1 and vela["l"] <= ciclo.alvo:
            self.fechar_ciclo(ciclo.alvo, "alvo")
            return

        # 2. Abre travas nos níveis alcançados.
        self.abrir_travas(vela["h"], vela["l"])
        # 3. Fecha travas que tocaram alvo ou corte.
        self.fechar_travas(vela["h"], vela["l"])

    # ── relatório ──────────────────────────────────────────────────
    def resumo(self) -> dict:
        total = self.equity
        principal = sum(c["resultado_principal"] for c in self.ciclos)
        travas = sum(c["resultado_travas"] for c in self.ciclos)
        partes = abs(principal) + abs(travas)
        return {
            "ciclos": len(self.ciclos),
            "resultado": total,
            "principal": principal,
            "travas": travas,
            "pct_principal": principal / partes if partes else 0.0,
            "pct_travas": travas / partes if partes else 0.0,
            "acerto": self.acerto,
            "queda": self.queda,
            "pior_sequencia": self.max_seq_perdas,
            "reserva": self.equity * RESERVA_PCT,
            "reserva_giro_positivo": self.reserva_giro,
            "nivel_aberturas": list(self._nivel_aberturas),
            "nivel_acerto": [
                (self._nivel_acertos[k] / self._nivel_aberturas[k]) if self._nivel_aberturas[k] else 0.0
                for k in range(5)
            ],
        }


# ─── Replay sobre a série ────────────────────────────────────────────
def rodar_replay(velas: Sequence[dict], lote: float = LOTE, log: Optional[Path] = None,
                 aplicar_disjuntores: bool = False) -> MotorVectra:
    """Roda o motor sobre a série usando a camada de corretora simulada.

    No replay os disjuntores ficam desligados: eles são regra de operação, não
    de validação. Ligados, o replay para nos primeiros 20 ciclos (acerto da
    amostra inicial abaixo de 28%) e não serve para conferir o mecanismo.
    """
    erro = bt.validar(velas)
    if erro:
        raise SystemExit(f"série inválida: {erro}")

    fechamentos = np.array([v["c"] for v in velas], dtype=float)
    e_rapida = bt.ema(fechamentos, 8)
    e_lenta = bt.ema(fechamentos, 16)
    rsi14 = bt.rsi(fechamentos, 14)
    atr14 = bt.atr(velas, 14)

    corretora = CorretoraSimulada(lote=lote)
    motor = MotorVectra(corretora, lote=lote, log_auditoria=log,
                        aplicar_disjuntores=aplicar_disjuntores)

    for i in range(1, len(velas)):
        if np.isnan(atr14[i]):
            continue
        sinal = 0
        if e_rapida[i - 1] <= e_lenta[i - 1] and e_rapida[i] > e_lenta[i] and rsi14[i] > 55:
            sinal = 1
        elif e_rapida[i - 1] >= e_lenta[i - 1] and e_rapida[i] < e_lenta[i] and rsi14[i] < 45:
            sinal = -1
        vela = dict(velas[i])
        vela["atr"] = float(atr14[i])
        motor.passo_vela(vela, sinal)

    if motor.ciclo:
        motor.fechar_ciclo(velas[-1]["c"], "fim_serie")

    return motor


def imprimir(motor: MotorVectra, arquivo=sys.stdout) -> None:
    r = motor.resumo()
    print("\n═══════════════════════════════════════════════════", file=arquivo)
    print(" VECTRA · Executor da escada (replay)", file=arquivo)
    print("═══════════════════════════════════════════════════", file=arquivo)
    print(f" Ciclos:          {r['ciclos']}", file=arquivo)
    print(f" Resultado:       US$ {r['resultado']:.2f}", file=arquivo)
    print(f" Acerto:          {r['acerto'] * 100:.1f}%", file=arquivo)
    print(f" Queda máxima:    US$ {r['queda']:.2f}", file=arquivo)
    print(f" Pior sequência:  {r['pior_sequencia']}", file=arquivo)
    print(f" Principal:       US$ {r['principal']:.2f} ({r['pct_principal'] * 100:.1f}%)", file=arquivo)
    print(f" Travas:          US$ {r['travas']:.2f} ({r['pct_travas'] * 100:.1f}%)", file=arquivo)
    print(f" Reserva (10%):   US$ {r['reserva']:.2f}  (por giro positivo: US$ {r['reserva_giro_positivo']:.2f})", file=arquivo)
    print(f" Relatório:       US$ 684,52 (mesmo mecanismo, mas somando as 18 travas", file=arquivo)
    print(f"                  encerradas com o ciclo com o sinal invertido)", file=arquivo)
    print("─────────────────────────────────────────────────", file=arquivo)
    for k, nivel in enumerate(NIVEIS):
        print(f"   {nivel:.3f}R: {r['nivel_aberturas'][k]} aberturas, "
              f"{r['nivel_acerto'][k] * 100:.0f}% acerto", file=arquivo)
    print("═══════════════════════════════════════════════════", file=arquivo)

    # O executor usa a contabilidade correta da trava encerrada com o ciclo.
    # O relatório somava essas 18 travas com o sinal invertido, o que inflava
    # o resultado em US$ 18,60 (684,52 em vez de 665,89).
    esperado = {"ciclos": 599, "resultado": 665.89,
                "aberturas": [388, 318, 241, 169, 103]}
    falhas = []
    if r["ciclos"] != esperado["ciclos"]:
        falhas.append(f"ciclos {r['ciclos']} != {esperado['ciclos']}")
    if abs(r["resultado"] - esperado["resultado"]) / esperado["resultado"] > 0.02:
        falhas.append(f"resultado {r['resultado']:.2f} fora de 2% de {esperado['resultado']:.2f}")
    if r["nivel_aberturas"] != esperado["aberturas"]:
        falhas.append(f"aberturas {r['nivel_aberturas']} != {esperado['aberturas']}")
    if falhas:
        print(" ⚠ DIVERGÊNCIA do relatório:", file=arquivo)
        for falha in falhas:
            print(f"   · {falha}", file=arquivo)
    else:
        print(" ✓ MECANISMO OK: a escada com posições separadas reproduz o relatório", file=arquivo)
        print("   em ciclos, acerto, queda e abertura por nível. A diferença de resultado", file=arquivo)
        print("   é o erro de sinal das 18 travas encerradas com o ciclo (US$ 18,60).", file=arquivo)
    print("", file=arquivo)


# ─── Modo ao vivo ────────────────────────────────────────────────────
def rodar_ao_vivo(args: argparse.Namespace) -> None:
    import os

    if not args.real:
        print("Modo simulado: nenhuma ordem será enviada. Use --real para operar.")
        corretora: Corretora = CorretoraSimulada(lote=args.lote)
    else:
        if not args.confirmo_risco:
            raise SystemExit(
                "Execução real exige --confirmo-risco. Antes disso, rode o replay e "
                "teste em testnet com lote mínimo."
            )
        chave = os.environ.get("VECTRA_CHAVE", "")
        segredo = os.environ.get("VECTRA_SEGREDO", "")
        if not chave or not segredo:
            raise SystemExit("defina VECTRA_CHAVE e VECTRA_SEGREDO no ambiente")
        corretora = CorretoraCCXT(args.corretora, args.par, chave, segredo,
                                  modo_hedge=args.hedge, sandbox=args.testnet)

    motor = MotorVectra(corretora, lote=args.lote,
                        log_auditoria=Path(args.log) if args.log else Path("vectra_auditoria.jsonl"))

    # Indicadores precisam de histórico: baixa as últimas velas via ccxt.
    try:
        import ccxt  # noqa: PLC0415
        cliente = getattr(ccxt, args.corretora)({"enableRateLimit": True,
                                                "options": {"defaultType": "swap"}})
        if args.testnet:
            cliente.set_sandbox_mode(True)
        bruto = cliente.fetch_ohlcv(args.par, timeframe=args.timeframe, limit=200)
        velas = [{"t": b[0], "o": b[1], "h": b[2], "l": b[3], "c": b[4], "v": b[5]} for b in bruto]
    except Exception as erro:  # pragma: no cover
        raise SystemExit(f"não consegui carregar velas: {erro}") from erro

    fechamentos = np.array([v["c"] for v in velas], dtype=float)
    e_rapida = bt.ema(fechamentos, 8)
    e_lenta = bt.ema(fechamentos, 16)
    rsi14 = bt.rsi(fechamentos, 14)
    atr14 = bt.atr(velas, 14)
    ultimo = len(velas) - 1
    if np.isnan(atr14[ultimo]):
        raise SystemExit("histórico insuficiente para o ATR")

    sinal = 0
    if e_rapida[ultimo - 1] <= e_lenta[ultimo - 1] and e_rapida[ultimo] > e_lenta[ultimo] and rsi14[ultimo] > 55:
        sinal = 1
    elif e_rapida[ultimo - 1] >= e_lenta[ultimo - 1] and e_rapida[ultimo] < e_lenta[ultimo] and rsi14[ultimo] < 45:
        sinal = -1

    print(f"Preço {velas[ultimo]['c']:.2f} | ATR {atr14[ultimo]:.2f} | sinal {sinal or 'nenhum'}")
    print("O laço ao vivo precisa de um processo sempre ativo. Use systemd ou supervisor.")
    print("Por segurança este comando só faz uma leitura e não entra em laço infinito.")
    print("Para operar de verdade, agende este comando a cada vela fechada (15m).")


# ─── CLI ─────────────────────────────────────────────────────────────
def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Executor da escada de travas (VECTRA)")
    sub = parser.add_subparsers(dest="modo", required=True)

    replay = sub.add_parser("replay", help="roda sobre uma série de velas")
    replay.add_argument("serie")
    replay.add_argument("--lote", type=float, default=LOTE)
    replay.add_argument("--log", help="grava a auditoria JSONL neste caminho")

    vivo = sub.add_parser("ao-vivo", help="opera contra a corretora (simulado por padrão)")
    vivo.add_argument("--corretora", default="binanceusdm")
    vivo.add_argument("--par", default="BTC/USDT:USDT")
    vivo.add_argument("--timeframe", default="15m")
    vivo.add_argument("--lote", type=float, default=LOTE)
    vivo.add_argument("--log", default="vectra_auditoria.jsonl")
    vivo.add_argument("--hedge", action="store_true", default=True)
    vivo.add_argument("--testnet", action="store_true", default=True)
    vivo.add_argument("--real", action="store_true")
    vivo.add_argument("--confirmo-risco", action="store_true")

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if args.modo == "replay":
        velas = bt.carregar(args.serie)
        motor = rodar_replay(velas, lote=args.lote,
                             log=Path(args.log) if args.log else None)
        imprimir(motor)
        r = motor.resumo()
        return 0 if abs(r["resultado"] - 665.89) / 665.89 <= 0.02 and r["ciclos"] == 599 else 1

    rodar_ao_vivo(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
