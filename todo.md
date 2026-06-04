# Commercial Planner Agent - TODO

## Banco de Dados
- [x] Criar tabela de propostas (proposals) com campos: id, userId, clientName, clientCompany, clientContact, projectScope, values, deadline, commercialTerms, proposalContent, status, createdAt, updatedAt
- [x] Criar índices para melhor performance nas queries
- [x] Executar migration SQL no banco de dados

## Interface e Design
- [x] Configurar paleta de cores sofisticada (elegância premium)
- [x] Implementar tipografia refinada com Google Fonts
- [x] Criar componentes UI customizados com Tailwind 4
- [x] Desenvolver layout principal com navegação elegante
- [x] Criar formulário de proposta com validação
- [x] Implementar visualizador de proposta com markdown renderizado

## Funcionalidades Core
- [x] Implementar procedimento tRPC para criar proposta
- [x] Implementar procedimento tRPC para listar propostas do usuário
- [x] Implementar procedimento tRPC para obter detalhes de proposta
- [x] Implementar procedimento tRPC para atualizar proposta
- [x] Implementar procedimento tRPC para deletar proposta
- [x] Integrar invokeLLM para geração de proposta com IA

## Geração de Propostas
- [x] Criar prompt system refinado para IA gerar propostas profissionais
- [x] Implementar lógica de geração com tratamento de erros
- [x] Adicionar loading states e feedback visual durante geração

## Histórico e Gerenciamento
- [x] Criar página de histórico de propostas
- [ ] Implementar listagem com filtros e busca
- [x] Adicionar funcionalidade de reedição de propostas
- [ ] Implementar soft delete ou status de arquivo

## Exportação
- [x] Implementar exportação em PDF com download funcional
- [x] Implementar exportação em texto formatado
- [x] Adicionar botões de download na interface

## Testes
- [x] Escrever testes vitest para procedimentos tRPC
- [x] Testar fluxo completo de criação de proposta
- [x] Validar geração de IA com diferentes inputs
- [x] Testar exportação em PDF

## Deploy e Publicação
- [x] Criar checkpoint final
- [ ] Publicar aplicação
