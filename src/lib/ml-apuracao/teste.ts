// Testes do adaptador do Mercado Livre — sem framework e sem rede.
// Roda com:  bun run teste.ts
//
// A rede é injetada (`buscador`), então dá para reproduzir divergência, falha
// intermitente e token recusado sem depender do ML estar no ar nem de token.

import {
  apurarRecursoMl,
  conferirGlossario,
  descobrirConta,
  mascarar,
  mascararCaminho,
  validarCaminhoMl,
  type Buscador,
} from "./apurador.ts";
import { formatarRelatorio, lerArgumentos, normalizarCaminho } from "./cli.ts";
import { catalogar } from "./nucleo.ts";

let falhas = 0;
function conferir(nome: string, condicao: boolean, extra?: unknown) {
  if (condicao) console.log(`  ok  ${nome}`);
  else {
    falhas++;
    console.log(`  FALHOU  ${nome}`, extra ?? "");
  }
}
function esperaErro(nome: string, fn: () => unknown, trecho?: string) {
  try {
    fn();
    falhas++;
    console.log(`  FALHOU  ${nome} — não lançou erro`);
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    if (trecho && !msg.toLowerCase().includes(trecho.toLowerCase())) {
      falhas++;
      console.log(`  FALHOU  ${nome} — mensagem inesperada: ${msg}`);
    } else console.log(`  ok  ${nome}`);
  }
}

console.log("\n=== 1. trava de segurança do caminho ===");
conferir("caminho normal passa", validarCaminhoMl("/users/me") === "/users/me");
conferir(
  "{conta} é trocado pelo id",
  validarCaminhoMl("/users/{conta}/items/search", 1234567) ===
    "/users/1234567/items/search",
);
conferir(
  "query string preservada",
  validarCaminhoMl("/orders/search?seller={conta}&limit=5", 7) ===
    "/orders/search?seller=7&limit=5",
);
esperaErro("bloqueia //outro-servidor.com", () => validarCaminhoMl("//evil.com/roubo"), "duas barras");
esperaErro("bloqueia URL absoluta http", () => validarCaminhoMl("http://evil.com/x"), "barra");
esperaErro("bloqueia URL absoluta https", () => validarCaminhoMl("https://evil.com/x"), "barra");
esperaErro("bloqueia caminho sem barra", () => validarCaminhoMl("users/me"), "barra");
esperaErro("bloqueia espaço no caminho", () => validarCaminhoMl("/users/ me"), "caracteres");
esperaErro("bloqueia caminho gigante", () => validarCaminhoMl("/" + "a".repeat(700)), "longo");
conferir(
  "traversal não escapa do host",
  validarCaminhoMl("/users/../../etc/passwd").startsWith("/"),
);

console.log("\n=== 2. apuração com divergência (23, 21, 23) ===");
function buscadorFixo(corpos: unknown[]): Buscador {
  let i = 0;
  return async () => ({ ok: true, status: 200, corpo: corpos[i++ % corpos.length] });
}
const resposta = (total: number) => ({
  paging: { total },
  seller_reputation: {
    level_id: "5_green",
    power_seller_status: "platinum",
    metrics: { claims: { rate: 0.012, value: 3 } },
  },
});

const r1 = await apurarRecursoMl(
  { token: "falso", caminho: "/users/{conta}", contaId: 1, repeticoes: 3, intervaloMs: 0 },
  { buscador: buscadorFixo([resposta(23), resposta(21), resposta(23)]) },
);
const totalAuditado = r1.auditoria.campos.find((c) => c.caminho === "paging.total")!;
conferir("moda elege 23", totalAuditado.valor === 23, totalAuditado);
conferir("confiança = maioria", totalAuditado.confianca === "maioria");
conferir("guarda a variante 21", totalAuditado.variantes.some((v) => v.valor === 21));
conferir("só paging.total ficou instável", r1.auditoria.instaveis.length === 1);
conferir("3 status 200 registrados", r1.statusPorTentativa.join(",") === "200,200,200");
conferir("não marca respostas idênticas", r1.respostasIdenticas === false);

console.log("\n=== 3. respostas idênticas viram ressalva ===");
const r2 = await apurarRecursoMl(
  { token: "falso", caminho: "/users/me", repeticoes: 3, intervaloMs: 0 },
  { buscador: buscadorFixo([resposta(23)]) },
);
conferir("marca respostasIdenticas", r2.respostasIdenticas === true);
conferir("relatório traz a ressalva", formatarRelatorio(r2).includes("RESSALVA"));

console.log("\n=== 4. falha intermitente não derruba a apuração ===");
let n = 0;
const buscadorInstavel: Buscador = async () => {
  n++;
  if (n === 2) return { ok: false, status: 500, corpo: { message: "erro interno" } };
  return { ok: true, status: 200, corpo: resposta(23) };
};
const r3 = await apurarRecursoMl(
  { token: "falso", caminho: "/users/me", repeticoes: 3, intervaloMs: 0 },
  { buscador: buscadorInstavel },
);
conferir("2 coletas válidas", r3.coletasValidas === 2);
conferir("1 falha registrada com o status", r3.falhas.length === 1 && r3.falhas[0].erro.includes("500"));
conferir("status 500 aparece na lista", r3.statusPorTentativa.includes(500));

