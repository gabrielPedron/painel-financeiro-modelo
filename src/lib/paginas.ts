// O Supabase corta qualquer resposta em 1.000 linhas, sem avisar (din-12). Para ler
// tudo, pede de 1.000 em 1.000 até vir uma página incompleta. Quem chama tem de
// ordenar por uma chave que não se repete, senão uma linha pode cair entre páginas.
// ponytail: tem de ser igual ao "Max rows" do Supabase (hoje 1.000). Se o painel baixar o teto,
// a primeira página vem menor que isto e a leitura para cedo; aí pedir a contagem exata.
export const TETO_DA_API = 1000;

type Pagina<T> = { data: T[] | null; error: { message: string } | null };

export async function todasAsPaginas<T>(
  buscar: (de: number, ate: number) => PromiseLike<Pagina<T>>,
): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += TETO_DA_API) {
    const { data, error } = await buscar(de, de + TETO_DA_API - 1);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if ((data ?? []).length < TETO_DA_API) return linhas;
  }
}
