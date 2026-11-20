/**
 * Caldeira · Entrada de Insumos
 * Recebe o POST do formulário e grava no Banco de Entradas.
 *
 * COMO PUBLICAR (uma vez só, 2 minutos):
 * 1. Abra a planilha > Extensões > Apps Script.
 * 2. Apague o conteúdo e cole este arquivo inteiro.
 * 3. Implantar > Nova implantação > tipo "App da Web".
 *    Executar como: eu. Quem tem acesso: qualquer pessoa.
 * 4. Copie a URL que termina em /exec e cole no HTML em const ENDPOINT.
 */

const ABA = 'Banco de Entradas';
const COLUNAS = 13; // A até M

function doGet() {
  return json({ ok: true, aba: ABA, mensagem: 'receptor no ar' });
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (!d.produto) return json({ ok: false, erro: 'produto vazio' });

    const sh = SpreadsheetApp.getActive().getSheetByName(ABA);
    if (!sh) return json({ ok: false, erro: 'aba ' + ABA + ' nao encontrada' });

    const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    let ultimaLinha = 0;
    let maior = 0;
    for (let i = 0; i < ids.length; i++) {
      const v = String(ids[i][0]).trim();
      const m = v.match(/^ENT-(\d+)/);
      if (m) {
        ultimaLinha = i + 1;
        maior = Math.max(maior, parseInt(m[1], 10));
      }
    }

    const id = 'ENT-' + String(maior + 1).padStart(4, '0');
    const linha = [
      id,
      d.data || '',
      d.tipo || '',
      d.produto || '',
      d.destino || '',
      d.qtd || '',
      d.unid || '',
      d.fornecedor || '',
      d.temp || '',
      d.responsavel || '',
      d.nf || '',
      d.pesoBruto || '',
      d.pesoLiquido || ''
    ].slice(0, COLUNAS);

    const alvo = Math.max(ultimaLinha + 1, 5);
    sh.getRange(alvo, 1, 1, COLUNAS).setValues([linha]);
    sh.getRange(alvo, 1, 1, COLUNAS).setHorizontalAlignment('center');

    if (d.obs) {
      const obs = sh.getRange(1, COLUNAS + 1, 1, 1).getValue();
      const colObs = obs ? COLUNAS + 1 : COLUNAS + 1;
      sh.getRange(alvo, colObs).setValue(d.obs);
    }

    return json({ ok: true, id: id, linha: alvo });
  } catch (err) {
    return json({ ok: false, erro: String(err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
