// Depois de gravar um período do faturamento, o worker compara o total da API com o banco.
// Abaixo da API: confere de novo até 3 vezes; depois disso termina "incompleto", com a diferença
// (sync-06: antes virava "concluido" e a nota sumia).
export type Conferencia =
  | { acao: "reconferir"; nota: string }
  | { acao: "incompleto"; nota: string }
  | { acao: "concluido" };

export function conferirFaturamento(apiTotal: number, banco: number, conferencias: number): Conferencia {
  if (!(apiTotal > 0 && banco < apiTotal)) return { acao: "concluido" };
  if (conferencias < 3) {
    return { acao: "reconferir", nota: `Verificação ${conferencias + 1}/3: API=${apiTotal}, banco=${banco}` };
  }
  return {
    acao: "incompleto",
    nota: `Incompleto depois de 3 conferências: API=${apiTotal}, banco=${banco} (faltam ${apiTotal - banco})`,
  };
}
