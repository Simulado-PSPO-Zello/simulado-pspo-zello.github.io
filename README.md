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

- **Modo Prova:** 80 questões cronometradas, com resultado só no final. A prova é enviada automaticamente quando o tempo acaba.
- **Modo Estudo:** sem limite de tempo, com a resposta e a explicação depois de cada questão.

## Métricas

- Nota e resultado (aprovado/reprovado)
- Acertos por área do syllabus
- Tempo total, tempo médio e tempo por questão, comparado ao ritmo ideal de 45 s
- Revisão com explicações, com filtro de erradas e marcadas
- Histórico de tentativas, salvo no navegador

## Áreas cobertas

As questões são sorteadas com peso por área:

| Área | Questões por prova |
| --- | --- |
| Gestão do Product Backlog | 22 |
| Papel do Product Owner | 15 |
| PO nos Eventos Scrum | 14 |
| Produto, Visão e Valor | 12 |
| Release e Entrega de Valor | 10 |
| Fundamentos do Scrum | 7 |

## Adicionando questões

As questões ficam em `questions.js`. Cada item segue este formato:

```js
{ topic: "Gestão do Product Backlog", type: "single", // "single" | "multi" | "tf"
  q: "Enunciado",
  options: ["A", "B", "C", "D"],
  answer: [1],            // índices das opções corretas
  exp: "Explicação exibida na revisão." },
```

As questões são autorais e baseadas no [Scrum Guide 2020](https://scrumguides.org/). Este projeto não tem relação oficial com a Scrum.org.
