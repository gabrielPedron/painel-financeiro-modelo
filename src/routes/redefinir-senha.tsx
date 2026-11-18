import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import logoPadrao from "@/assets/logo.svg";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { SENHA_MINIMA } from "@/lib/senha";

export const Route = createFileRoute("/redefinir-senha")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Definir nova senha — Painel Financeiro" },
      { name: "description", content: "Defina uma nova senha de acesso ao Painel Financeiro." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RedefinirSenhaPage,
});

function RedefinirSenhaPage() {
  const navigate = useNavigate();
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [invalido, setInvalido] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (senha.length < SENHA_MINIMA) {
      toast.error(`A senha precisa ter ao menos ${SENHA_MINIMA} caracteres.`);
      return;
    }
    if (senha !== confirma) {
      toast.error("As senhas não conferem.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setLoading(false);
    if (error) {
      console.error("[redefinir-senha]", error);
      setInvalido(true);
      return;
    }
    toast.success("Senha alterada. Você já pode entrar.");
    navigate({ to: "/login", replace: true });
  };

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <img src={logoPadrao} alt="Painel Financeiro" className="h-14 w-auto object-contain" />
          <div className="text-center">
            <div className="text-lg font-semibold leading-tight">Painel Financeiro</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Controle financeiro para e-commerce</div>
          </div>
        </div>
        <Card className="border-border/60 bg-card/60 backdrop-blur">
          <CardContent className="p-6">
            <h1 className="text-lg font-semibold text-primary">Definir nova senha</h1>
            {invalido ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-muted-foreground">O link expirou ou é inválido. Solicite um novo.</p>
                <Link to="/recuperar-senha" className="text-xs text-primary hover:underline">
                  Solicitar novo link
                </Link>
              </div>
            ) : (
              <>
                {!ready ? (
                  <p className="mt-1 text-xs text-muted-foreground">Validando o link do email...</p>
                ) : null}
                <form onSubmit={onSubmit} className="mt-5 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="senha">Nova senha</Label>
                    <Input id="senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="new-password" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirma">Confirmar nova senha</Label>
                    <Input id="confirma" type="password" value={confirma} onChange={(e) => setConfirma(e.target.value)} required autoComplete="new-password" />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Salvando..." : "Salvar nova senha"}
                  </Button>
                </form>
                <div className="mt-4 text-center">
                  <Link to="/login" className="text-xs text-muted-foreground hover:text-primary">
                    Voltar para o login
                  </Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}