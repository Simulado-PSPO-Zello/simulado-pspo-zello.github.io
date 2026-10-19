// Planta da prova: quantas questões de cada tema entram nas 80 e a qual área
// (competência da Scrum.org) cada tema pertence.
//
// A Scrum.org não publica o peso de cada área no PSPO I. A distribuição abaixo segue a
// referência adotada pelo projeto, com as três grandes competências do Product Owner:
//   1. Entender e aplicar o Scrum ........ 30–40%  → 28 de 80 (35%)
//   2. Gerenciar produtos com agilidade .. 35–40%  → 32 de 80 (40%)
//   3. Desenvolver pessoas e times ....... 20–25%  → 20 de 80 (25%)
// O banco de questões não muda; só a quantidade sorteada de cada tema.
window.EXAM_BLUEPRINT = {
  quota: {
    fundamentals: 11, // empirismo, valores, papéis, artefatos, Done
    events: 17,       // eventos do Scrum e o PO em cada um
    backlog: 14,      // ordenação, refinamento, transparência, criação de valor
    value: 9,         // visão do produto, Meta do Produto, valor, EBM
    release: 9,       // previsão, planejamento de release, Incremento e Done
    po: 20,           // times autogerenciáveis, relação com Developers e stakeholders
  },
  areas: [
    {
      key: "framework",
      label: "Entender e aplicar o Scrum",
      official: "Understanding and Applying the Scrum Framework · meta 30–40%",
      topics: ["fundamentals", "events"],
    },
    {
      key: "product",
      label: "Gerenciar produtos com agilidade",
      official: "Managing Products with Agility · meta 35–40%",
      topics: ["backlog", "value", "release"],
    },
    {
      key: "people",
      label: "Desenvolver pessoas e times",
      official: "Developing People and Teams · meta 20–25%",
      topics: ["po"],
    },
  ],
};
