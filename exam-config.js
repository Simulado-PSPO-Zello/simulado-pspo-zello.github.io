// Planta da prova: quantas questões de cada tema entram nas 80 e a qual área oficial
// da Scrum.org cada tema pertence.
//
// A Scrum.org não publica o peso de cada área no PSPO I. A página oficial diz que
// "many questions focus on the Product Owner accountabilities based on the Scrum Guide
// and also the application of Scrum" e lista três focus areas. A distribuição abaixo segue
// isso e a estimativa mais citada pelos guias de preparação: ~30% framework Scrum e ~70%
// gestão de produto, com destaque para o papel do Product Owner e o Product Backlog.
window.EXAM_BLUEPRINT = {
  quota: {
    fundamentals: 12, // empirismo, Scrum Team, artefatos, Done, times autogerenciáveis
    events: 12,       // o Product Owner nos eventos
    po: 16,           // accountabilities do PO, stakeholders e clientes
    backlog: 16,      // Product Backlog Management
    value: 12,        // visão, valor, estratégia de negócio, EBM
    release: 12,      // previsão, release e entrega de valor (Incremento, Done)
  },
  // Áreas oficiais (focus areas) da Scrum.org, agrupando os temas do simulado.
  // "Developing People and Teams" (times autogerenciáveis) está dentro de Fundamentos.
  areas: [
    {
      key: "framework",
      label: "Entender e aplicar o Scrum + Desenvolver pessoas e times",
      official: "Understanding and Applying the Scrum Framework · Developing People and Teams",
      topics: ["fundamentals", "events"],
    },
    {
      key: "product",
      label: "Gerenciar produtos com agilidade",
      official: "Managing Products with Agility",
      topics: ["po", "backlog", "value", "release"],
    },
  ],
};