console.log("\n=== 5. tudo falhando devolve relatório, não exceção ===");
const r4 = await apurarRecursoMl(
  { token: "falso", caminho: "/users/me", repeticoes: 2, intervaloMs: 0 },
  { buscador: async () => ({ ok: false, status: 401, corpo: { message: "invalid token" } }) },
);
conferir("zero coletas válidas", r4.coletasValidas === 0);
conferir("as 2 falhas ficaram registradas", r4.falhas.length === 2);
conferir("relatório diz que não há o que apurar", formatarRelatorio(r4).includes("Nenhuma coleta válida"));

console.log("\n=== 6. busca por termo e por valor ===");
const r5 = await apurarRecursoMl(
  {
    token: "falso",
    caminho: "/users/me",
    repeticoes: 1,
    intervaloMs: 0,
    termo: "reclamações",
    valor: "23",
  },
  { buscador: buscadorFixo([resposta(23)]) },
);
conferir(
  "'reclamações' acha claims",
  !!r5.achadosPorTermo?.[0]?.campo.caminho.includes("claims"),
  r5.achadosPorTermo?.map((a) => a.campo.caminho),
);
conferir("valor 23 acha paging.total", r5.achadosPorValor?.[0]?.campo.caminho === "paging.total");
conferir("glossário responde ao termo", r5.glossario.length > 0);

console.log("\n=== 7. conferência do glossário contra a resposta real ===");
const catalogo = catalogar([resposta(23)]);
const conferencia = conferirGlossario(catalogo, "/users/1234567");
const medalha = conferencia.find((c) => c.campo === "seller_reputation.level_id")!;
const atraso = conferencia.find((c) => c.campo === "seller_reputation.metrics.delayed_handling_time.rate")!;
conferir("acha o level_id que existe", medalha?.existeNaResposta === true);
conferir("level_id traz o valor", medalha?.valor === "5_green");
conferir("marca como ausente o campo que não veio", atraso?.existeNaResposta === false);
conferir(
  "só confere termos do recurso apurado",
  conferencia.every((c) => c.campo.startsWith("seller_reputation")),
  conferencia.map((c) => c.campo),
);
conferir("relatório mostra o que pode virar confirmado", formatarRelatorio(r5).includes("GLOSSÁRIO"));

console.log("\n=== 8. descobrirConta ===");
const conta = await descobrirConta("falso", {
  buscador: async () => ({ ok: true, status: 200, corpo: { id: 1234567, nickname: "LOJA" } }),
});
conferir("devolve id e apelido", conta.id === 1234567 && conta.nickname === "LOJA");
for (const status of [401, 403]) {
  try {
    await descobrirConta("ruim", {
      buscador: async () => ({ ok: false, status, corpo: null }),
    });
    falhas++;
    console.log(`  FALHOU  ${status} deveria lançar`);
  } catch (erro) {
    // O ML devolve 403 para token malformado, não 401 — visto chamando a API real.
    conferir(`${status} explica que o token expira`, String(erro).includes("6 horas"));
  }
}

console.log("\n=== 8b. mascaramento ===");
// Cada linha aqui é um vazamento que ACONTECEU numa conta real, virado em
// regressão. Os valores são sintéticos de propósito: congelar o valor que vazou
// resolve o teste e cria o vazamento seguinte, agora dentro do próprio skill.
conferir("CNPJ do dono nao sai", mascarar("company.corporate_name", "EMPRESA EXEMPLO").startsWith("«"));
conferir("apelido do CLIENTE nao sai", mascarar("results[].buyer.nickname", "COMPRADOR").startsWith("«"));
conferir("endereco nao sai", mascarar("seller_address.city.name", "CIDADE").startsWith("«"));
conferir("codigo do ML passa inteiro", mascarar("seller_reputation.level_id", "5_green") === "5_green");
conferir("contador passa inteiro", mascarar("paging.total", 42) === "42");
conferir("id de pessoa some do caminho", mascararCaminho("players[user_id=7].role") === "players[user_id=…].role");
conferir("id de registro permanece", mascararCaminho("data[id=99].status") === "data[id=99].status");
conferir("texto livre longo e cortado", mascarar("observacao", "z".repeat(80)).startsWith("«"));
// Id de pessoa vem como NÚMERO e o early-return por tipo deixava passar.
conferir("id NUMERICO de comprador nao sai", mascarar("results[].buyer.id", 7) === "«id»");
conferir("user_id NUMERICO de terceiro nao sai", mascarar("data[].players[].user_id", 7) === "«id»");
conferir("id de RECLAMACAO passa inteiro", mascarar("data[].id", 99) === "99");

console.log("\n=== 9. argumentos do CLI ===");
const a1 = lerArgumentos(["/users/{conta}", "--termo", "reputação", "-n", "5"]);
conferir("lê caminho, termo e coletas", a1.caminho === "/users/{conta}" && a1.termo === "reputação" && a1.coletas === 5);
const a2 = lerArgumentos(["--recursos"]);
conferir("--recursos sem caminho", a2.listarRecursos && a2.caminho === null);
const a3 = lerArgumentos(["/x", "--valor", "23", "--json"]);
conferir("lê valor e json", a3.valor === "23" && a3.json === true);
conferir(
  "desfaz a conversão de caminho do Git Bash",
  normalizarCaminho("C:/Program Files/Git/users/me") === "/users/me",
  normalizarCaminho("C:/Program Files/Git/users/me"),
);
conferir("caminho normal passa intacto", normalizarCaminho("/users/{conta}") === "/users/{conta}");

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM\n" : `\n${falhas} TESTE(S) FALHARAM\n`);
process.exit(falhas === 0 ? 0 : 1);
