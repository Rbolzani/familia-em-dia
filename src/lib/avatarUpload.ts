// Prepara a foto do filho ANTES de subir: sai sempre JPEG.
//
// O DEFEITO QUE ORIGINOU ISTO
// A foto ia para o bucket como chegava do seletor de arquivos. Foto de
// iPhone é HEIC, que só o Safari desenha — no Chrome, Edge e Firefox o
// avatar aparecia quebrado. E o modo da falha é o pior possível: o upload dá
// certo, o caminho é gravado, nenhum erro aparece, e a foto simplesmente não
// existe na tela. O usuário conclui que o app não salvou.
//
// DOIS CAMINHOS, NESTA ORDEM
// 1. Navegador (canvas): cobre jpg, png, webp e o HEIC no Safari. Converte e
//    reduz sem custo de servidor.
// 2. Servidor (`/api/images/jpeg`): o resgate do HEIC onde o navegador não
//    decodifica. Mesma conversão que o OCR já usava.
// Se os dois falharem, sobe o original — melhor guardar a foto do que perdê-la.

/** Maior lado do avatar. Ele é exibido com 62px; 1024 já é folga larga. */
const LADO_MAXIMO = 1024
const QUALIDADE_JPEG = 0.9

function comNomeJpeg(blob: Blob): File {
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
}

async function viaNavegador(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const lo = Math.max(bitmap.width, bitmap.height)
    const escala = lo > LADO_MAXIMO ? LADO_MAXIMO / lo : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * escala)
    canvas.height = Math.round(bitmap.height * escala)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>(ok =>
      canvas.toBlob(ok, 'image/jpeg', QUALIDADE_JPEG))
    return blob ? comNomeJpeg(blob) : null
  } catch {
    return null   // HEIC fora do Safari cai aqui — segue para o servidor.
  }
}

async function viaServidor(file: File): Promise<File | null> {
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/images/jpeg', { method: 'POST', body: fd })
    if (!res.ok) return null
    return comNomeJpeg(await res.blob())
  } catch {
    return null
  }
}

/**
 * Devolve a foto pronta para o bucket e a extensão a usar no caminho.
 *
 * A extensão acompanha o arquivo de verdade: gravar `.heic` num conteúdo já
 * convertido faria o navegador recusar de novo, pelo mesmo motivo.
 */
export async function prepararFotoAvatar(file: File): Promise<{ arquivo: File; ext: string }> {
  const convertido = await viaNavegador(file) ?? await viaServidor(file)
  if (convertido) return { arquivo: convertido, ext: 'jpg' }

  // Formato que o navegador não desenha e a conversão não resgatou: subir
  // assim mesmo reproduz o defeito original — arquivo salvo, avatar quebrado,
  // nenhum aviso. Melhor recusar e dizer o que fazer.
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  if (['heic', 'heif'].includes(ext) || /heic|heif/.test(file.type)) {
    throw new Error('Não consegui converter essa foto do iPhone. Tente de novo, ou escolha uma foto em JPG.')
  }

  console.warn('[avatar] conversão para JPEG falhou; subindo o arquivo original')
  return { arquivo: file, ext }
}
