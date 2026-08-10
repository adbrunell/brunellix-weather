---
name: supabase-expert
description: Habilidade especializada de alta performance e segurança máxima para Supabase, servidor MCP, PostgREST API, RLS (Row Level Security) otimizado, migrations PostgreSQL e autenticação. Use sempre que criar/modificar schemas, escrever policies de RLS, criar funções/RPCs, fazer chamadas REST via _api() ou ajustar variáveis de ambiente.
---

# SKILL: SUPABASE & POSTGRESQL ARCHITECTURE (MAX SECURITY & LOW RESOURCE)

Esta habilidade estabelece os padrões mais rigorosos da indústria para desenvolvimento no Supabase, garantindo vazamento zero de dados, execução de RLS em tempo sub-milissegundo e consumo mínimo de CPU/RAM do banco de dados.

---

## 1. SEGURANÇA E VARIÁVEIS DE AMBIENTE

- **Variáveis de Ambiente:** Utilize estritamente SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_KEY vindos do ambiente de execução.
- **Proibição de Hardcode:** NUNCA insira chaves, tokens ou URLs diretamente no código fonte.
- **Isolation da Service Key:** A SUPABASE_SERVICE_KEY ignora o RLS e possui privilégios totais. Use-a **exclusivamente em scripts de backend isolados e server-side**, jamais no frontend.
- **Funções Seguras (Search Path Fix):** Toda função/trigger em PL/pgSQL DEVE incluir SET search_path = '' e declarar SECURITY DEFINER ou INVOKER explicitamente para evitar sequestro de schema.

---

## 2. CONSUMO DE DADOS NO FRONTEND (POSTGREST EXCLUSIVO)

### A. Papel do SDK @supabase/supabase-js
- O SDK JS é restrito **exclusivamente a fluxos de Autenticação** (signInWithPassword, signUp, resetPasswordForEmail, getSession, onAuthStateChange).
- **PROIBIDO** utilizar .from('tabela') do SDK JS para consultas de dados.

### B. Requisições REST via Helper _api()
- Todas as operações de banco no frontend DEVEM ser feitas via fetch() direto para /rest/v1/ usando o helper _api().
- O helper injeta o header apikey: SUPABASE_ANON_KEY e o header Authorization: Bearer <JWT_DO_USUARIO>.

const dados = await _api('/rest/v1/sua_tabela?select=id,nome&limit=20', {
  method: 'GET'
})

---

## 3. ROW LEVEL SECURITY (RLS) DE ALTA PERFORMANCE

Toda e qualquer tabela acessível via API pública DEVE ter RLS ativado.

### A. Comando de Habilitação Obrigatório
ALTER TABLE public.nome_da_tabela ENABLE ROW LEVEL SECURITY;

### B. A Regra de Ouro da Performance no RLS: (SELECT auth.uid())
NUNCA compare direto user_id = auth.uid(). Isso força o Postgres a reavaliar a função para cada linha examinada. **SEMPRE envolva em um sub-select** user_id = (SELECT auth.uid()) para permitir que o planejador de query faça o cache do ID.

-- ERRADO (Lento: executa auth.uid() em cada linha da tabela)
CREATE POLICY "Leitura lenta" ON public.pedidos FOR SELECT USING (user_id = auth.uid());

-- CERTO (Ultra-rápido: avalia auth.uid() apenas 1 vez por query)
CREATE POLICY "Leitura otimizada" ON public.pedidos FOR SELECT USING (user_id = (SELECT auth.uid()));

### C. Granularidade por Operação e Role
- NUNCA crie uma política única para ALL. Separe em políticas explícitas para SELECT, INSERT, UPDATE e DELETE.
- Especifique a role alvo com TO authenticated ou TO anon.

---

## 4. OTIMIZAÇÃO DE BANCO DE DADOS & RECURSOS (ZERO SLOWDOWN)

### A. Índices Obrigatórios em Foreign Keys e RLS
- Toda coluna utilizada em cláusula USING de RLS ou em Foreign Key **DEVE possuir um índice B-Tree criado**. Sem o índice, o RLS causa Seq Scan e derruba a CPU do Supabase.

CREATE INDEX IF NOT EXISTS idx_pedidos_user_id ON public.pedidos(user_id);

### B. RPCs (Stored Procedures) para Consultas Pesadas
- Se uma página precisar juntar 3 ou mais tabelas, não faça um PostgREST query gigante no frontend com múltiplos select=...,tabela2(...).
- Crie uma função SQL anotada como STABLE ou IMMUTABLE e chame via POST /rest/v1/rpc/nome_da_funcao. Funções STABLE permitem que o Postgres otimize o plano de execução e faça cache.

### C. Desativação do Header Prefer: count=exact
- NUNCA envie o header Prefer: count=exact em tabelas com mais de 10.000 linhas a menos que estritamente necessário. O count(*) força o Postgres a percorrer o disco inteiro.

---

## 5. USO DO MCP DO SUPABASE & MIGRATIONS

1. **Inspecção de Schema via MCP:** Antes de criar novas tabelas ou relacionamentos, use o MCP para verificar restrições existentes e índices ausentes (get_advisors).
2. **Migrations Idempotentes:** Escreva DDLs com tratamentos defensivos (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS).
3. **Nomenclatura Padrão:** Use estritamente snake_case em tabelas, colunas, enums, triggers e funções.

---

## 6. CHECKLIST RIGOROSO DE SEGURANÇA E PERFORMANCE

Antes de finalizar qualquer entrega de banco de dados:
- [ ] O RLS foi ativado com ALTER TABLE ... ENABLE ROW LEVEL SECURITY;?
- [ ] Todas as chamadas de auth.uid() nas políticas de RLS estão no formato (SELECT auth.uid())?
- [ ] As Foreign Keys e colunas filtradas pelo RLS possuem índices CREATE INDEX IF NOT EXISTS?
- [ ] O SDK do Supabase está sendo usado APENAS para autenticação no frontend?
- [ ] As funções SQL customizadas possuem SET search_path = '' para evitar hijacking?
- [ ] Não há nenhuma chamada usando SELECT * ou select=*?