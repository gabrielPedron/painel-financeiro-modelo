export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TOO_LARGE_MESSAGE = "Imagem acima de 5 MB. Escolha um arquivo menor.";

export function imageFileTooLarge(file: Pick<File, "size">): boolean {
  return file.size > MAX_IMAGE_BYTES;
}

/** Confere o tamanho decodificado, sem alocar um segundo buffer da imagem. */
export function imageBase64TooLarge(value: string): boolean {
  const payload = value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const byteLength = Math.floor(payload.length / 4) * 3 - padding;
  return byteLength > MAX_IMAGE_BYTES;
}
