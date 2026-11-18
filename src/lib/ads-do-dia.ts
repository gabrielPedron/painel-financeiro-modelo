// O ADS de um dia só é trocado quando a API trouxe o dia inteiro (sync-05): resposta vazia ou
// paginação interrompida no meio não podem apagar linhas boas.
export function adsDoDiaCompleto(linhasGravadas: number, recebidos: number, totalDaApi: number): boolean {
  return linhasGravadas > 0 && recebidos >= totalDaApi;
}
