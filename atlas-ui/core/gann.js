// Núcleo puro de Gann: família de ângulos, ciclos de tempo e Quadrado de Nove.
// Sem tela, sem estado. Entra data e preço, sai nível e data.
//
// A família de ângulos segue a notação de Gann (preço x tempo):
// 1x8, 1x4, 1x3, 1x2, 1x1 (45 graus), 2x1, 3x1, 4x1, 8x1.
// A conversão para preço depende da escala declarada, a mesma do núcleo de
// figuras: quantas unidades de preço uma barra vale.

export const GANN_VERSION = '1.0.0';
const RAD = 180 / Math.PI;

export const FAMILIA = [
  { nome: '1x8', razao: 1 / 8 },
  { nome: '1x4', razao: 1 / 4 },
  { nome: '1x3', razao: 1 / 3 },
  { nome: '1x2', razao: 1 / 2 },
  { nome: '1x1', razao: 1 },
  { nome: '2x1', razao: 2 },
  { nome: '3x1', razao: 3 },
  { nome: '4x1', razao: 4 },
  { nome: '8x1', razao: 8 }
];

export function grausDaFamilia() {
  return FAMILIA.map(a => ({ nome: a.nome, graus: Math.round(Math.atan(a.razao) * RAD * 10) / 10 }));
}

// Projeta a família a partir de um pivô (barra + preço).
export function familiaDeAngulos(p0, i0, escalaPreco, barras = 30) {
  return FAMILIA.map(a => ({
    nome: a.nome,
    graus: Math.round(Math.atan(a.razao) * RAD * 10) / 10,
    valorEm: i => p0 + a.razao * escalaPreco * (i - i0),
    valorFinal: Math.round((p0 + a.razao * escalaPreco * barras) * 100) / 100
  }));
}

// Quadrado de Nove: níveis por raiz quadrada, com incremento de 1/8 de volta.
export function quadradoDeNove(preco, passos = 4, fracao = 0.125) {
  if (!(preco > 0)) return null;
  const raiz = Math.sqrt(preco);
  const niveis = [];
  for (let k = -passos; k <= passos; k++) {
    const r = raiz + k * fracao;
    niveis.push({ passo: k, preco: Math.round(r * r * 100) / 100 });
  }
  return { raiz: Math.round(raiz * 10000) / 10000, fracao, niveis };
}

// Ciclos de tempo de Gann a partir de uma data de pivô.
export const CICLOS_DIAS = [30, 45, 60, 90, 120, 144, 180, 270, 360];

export function ciclosTempo(dataPivo, hoje = new Date()) {
  const pivo = dataPivo instanceof Date ? dataPivo : new Date(dataPivo);
  if (isNaN(pivo)) return null;
  const dia = 86400000;
  const passados = Math.floor((hoje - pivo) / dia);
  const proximos = CICLOS_DIAS.map(d => ({
    dias: d,
    data: new Date(pivo.getTime() + d * dia).toISOString().slice(0, 10),
    faltam: d - passados
  }));
  const proximo = proximos.filter(c => c.faltam >= 0).sort((a, b) => a.faltam - b.faltam)[0] || null;
  return { dataPivo: pivo.toISOString().slice(0, 10), diasDesde: passados, proximos, proximo };
}

// Datas sazonais que Gann marcava e viradas de estação.
export const JANELAS_SAZONAIS = [
  { nome: 'virada de ano', de: '01-03', ate: '01-07' },
  { nome: 'fevereiro', de: '02-04', ate: '02-10' },
  { nome: 'equinócio de março', de: '03-20', ate: '03-27' },
  { nome: 'maio', de: '05-03', ate: '05-10' },
  { nome: 'solstício de junho', de: '06-20', ate: '06-27' },
  { nome: 'agosto', de: '08-03', ate: '08-10' },
  { nome: 'equinócio de setembro', de: '09-20', ate: '09-27' },
  { nome: 'novembro', de: '11-03', ate: '11-10' },
  { nome: 'solstício de dezembro', de: '12-20', ate: '12-27' }
];

export function calendarioGann(hoje = new Date()) {
  const md = hoje.toISOString().slice(5, 10);
  const dentro = JANELAS_SAZONAIS.find(j => md >= j.de && md <= j.ate) || null;
  const proximas = JANELAS_SAZONAIS.filter(j => j.de > md).slice(0, 3);
  return { hoje: hoje.toISOString().slice(0, 10), dentroDe: dentro ? dentro.nome : null, proximas };
}
