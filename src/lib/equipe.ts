// Quem é a equipe de quem está logado e o que essa pessoa pode fazer no servidor.
// Usa o cliente do próprio usuário (RLS e auth.uid() valem), nunca a chave de administrador.
// Só importa tipos: serve no navegador e no servidor.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

/** Dono da equipe de quem está logado. team_owner() devolve o próprio id de quem não é membro. */
export async function donoDaEquipe(supabase: Db): Promise<string> {
  const { data, error } = await supabase.rpc("team_owner");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sessão inválida");
  return data;
}

/** Administrador ("*") ou quem tem alguma das telas/abas, com as chaves do menu (my_screens). */
export function podeUsar(telas: string[], chaves: string | string[]): boolean {
  return telas.includes("*") || [chaves].flat().some((c) => telas.includes(c));
}

async function minhasTelas(supabase: Db): Promise<string[]> {
  const { data, error } = await supabase.rpc("my_screens");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.screen_key);
}

/** Para a ação do servidor com "Sem permissão." se a pessoa não tem a tela/aba (seg-05). */
export async function exigirTela(supabase: Db, chaves: string | string[]): Promise<void> {
  if (!podeUsar(await minhasTelas(supabase), chaves)) throw new Error("Sem permissão.");
}

/** Só o administrador: conectar, desconectar e cadastrar a integração do ML (ticket 08). */
export async function exigirAdmin(supabase: Db): Promise<void> {
  if (!(await minhasTelas(supabase)).includes("*")) throw new Error("Sem permissão.");
}
