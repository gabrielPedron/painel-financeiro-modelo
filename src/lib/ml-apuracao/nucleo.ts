// Ponte para o núcleo de apuração.
//
// É o ÚNICO arquivo que muda quando o adaptador é copiado para um projeto:
// aqui dentro do skill o núcleo fica em `../../nucleo`, num projeto ele
// costuma ficar ao lado, em `../apuracao`. Existe para a mudança de lugar ser
// uma linha conhecida, e não uma caça a imports espalhados.
//
// Ao instalar num projeto, ajuste as duas linhas abaixo (o skill `must-have`
// traz o comando pronto).

export {
  auditar,
  buscarPorTermo,
  buscarPorValor,
  catalogar,
  coletar,
  resumirAuditoria,
} from "../apuracao/index.ts";

export type { Auditoria, Catalogo, FalhaColeta, ResultadoBusca } from "../apuracao/tipos.ts";
