/**
 * Base de bairros do município do Rio de Janeiro.
 *
 * Fonte: lista oficial de bairros por subprefeitura/região administrativa
 * (Prefeitura do Rio de Janeiro / data.rio). Usada pelo ranking da comunidade
 * para reconhecer todos os bairros cariocas, mesmo os que ainda não têm
 * contribuições, e para padronizar nomes vindos dos relatos (acentos, caixa,
 * abreviações e grafias alternativas).
 */
(function () {
  'use strict';

  const ZONAS = {
    central: 'Zona Central',
    norte: 'Zona Norte',
    sul: 'Zona Sul',
    oeste: 'Zona Oeste',
    sudoeste: 'Zona Sudoeste'
  };

  // Agrupado por zona para manter o arquivo legível e permitir filtros futuros.
  const BAIRROS_POR_ZONA = {
    central: [
      'Benfica', 'Caju', 'Catumbi', 'Centro', 'Cidade Nova', 'Estácio', 'Gamboa',
      'Glória', 'Lapa', 'Mangueira', 'Paquetá', 'Rio Comprido', 'Santa Teresa',
      'Santo Cristo', 'São Cristóvão', 'Saúde', 'Vasco da Gama'
    ],
    norte: [
      'Abolição', 'Acari', 'Água Santa', 'Alto da Boa Vista', 'Anchieta', 'Andaraí',
      'Argentino', 'Bancários', 'Barros Filho', 'Bento Ribeiro', 'Bonsucesso',
      'Brás de Pina', 'Cachambi', 'Cacuia', 'Campinho', 'Cascadura', 'Cavalcanti',
      'Cidade Universitária', 'Cocotá', 'Coelho Neto', 'Colégio', 'Complexo do Alemão',
      'Cordovil', 'Costa Barros', 'Del Castilho', 'Encantado', 'Engenheiro Leal',
      'Engenho da Rainha', 'Engenho de Dentro', 'Engenho Novo', 'Freguesia (Ilha do Governador)',
      'Galeão', 'Grajaú', 'Guadalupe', 'Higienópolis', 'Honório Gurgel', 'Inhaúma',
      'Irajá', 'Jacaré', 'Jacarezinho', 'Jardim América', 'Jardim Carioca',
      'Jardim Guanabara', 'Lins de Vasconcelos', 'Madureira', 'Manguinhos', 'Maracanã',
      'Maré', 'Marechal Hermes', 'Maria da Graça', 'Méier', 'Moneró', 'Olaria',
      'Oswaldo Cruz', 'Parada de Lucas', 'Parque Anchieta', 'Parque Colúmbia',
      'Pavuna', 'Penha', 'Penha Circular', 'Piedade', 'Pilares', 'Pitangueiras',
      'Portuguesa', 'Praça da Bandeira', 'Praia da Bandeira', 'Quintino Bocaiuva',
      'Ramos', 'Riachuelo', 'Ribeira', 'Ricardo de Albuquerque', 'Rocha',
      'Rocha Miranda', 'Sampaio', 'São Francisco Xavier', 'Tauá', 'Tijuca',
      'Todos os Santos', 'Tomás Coelho', 'Triagem', 'Turiaçu', 'Vaz Lobo',
      'Vicente de Carvalho', 'Vila da Penha', 'Vigário Geral', 'Vila Isabel',
      'Vila Kosmos', 'Vista Alegre', 'Zumbi'
    ],
    sul: [
      'Botafogo', 'Catete', 'Copacabana', 'Cosme Velho', 'Flamengo', 'Gávea',
      'Humaitá', 'Ipanema', 'Jardim Botânico', 'Lagoa', 'Laranjeiras', 'Leblon',
      'Leme', 'Rocinha', 'São Conrado', 'Urca', 'Vidigal'
    ],
    oeste: [
      'Bangu', 'Barra de Guaratiba', 'Campo dos Afonsos', 'Campo Grande', 'Cosmos',
      'Deodoro', 'Gericinó', 'Guaratiba', 'Ilha de Guaratiba', 'Inhoaíba', 'Jabour',
      'Jardim Sulacap', 'Magalhães Bastos', 'Paciência', 'Padre Miguel',
      'Pedra de Guaratiba', 'Realengo', 'Santa Cruz', 'Santíssimo', 'Senador Camará',
      'Senador Vasconcelos', 'Sepetiba', 'Vila Kennedy', 'Vila Militar'
    ],
    sudoeste: [
      'Anil', 'Barra da Tijuca', 'Barra Olímpica', 'Camorim', 'Cidade de Deus',
      'Curicica', 'Freguesia (Jacarepaguá)', 'Gardênia Azul', 'Grumari', 'Itanhangá',
      'Jacarepaguá', 'Joá', 'Pechincha', 'Praça Seca', 'Recreio dos Bandeirantes',
      'Rio das Pedras', 'Tanque', 'Taquara', 'Vargem Grande', 'Vargem Pequena',
      'Vila Valqueire'
    ]
  };

  // Grafias alternativas comuns em relatos e no OpenStreetMap.
  const ALIASES = {
    'barra': 'Barra da Tijuca',
    'recreio': 'Recreio dos Bandeirantes',
    'ilha do fundao': 'Cidade Universitária',
    'fundao': 'Cidade Universitária',
    'cidade universitaria': 'Cidade Universitária',
    'imperial de sao cristovao': 'São Cristóvão',
    's cristovao': 'São Cristóvão',
    'sao cristovao': 'São Cristóvão',
    'pca seca': 'Praça Seca',
    'praca seca': 'Praça Seca',
    'pca da bandeira': 'Praça da Bandeira',
    'afonsos': 'Campo dos Afonsos',
    'campo dos afonsos': 'Campo dos Afonsos',
    'chacara do ceu': 'Santa Teresa',
    'morro dois irmaos': 'Vidigal',
    'complexo da mare': 'Maré',
    'complexo do alemao': 'Complexo do Alemão',
    'complexo do jacarezinho': 'Jacarezinho',
    'vila do joao': 'Maré',
    'jardim oceanico': 'Barra da Tijuca',
    'peninsula': 'Barra da Tijuca',
    'baixa do sapateiro': 'Maré',
    'nova holanda': 'Maré'
  };

  function normalize(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  const list = [];
  const byKey = new Map();
  const seen = new Set();

  Object.keys(BAIRROS_POR_ZONA).forEach((zonaKey) => {
    BAIRROS_POR_ZONA[zonaKey].forEach((nome) => {
      const key = normalize(nome);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const bairro = { nome, zona: ZONAS[zonaKey], zonaKey };
      list.push(bairro);
      byKey.set(key, bairro);
    });
  });

  list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));

  function find(value) {
    const key = normalize(value);
    if (!key) return null;
    if (byKey.has(key)) return byKey.get(key);

    const alias = ALIASES[key];
    if (alias) return byKey.get(normalize(alias)) || null;

    // Aceita sufixos/prefixos comuns sem criar falsos positivos:
    // "Bairro Centro" -> "centro"; "Centro, Rio de Janeiro" -> "centro".
    const words = key.split(' ');
    if (words.length > 1) {
      const withoutGeneric = key
        .replace(/^(bairro|bairro de|bairro do|bairro da)\s+/, '')
        .replace(/\s+(rio de janeiro|rj)$/, '')
        .trim();
      if (withoutGeneric && byKey.has(withoutGeneric)) return byKey.get(withoutGeneric);

      const first = words[0];
      if (first === 'bairro' && byKey.has(words.slice(1).join(' '))) {
        return byKey.get(words.slice(1).join(' '));
      }
    }

    return null;
  }

  function titleCase(value) {
    const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
    return String(value || '')
      .toLocaleLowerCase('pt-BR')
      .split(/\s+/)
      .filter(Boolean)
      .map((word, index) => {
        if (index > 0 && small.has(word)) return word;
        return word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1);
      })
      .join(' ');
  }

  window.UrbanNeighborhoods = {
    list,
    zonas: ZONAS,
    normalize,
    find,
    titleCase,
    total: list.length
  };
})();
