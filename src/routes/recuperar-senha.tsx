import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useState } from "react";
import logoPadrao from "@/assets/logo.svg";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/recuperar-senha")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Recuperar senha — Painel Financeiro" },
      { name: "description", content: "Solicite um link para redefinir sua senha no Painel Financeiro." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RecuperarSenhaPage,
});

function RecuperarSenhaPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setLoading(false);
    if (error) {
      console.error("[recuperar-senha]", error);
      toast.error("Não foi possível enviar o link agora. Tente novamente em alguns minutos.");
      return;
    }
    setSent(true);
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
            <h1 className="text-lg font-semibold text-primary">Recuperar senha</h1>
            <p className="mt-1 text-xs text-muted-foreground">Enviaremos um link de redefinição para o seu email.</p>
            {sent ? (
              <p className="mt-5 text-sm text-muted-foreground">
                Se este email estiver cadastrado, enviamos um link de redefinição. Verifique sua caixa de entrada e o spam.
              </p>
            ) : (
              <form onSubmit={onSubmit} className="mt-5 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email">E-mail</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                </div>
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? "Enviando..." : "Enviar link"}
                </Button>
              </form>
            )}
            <div className="mt-4 text-center">
              <Link to="/login" className="text-xs text-muted-foreground hover:text-primary">
                Voltar para o login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}