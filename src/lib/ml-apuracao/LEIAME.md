# Adaptador do Mercado Livre

Portátil: não conhece Supabase, TanStack, React nem banco nenhum. Precisa só de um access
token válido. Quem guarda o token é o projeto — aqui ele chega pronto.

## Arquivos

| Arquivo | O que é |
|---|---|
| `glossario.ts` | 20 termos nossos × campo da API, com `confirmado`; sinônimos do ML; 10 atalhos de recurso |
| `apurador.ts` | trava de host, coleta autenticada, catálogo, auditoria, conferência do glossário |
| `cli.ts` | roda sozinho, sem projeto e sem instalar nada |
| `nucleo.ts` | **ponte para o núcleo — o único arquivo a ajustar ao mudar de lugar** |
| `teste.ts` | a rede é injetada, então não precisa de token nem do ML no ar |

## Instalar num projeto

```bash
ADAPT=src/lib/ml-apuracao       # o núcleo, neste exemplo, está em src/lib/apuracao
cp -r ~/.claude/skills/apuracao-de-api/adaptadores/mercado-livre "$ADAPT"
sed -i 's#"../../nucleo/index"#"../apuracao/index"#; s#"../../nucleo/tipos"#"../apuracao/tipos"#' "$ADAPT/nucleo.ts"
bun run "$ADAPT/teste.ts"
```

O `sed` é obrigatório: dentro do skill o núcleo fica em `../../nucleo`, num projeto ele fica
ao lado. Sem isso o primeiro import falha com `Cannot find module`.

## Usar

```bash
bun run cli.ts "/users/{conta}"                          # conta, reputação, métricas
bun run cli.ts "/users/{conta}" --termo reputação        # onde está isso?
bun run cli.ts "/orders/search?seller={conta}&limit=5" --valor 23 -n 5
bun run cli.ts --recursos                                # atalhos conhecidos
bun run cli.ts --glossario estoque                       # sem gastar chamada
```

**Token:** `ML_ACCESS_TOKEN` no ambiente, no `.env.local` ou no `.env` do diretório atual
(o Bun carrega esses arquivos sozinho). Também aceita `MERCADOLIVRE_ACCESS_TOKEN` e
`ML_TOKEN`. Vale ~6 horas.

O `{conta}` é resolvido sozinho por `/users/me` — não precisa informar o id.

## Coisas verificadas na prática, não na documentação

- **O ML devolve 403 para token malformado**, não 401. Confirmado chamando a API de verdade.
  As duas mensagens dizem a mesma coisa, mas quem procurar só por 401 se perde.
- **O Git Bash no Windows** converte um argumento que começa com barra em caminho do sistema
  (`/users/me` vira `C:/Program Files/Git/users/me`), mas só quando não há `?` no argumento —
  o mesmo comando funciona ou falha dependendo da query string. O CLI desfaz isso em
  `normalizarCaminho`.
- **A trava de host não é enfeite.** O caminho vem digitado e a chamada sai com o token do
  vendedor. `validarCaminhoMl` monta a URL de verdade e confere o hostname no fim — comparar
  prefixo de string deixa passar `//outro-servidor.com`.

## O ciclo do glossário

O relatório marca cada termo:

| Marca | Significa | O que fazer |
|---|---|---|
| (espaço) | já era `confirmado: true` e continua existindo | nada |
| `+` | existe na resposta, mas está `false` no código | virar para `true` |
| `!` | está no glossário e não existe na resposta | corrigir o caminho ou remover |

**`confirmado: true` só depois de o campo ter aparecido numa apuração contra conta real.**
Documentação e memória não confirmam nada. Ao corrigir, corrija também a cópia do skill,
senão o próximo projeto nasce com o glossário velho.
