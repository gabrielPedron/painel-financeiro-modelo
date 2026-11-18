import { createFileRoute, useNavigate, redirect, Link } from "@tanstack/react-router";
import { useState } from "react";
import logoPadrao from "@/assets/logo.svg";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/login")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Entrar — Painel Financeiro" },
      { name: "description", content: "Acesse o painel financeiro Painel Financeiro." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      console.error("[login] signInWithPassword error", error);
      const errAny = error as unknown as { code?: string; message?: string; status?: number };
      const isInvalidCredentials =
        errAny.code === "invalid_credentials" ||
        (errAny.message ?? "").includes("Invalid login credentials");
      if (isInvalidCredentials) {
        setError("E-mail ou senha inválidos.");
      } else {
        setError(`${errAny.message ?? "Erro desconhecido"}${errAny.status ? ` (${errAny.status})` : ""}`);
      }
      return;
    }
    navigate({ to: "/", replace: true });
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
            <h1 className="text-lg font-semibold text-primary">Entrar</h1>
            <p className="mt-1 text-xs text-muted-foreground">Acesso restrito ao proprietário do sistema.</p>
            <form onSubmit={onSubmit} className="mt-5 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              </div>
              {error ? <div className="text-xs text-red-700">{error}</div> : null}
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Entrando..." : "Entrar"}
              </Button>
            </form>
            <div className="mt-3 text-center">
              <Link to="/recuperar-senha" className="text-xs text-muted-foreground hover:text-primary">
                Esqueci minha senha
              </Link>
            </div>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">Cadastro público desabilitado nesta fase.</p>
      </div>
    </main>
  );
}