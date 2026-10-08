# Simulado PSPO I

Simulado para treinar para a certificação **Professional Scrum Product Owner I (PSPO I)**, nas mesmas condições da prova oficial:

| Item | Valor |
| --- | --- |
| Questões | 80 |
| Tempo limite | 60 minutos |
| Nota de aprovação | 85% (68 acertos) |
| Formatos | Múltipla escolha, múltipla resposta, verdadeiro/falso |

## Como usar

Abra o simulado em **https://simulado-pspo-zello.github.io** (GitHub Pages). O login exige um endereço `http(s)`: abrir o `index.html` com dois cliques não funciona. Para testar no computador, rode um servidor local, por exemplo `npx http-server -p 5173`, e acesse http://localhost:5173.

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

## Login e nuvem (Neon)

**Acesso restrito a e-mails `@zello.tec.br`.** A pessoa digita o e-mail corporativo, recebe um código no e-mail e entra (Neon Auth, sem senha). A API confere em toda requisição que o e-mail é verificado e do domínio permitido; a checagem na tela é só para orientar.

Os resultados do Modo Prova são salvos num Postgres no [Neon](https://neon.com), através de uma API no **Neon Functions** (`api/index.ts`). A senha do banco nunca vai para o navegador.

- **Ranking:** melhor nota de cada pessoa (mostra o nome, nunca o e-mail).
- **Meu histórico:** as provas da pessoa logada, em qualquer aparelho.
- **Painel do gestor:** `admin.html`, liberado só para os e-mails em `ADMIN_EMAILS`. Mostra todas as tentativas, desempenho por área, questões que mais derrubam e exportação em CSV.
- **Sem conexão:** o resultado fica guardado no aparelho e é enviado depois, só para a conta de quem fez a prova.

| Rota | Acesso | O que faz |
| --- | --- | --- |
| `GET /me` | logado | E-mail, nome e se é gestor |
| `POST /attempts` | logado | Grava uma tentativa (a nota é recalculada no servidor) |
| `GET /ranking` | logado | Top 20, melhor nota por pessoa |
| `GET /me/history` | logado | Tentativas da pessoa logada |
| `GET /admin/summary`, `/admin/attempts`, `/admin/questions` | gestor | Dados do painel |

### Rodar e publicar a API

```bash
npm install
neon dev                          # roda a API localmente
neon deploy --env .env.local      # publica no Neon
npm run build:auth                # regenera vendor/neon-auth.js (cliente de login)
```

O `.env.local` (fora do Git) precisa ter `ALLOWED_ORIGINS` (sites que podem chamar a API), `ALLOWED_EMAIL_DOMAIN` e `ADMIN_EMAILS`, além das variáveis que o `neon env pull` gera. Os endereços públicos ficam em `config.js`. Um site novo também precisa ser cadastrado no Neon Auth: `neon neon-auth domain add https://site`.

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
