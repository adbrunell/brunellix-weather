---
name: seo-and-performance
description: Diretrizes universais de SEO técnico, Core Web Vitals, HTML semântico, Schema JSON-LD, geração estática (SSG/Prerender) e otimização de consultas/cache REST/GraphQL/PostgREST. Use sempre que criar/modificar arquivos HTML, componentes de UI, scripts de geração de páginas, meta tags ou integrações de dados no frontend.
---

# SKILL: SEO TÉCNICO, PERFORMANCE & OTIMIZAÇÃO DE DADOS FRONTEND

Esta habilidade estabelece as regras obrigatórias de arquitetura frontend, indexabilidade (Google Search Central), acessibilidade e eficiência na busca de dados.

---

## 1. META TAGS E HEADERS (MANDATÓRIO EM TODAS AS PÁGINAS)

Ao criar ou editar qualquer página HTML ou componente de layout, garanta a presença exata deste bloco base no `<head>`:

<title>Palavra-Chave Principal — Nome do Produto | Marca</title>
<meta name="description" content="Descrição única, persuasiva e com palavra-chave natural (150-160 caracteres).">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://DOMINIO_OFICIAL/CAMINHO_DA_PAGINA">

<!-- Open Graph (Redes Sociais) -->
<meta property="og:title" content="Título atraente (máx 60 chars) | Marca">
<meta property="og:description" content="Mesma meta description ou versão sintetizada.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://DOMINIO_OFICIAL/CAMINHO_DA_PAGINA">
<meta property="og:image" content="https://DOMINIO_OFICIAL/assets/og-image.png">
<meta property="og:locale" content="pt_BR">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">

### Regras Estritas de Meta Tags:
- **Zero Tags Genéricas:** NUNCA deixe `<title>` ou `description` vazios ou com texto padrão ("Página Inicial", "Documento").
- **Exclusividade:** Cada página DEVE ter um `<title>` e uma `description` únicos.
- **Marca no Título:** Sempre insira o nome do projeto/marca no final do título.
- **Sem Meta Keywords:** NUNCA adicione `<meta name="keywords">` (descontinuado e ignorado pelos buscadores).

---

## 2. ARQUITETURA SEMÂNTICA E HEADING HIERARCHY

### Estrutura Visual e HTML5:
- Use sempre tags semânticas: `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, `<footer>`.
- Proibido usar `<div>` para elementos funcionais de estrutura quando houver tag semântica apropriada.
- Elementos clicáveis DEVEM usar `<button>` ou `<a>` (com atributo `href` válido). NUNCA coloque eventos de clique em `<div>` ou `<span>`.

### Regras de Hierarquia de Títulos (H1-H6):
- **Apenas UM `<h1>` por página**, contendo o tópico/palavra-chave central.
- A hierarquia deve ser rigorosamente sequencial (`<h1>` -> `<h2>` -> `<h3>`). **Nunca pule níveis** (ex: `<h2>` direto para `<h4>`).

---

## 3. URLS, ROBOTS E SITEMAP

- **Sintaxe de URLs:** Minúsculas, separadas por hífen (`-`), sem parâmetros desnecessários e sem barra no final.
- **Sitemap.xml:** OBRIGATÓRIO listar todas as URLs públicas estáticas e dinâmicas com caminhos absolutos (`https://...`).
- **Robots.txt:** Servir sempre na raiz (`/robots.txt`) apontando a localização do `Sitemap: https://DOMINIO/sitemap.xml`.
- **Desindexação:** Para ocultar páginas privadas/administrativas, use `<meta name="robots" content="noindex, nofollow">` no HTML, NUNCA apenas o `robots.txt`.

---

## 4. SCHEMA.ORG (STRUCTURED DATA JSON-LD)

Toda página pública deve conter o Script JSON-LD adequado no `<head>`.

### Block Base Universal (Organization/WebSite):
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "NOME_DO_PROJETO",
  "url": "https://DOMINIO_OFICIAL",
  "logo": "https://DOMINIO_OFICIAL/assets/logo.png"
}

