import { createFileRoute } from "@tanstack/react-router";
import { SENHA_MINIMA } from "@/lib/senha";

type Body = {
  action?: string;
  access_token?: string;
  email?: string;
  password?: string;
  display_name?: string;
  member_id?: string;
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as Body;
          const token = body.access_token;
          if (!token) return json({ ok: false, error: "Sessão inválida." }, 401);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
          const uid = userData?.user?.id;
          if (userErr || !uid) return json({ ok: false, error: "Sessão inválida." }, 401);

          // Administrador: o dono da equipe ou um membro marcado como administrador.
          const { data: adminRow } = await supabaseAdmin
            .from("account_members")
            .select("root_owner_id, administrador")
            .eq("member_id", uid)
            .maybeSingle();
          if (!adminRow || (adminRow.root_owner_id !== uid && !adminRow.administrador)) {
            return json({ ok: false, error: "Acesso restrito ao administrador." }, 403);
          }
          const dono = adminRow.root_owner_id;

          const action = body.action;

          if (action === "create_user") {
            const email = (body.email || "").trim().toLowerCase();
            const password = body.password || "";
            const displayName = (body.display_name || "").trim();
            if (!email || password.length < SENHA_MINIMA || !displayName) {
              return json({ ok: false, error: `Preencha nome, email e uma senha de ao menos ${SENHA_MINIMA} caracteres.` }, 400);
            }
            const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
              email,
              password,
              email_confirm: true,
            });
            if (createErr || !created?.user) {
              const msg = (createErr?.message || "").toLowerCase();
              if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
                return json({ ok: false, error: "Já existe um usuário com esse email." }, 400);
              }
              return json({ ok: false, error: "Não foi possível criar o usuário." }, 400);
            }
            const newId = created.user.id;
            const { error: memberErr } = await supabaseAdmin
              .from("account_members")
              .insert({ root_owner_id: dono, member_id: newId, display_name: displayName });
            if (memberErr) {
              await supabaseAdmin.auth.admin.deleteUser(newId);
              return json({ ok: false, error: "Não foi possível vincular o usuário à equipe." }, 400);
            }
            return json({ ok: true, user_id: newId });
          }

          if (action === "update_password" || action === "delete_user") {
            const memberId = body.member_id;
            if (!memberId) return json({ ok: false, error: "Usuário não informado." }, 400);
            if (memberId === uid) return json({ ok: false, error: "Operação não permitida no próprio administrador." }, 400);
            if (memberId === dono) return json({ ok: false, error: "Operação não permitida no dono da equipe." }, 400);

            const { data: member } = await supabaseAdmin
              .from("account_members")
              .select("member_id, administrador")
              .eq("member_id", memberId)
              .eq("root_owner_id", dono)
              .maybeSingle();
            if (!member) return json({ ok: false, error: "Usuário não encontrado na equipe." }, 404);
            // Um administrador não troca a senha nem exclui outro; só o dono da equipe.
            if (member.administrador && uid !== dono) {
              return json({ ok: false, error: "Só o dono da equipe altera outro administrador." }, 403);
            }

            if (action === "update_password") {
              const password = body.password || "";
              if (password.length < SENHA_MINIMA) return json({ ok: false, error: `A senha precisa ter ao menos ${SENHA_MINIMA} caracteres.` }, 400);
              const { error } = await supabaseAdmin.auth.admin.updateUserById(memberId, { password });
              if (error) {
                console.error("[update_password]", error);
                return json({ ok: false, error: error.message || "Não foi possível alterar a senha." }, 400);
              }
              return json({ ok: true });
            }

            await supabaseAdmin.from("user_screen_access").delete().eq("member_id", memberId);
            await supabaseAdmin.from("account_members").delete().eq("member_id", memberId);
            const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(memberId);
            if (delErr) return json({ ok: false, error: "Não foi possível excluir o usuário." }, 400);
            return json({ ok: true });
          }

          return json({ ok: false, error: "Ação desconhecida." }, 400);
        } catch (e) {
          console.error("[api/admin/users]", e);
          return json({ ok: false, error: "Erro interno." }, 500);
        }
      },
    },
  },
});
