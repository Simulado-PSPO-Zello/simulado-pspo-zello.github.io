# Simulado PSPO I

Simulado para treinar para a certificação **Professional Scrum Product Owner I (PSPO I)**, nas mesmas condições da prova oficial:

| Item | Valor |
| --- | --- |
| Questões | 80 |
| Tempo limite | 60 minutos |
| Nota de aprovação | 85% (68 acertos) |
| Formatos | Múltipla escolha, múltipla resposta, verdadeiro/falso |

## Como usar

Abra o `index.html` no navegador. Não precisa instalar nada.

O simulado está disponível em **português e inglês** (seletor PT | EN na tela inicial). A prova oficial é aplicada em inglês.

- **Modo Prova:** 80 questões cronometradas, com resultado só no final. A prova é enviada automaticamente quando o tempo acaba.
- **Modo Estudo:** sem limite de tempo, com a resposta e a explicação depois de cada questão.

## Métricas

- Nota e resultado (aprovado/reprovado)
- Acertos por área do syllabus
- Tempo total, tempo médio e tempo por questão, comparado ao ritmo ideal de 45 s
- Revisão com explicações, com filtro de erradas e marcadas
- Histórico de tentativas, salvo no navegador

## Banco de questões e rodízio

O banco tem **251 questões**, cada uma em PT e EN. A cada prova, 80 são sorteadas com peso por área. O simulado guarda quantas vezes cada questão já caiu e prioriza as menos vistas: cerca de 3 provas seguidas não repetem nenhuma questão.

| Área | Questões por prova | No banco |
| --- | --- | --- |
| Gestão do Product Backlog | 22 | 69 |
| Papel do Product Owner | 15 | 46 |
| PO nos Eventos Scrum | 14 | 43 |
| Produto, Visão e Valor | 12 | 38 |
| Release e Entrega de Valor | 10 | 32 |
| Fundamentos do Scrum | 7 | 23 |

## Nuvem (Neon)

Os resultados do Modo Prova são salvos num banco Postgres no [Neon](https://neon.com), através de uma API no **Neon Functions** (`api/index.ts`). A senha do banco nunca vai para o navegador.

- **Ranking:** melhor nota de cada pessoa, na tela inicial.
- **Histórico na nuvem:** a pessoa busca pelo nome e vê as próprias provas em qualquer aparelho.
- **Painel do gestor:** `admin.html`, protegido pela chave de administrador (`ADMIN_KEY`). Mostra todas as tentativas, desempenho por área, questões que mais derrubam e exportação em CSV.
- **Sem conexão:** o resultado fica guardado no aparelho e é enviado automaticamente depois.

| Rota | Acesso | O que faz |
| --- | --- | --- |
| `POST /attempts` | público | Grava uma tentativa (a nota é recalculada no servidor) |
| `GET /ranking` | público | Top 20, melhor nota por pessoa |
| `GET /history?name=` | público | Tentativas de um nome |
| `GET /admin/summary`, `/admin/attempts`, `/admin/questions` | `X-Admin-Key` | Dados do painel do gestor |

### Rodar e publicar a API

```bash
npm install
neon dev                          # roda a API localmente
neon deploy --env .env.local      # publica no Neon
```

O `.env.local` (fora do Git) precisa ter `ADMIN_KEY` e `ALLOWED_ORIGINS` (sites que podem chamar a API, separados por vírgula), além das variáveis que o `neon env pull` gera. O endereço público da API fica em `config.js`.

## Adicionando questões

As questões ficam em `questions.js` (PT) e `questions-en.js` (EN). Os dois arquivos precisam ter a **mesma ordem**: o índice é o id da questão no rodízio. Toda questão nova deve ser adicionada no fim dos dois arquivos. Cada item segue este formato:

```js
{ topic: "backlog", type: "single", // topic: backlog | po | events | value | release | fundamentals
  q: "Enunciado",
  options: ["A", "B", "C", "D"],
  answer: [1],            // índices das opções corretas
  exp: "Explicação exibida na revisão." },
```

As questões são autorais e baseadas no [Scrum Guide 2020](https://scrumguides.org/). Este projeto não tem relação oficial com a Scrum.org.