### Regras por Tipo de Página:
- **Listagens/Tabelas:** Incluir o schema `@type: "Table"` ou `ItemList`.
- **Artigos/Blogs:** Incluir o schema `@type: "Article"` ou `"BlogPosting"`.
- **Páginas de Produtos/Serviços:** Incluir `@type: "Product"` ou `"Service"`.
- **Páginas Internas Naves:** Incluir sempre `BreadcrumbList`.

---

## 5. CORE WEB VITALS & PERFORMANCE VISUAL

- **LCP (<= 2.5s):** Priorize imagens críticas (`fetchpriority="high"`). Não use lazy load no elemento do LCP.
- **INP (<= 200ms):** Evite tarefas longas no JavaScript. Destaque handlers de clique pesados com `setTimeout` ou web workers.
- **CLS (<= 0.1):** Sempre defina `width` e `height` explícitos em todas as imagens/svgs/iframes.
- **Imagens:** Todas as imagens fora da primeira dobra (below-the-fold) DEVEM conter `loading="lazy"`.
- **Fontes:** Utilize `font-display: swap;` no CSS para evitar texto invisível enquanto a fonte carrega.
- **Minificação:** O código CSS e JS final para produção deve estar minificado e sem comentários.

---

## 6. OTIMIZAÇÃO DE DADOS E APIs (REQUISITION EFFICIENCY)

Independente de usar Supabase, PostgREST, GraphQL ou REST genérico, siga estas regras para economizar recursos:

### A. Consultas Selecionadas (Zero Wildcards)
- **PROIBIDO** fazer queries coringa (ex: `SELECT *` ou `select=*`). Especifique apenas os campos utilizados pela interface.

### B. Paginação & Limites
- Toda consulta que retorne listas DEVE ter limite explícito (`limit` / `page_size`).
- Não solicite o total exato de linhas (`count`) a menos que a interface exiba explicitamente a paginação numérica "Página X de Y".

### C. Estratégias de Cache Frontend
- **Dados Estáticos/Semi-estáticos:** Implemente cache com `localStorage` ou `sessionStorage` com controle de expiração (TTL).
- **Evite Loops/Polling Agressivo:** Nunca execute requisições dentro de `requestAnimationFrame` ou loops curtos. Polling só deve ocorrer via `setInterval` com espaço mínimo de 30s.
- **Tab Inativa:** Interrompa requisições periódicas caso o usuário mude de aba (`document.hidden`).

### D. Paralelismo de Requisições
- NUNCA encadeie requisições independentes (`await fetch1; await fetch2;`). Utilize `Promise.all()` ou `Promise.allSettled()`.

---

## 7. GERAÇÃO DE PÁGINAS ESTÁTICAS (PRERENDER / SSG)

1. **Pre-render First:** Para todas as páginas públicas (Landing Pages, Artigos, Páginas de Itens/Produtos), o HTML base deve vir com o conteúdo estático pré-renderizado.
2. **Hydration Limpa:** O HTML servido já deve conter o texto e as meta tags para o crawler ler imediatamente. O JavaScript entra após a renderização apenas para ativar a interatividade ou atualizar dados em tempo real.
3. **Páginas Protegidas:** Páginas atrás de autenticação (Dashboard, Minha Conta) não precisam de SSG/Prerender nem de SEO indexável.

---

## 8. CHECKLIST DE VALIDAÇÃO DO CÓDIGO GERADO

Antes de considerar qualquer entrega de interface ou script frontend concluído, valide os itens:
- [ ] O `<title>` e a `description` são específicos e não repetidos?
- [ ] Existe apenas um `<h1>` na página?
- [ ] Todas as imagens possuem atributo `alt` e dimensões (`width`/`height`) definidas?
- [ ] Nenhuma query/fetch traz dados que não estão sendo renderizados no DOM?
- [ ] Os elementos clicáveis possuem foco visual e tamanho mínimo para toque (>= 48px)?
- [ ] O JSON-LD correspondente está inserido no `<head>` sem erros de sintaxe?