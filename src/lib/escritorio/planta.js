/**
 * Planta do Escritorio: o desenho e a animacao, em DOM puro.
 *
 * Fica fora do React de proposito. Sao 22 mesas, gente andando por corredor e
 * umas dez animacoes ao mesmo tempo; refazer isso como componente significaria
 * re-renderizar a cena inteira a cada mudanca de estado. Aqui o React so entrega
 * os dados por `aplicar()` e o motor mexe nos nos que precisam.
 *
 * A fronteira tipada esta em planta.d.ts.
 */

const ESTILO = "/* Escritorio visto de cima, em pixel art clara. Tema unico assumido:\r\n     e uma cena, nao um documento. Toda cor pintada explicitamente. */\r\n  :root {\r\n    --piso:   #d7dad4;\r\n    --parede: #eef0ec;\r\n    --papel:  #f6f7f4;\r\n    --tinta:  #23252a;\r\n    --fraco:  #6f7480;\r\n    --borda:  #c2c6bf;\r\n    --azul:   #2f6fd0;\r\n\r\n    --pixel: \"Press Start 2P\", \"Courier New\", monospace;\r\n    --corpo: \"IBM Plex Sans\", system-ui, sans-serif;\r\n    --mono:  \"IBM Plex Mono\", ui-monospace, Consolas, monospace;\r\n  }\r\n\r\n  body {\r\n    margin: 0;\r\n    background: var(--parede);\r\n    color: var(--tinta);\r\n    font: 400 15px/1.6 var(--corpo);\r\n    -webkit-font-smoothing: antialiased;\r\n  }\r\n\r\n  .predio { max-width: 1300px; margin: 0 auto; padding: 26px 18px 60px; display: flex; flex-direction: column; gap: 18px; }\r\n\r\n  header.topo { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 14px; }\r\n  h1 { margin: 0; font: 400 clamp(13px, 1.9vw, 18px)/1.5 var(--pixel); }\r\n  .sub { margin: 9px 0 0; max-width: 58ch; color: var(--fraco); font-size: 14.5px; }\r\n\r\n  .cracha {\r\n    display: flex; align-items: center; gap: 9px;\r\n    border: 2px solid var(--tinta); background: var(--papel);\r\n    padding: 9px 13px; font: 400 8px/1.5 var(--pixel); color: var(--fraco);\r\n  }\r\n  .luz { width: 9px; height: 9px; background: #b9bdb6; }\r\n  .luz.viva { background: #2fae63; box-shadow: 0 0 9px #2fae63; }\r\n\r\n  .sala { border: 3px solid var(--tinta); background: var(--piso); overflow-x: auto; }\r\n  svg.chao { display: block; width: 100%; min-width: 980px; height: auto; }\r\n\r\n  .setores { display: flex; flex-wrap: wrap; gap: 9px; }\r\n  .setores span {\r\n    display: inline-flex; align-items: center; gap: 8px;\r\n    border: 2px solid var(--borda); background: var(--papel);\r\n    padding: 7px 11px; font: 400 7px/1.4 var(--pixel);\r\n  }\r\n  .setores i { width: 10px; height: 10px; display: block; font-style: normal; border: 1px solid rgba(0,0,0,.25); }\r\n\r\n  .paineis { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 14px; }\r\n  @media (max-width: 880px) { .paineis { grid-template-columns: 1fr; } }\r\n\r\n  .ficha {\r\n    border: 3px solid var(--tinta); background: var(--papel);\r\n    padding: 17px 19px; display: flex; flex-direction: column; gap: 11px; min-width: 0;\r\n  }\r\n  .ficha > .rot { font: 400 7px/1.6 var(--pixel); letter-spacing: .05em; color: var(--fraco); }\r\n  #f-quem { margin: 0; font: 400 clamp(11px, 1.4vw, 14px)/1.5 var(--pixel); }\r\n  #f-mesa { margin: 0; font-size: 14px; color: var(--fraco); }\r\n  #f-arquivo {\r\n    font: 400 13px/1.5 var(--mono); color: #14507f;\r\n    background: #e4edf5; border-left: 3px solid var(--azul);\r\n    padding: 10px 12px; overflow-wrap: anywhere;\r\n  }\r\n  #f-quando { font: 400 12px var(--mono); color: var(--fraco); }\r\n\r\n  ul.equipe { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 11px; }\r\n  ul.equipe li {\r\n    display: grid; grid-template-columns: 12px minmax(0, 1fr) auto;\r\n    gap: 11px; align-items: start;\r\n    border-bottom: 1px solid var(--borda); padding-bottom: 11px;\r\n  }\r\n  ul.equipe li:last-child { border-bottom: 0; padding-bottom: 0; }\r\n  ul.equipe i { width: 11px; height: 11px; display: block; margin-top: 4px; font-style: normal; border: 1px solid rgba(0,0,0,.3); }\r\n  ul.equipe .quem { min-width: 0; display: flex; flex-direction: column; gap: 2px; }\r\n  ul.equipe b { font-size: 14px; font-weight: 600; }\r\n  ul.equipe em { font-style: normal; font-size: 13px; color: var(--fraco); overflow-wrap: anywhere; }\r\n  ul.equipe .onde { font: 400 11px var(--mono); color: var(--fraco); text-align: right; white-space: nowrap; }\r\n  .nada { color: var(--fraco); font-size: 13.5px; }\r\n\r\n  footer { color: var(--fraco); font: 400 12px/1.7 var(--mono); border-top: 1px solid var(--borda); padding-top: 15px; }\r\n\r\n  @media (prefers-reduced-motion: reduce) { .luz { box-shadow: none !important; } }";

const MARCACAO = "<div class=\"predio\"><header class=\"topo\">\r\n    <div>\r\n      <h1>Escritório do Orion Track</h1>\r\n      <p class=\"sub\">\r\n        Cada mesa é um módulo do sistema. Quem está trabalhando aparece no\r\n        escritório e anda até a mesa em que está mexendo.\r\n      </p>\r\n    </div>\r\n    <div class=\"cracha\"><span class=\"luz\" id=\"luz\"></span><span id=\"cracha-txt\">CONECTANDO</span></div>\r\n  </header>\r\n\r\n  <div class=\"sala\">\r\n    <svg class=\"chao\" id=\"chao\" viewBox=\"0 0 1240 920\" role=\"img\"\r\n         aria-label=\"Planta de um escritório visto de cima com 22 mesas em cinco setores e as pessoas que estão trabalhando agora, cada uma parada na mesa do módulo em que mexe.\"></svg>\r\n  </div>\r\n\r\n  <div class=\"setores\" id=\"setores\"></div>\r\n\r\n  <div class=\"paineis\">\r\n    <section class=\"ficha\">\r\n      <span class=\"rot\">ÚLTIMO MOVIMENTO</span>\r\n      <p id=\"f-quem\">Escritório vazio</p>\r\n      <p id=\"f-mesa\">Ninguém trabalhando agora.</p>\r\n      <div id=\"f-arquivo\">nenhum arquivo aberto</div>\r\n      <span id=\"f-quando\"></span>\r\n    </section>\r\n\r\n    <section class=\"ficha\">\r\n      <span class=\"rot\">QUEM ESTÁ ONDE</span>\r\n      <ul class=\"equipe\" id=\"equipe\"><li class=\"nada\">Ninguém no escritório.</li></ul>\r\n    </section>\r\n  </div>\r\n\r\n  <footer>\r\n    22 mesas · 74 páginas · 25 áreas de API<br>\r\n    Next.js 16 · Supabase · Docker Swarm · Traefik · UAZAPI\r\n  </footer></div>";

export function montarEscritorio(raiz) {
  "use strict";

  if (!raiz) return { aplicar() {}, destruir() {} };

  const folha = document.createElement("style");
  folha.textContent = ESTILO;
  raiz.appendChild(folha);
  const involucro = document.createElement("div");
  involucro.innerHTML = MARCACAO;
  raiz.appendChild(involucro);

var SETORES = [
    { id:"corretoras", nome:"CORRETORAS", sub:"o produto",         cor:"#4f9d5d", piso:"#dde5db", x:34,  y:60,  w:540, h:340 },
    { id:"kripto",     nome:"KRIPTO",     sub:"comercial",         cor:"#d4663c", piso:"#e8ddd6", x:600, y:60,  w:530, h:340 },
    { id:"apollo",     nome:"APOLLO",     sub:"tráfego e criação",  cor:"#7a5bc4", piso:"#e0dceb", x:34,  y:430, w:540, h:340 },
    { id:"admin",      nome:"DIRETORIA",  sub:"administração",     cor:"#c9a227", piso:"#eae4d2", x:600, y:430, w:250, h:340 },
    { id:"maquinas",   nome:"MÁQUINAS",   sub:"a sala do fundo",   cor:"#3f7fa8", piso:"#d6dee4", x:876, y:430, w:254, h:340 }
  ];

  var MESAS = [
    { id:"leads",       nome:"Leads",           setor:"corretoras", tipo:"mesa",    x:130,  y:160 },
    { id:"kanban",      nome:"Kanban",          setor:"corretoras", tipo:"mesa",    x:302,  y:160 },
    { id:"inbox",       nome:"Inbox WhatsApp",  setor:"corretoras", tipo:"mesa",    x:474,  y:160 },
    { id:"ia",          nome:"IA Atendimento",  setor:"corretoras", tipo:"posto",   x:130,  y:290 },
    { id:"simulador",   nome:"Simulador",       setor:"corretoras", tipo:"mesa",    x:302,  y:290 },
    { id:"painel",      nome:"Painel Corretor", setor:"corretoras", tipo:"mesa",    x:474,  y:290 },

    { id:"leadsc",      nome:"Leads Comercial", setor:"kripto",     tipo:"mesa",    x:696,  y:160 },
    { id:"kanbanc",     nome:"Kanban Kripto",   setor:"kripto",     tipo:"mesa",    x:868,  y:160 },
    { id:"inboxc",      nome:"Inbox Comercial", setor:"kripto",     tipo:"mesa",    x:1040, y:160 },
    { id:"iasdr",       nome:"IA SDR",          setor:"kripto",     tipo:"posto",   x:782,  y:290 },
    { id:"sala",        nome:"Sala e Metas",    setor:"kripto",     tipo:"mesa",    x:954,  y:290 },

    { id:"trafego",     nome:"Tráfego",         setor:"apollo",     tipo:"mesa",    x:130,  y:530 },
    { id:"otimizacoes", nome:"Otimizações",     setor:"apollo",     tipo:"posto",   x:302,  y:530 },
    { id:"criativos",   nome:"Criativos",       setor:"apollo",     tipo:"mesa",    x:474,  y:530 },
    { id:"designer",    nome:"Designer",        setor:"apollo",     tipo:"mesa",    x:216,  y:660 },
    { id:"apollo",      nome:"Time Apollo",     setor:"apollo",     tipo:"mesa",    x:388,  y:660 },

    { id:"admin",       nome:"Administração",   setor:"admin",      tipo:"reuniao", x:722,  y:530 },
    { id:"contas",      nome:"Corretoras",      setor:"admin",      tipo:"reuniao", x:722,  y:660 },

    { id:"auth",        nome:"Autenticação",    setor:"maquinas",   tipo:"rack",    x:958,  y:530 },
    { id:"banco",       nome:"Banco de Dados",  setor:"maquinas",   tipo:"rack",    x:1076, y:530 },
    { id:"webhooks",    nome:"Webhooks",        setor:"maquinas",   tipo:"rack",    x:958,  y:660 },
    { id:"monitor",     nome:"Monitor",         setor:"maquinas",   tipo:"rack",    x:1076, y:660 },

    // Posto sem movel: o Carteiro fica de pe ao lado da caixa de correio, que
    // ja faz parte do cenario da entrada.
    { id:"correio",     nome:"",                setor:"entrada",    tipo:"nenhum",  x:1014, y:814 }
  ];

  // Depois disso sem mexer em nada, a pessoa larga a mesa e vai descansar.
  var OCIOSO_MS = 4 * 60 * 1000;

  // Ninguem fica plantado: quem esta ocioso circula por estes pontos.
  var DESCANSOS = [
    { x:150,  y:900, pose:"copa",     texto:"tomando um café" },
    { x:420,  y:886, pose:"sofa",     texto:"descansando no sofá" },
    { x:660,  y:886, pose:"sofa",     texto:"esticando as pernas" },
    { x:807,  y:854, pose:"mijar",  texto:"no banheiro" },
    { x:886,  y:864, pose:"cabine", texto:"ocupado, volto já" },
    { x:962,  y:864, pose:"banho",  texto:"tomando banho" },
    { x:1190, y:264, pose:"sofa",     texto:"no estar da direita" },
    { x:1190, y:584, pose:"sofa",     texto:"sentado lendo" },
    { x:300,  y:414, pose:"anda",     texto:"dando uma volta" },
    { x:900,  y:414, pose:"anda",     texto:"andando pelo corredor" },
    { x:587,  y:620, pose:"anda",     texto:"passando pelo corredor" }
  ];
  var CAFE = DESCANSOS[0];

  var NS = "http://www.w3.org/2000/svg";
  var chao = document.getElementById("chao");
  var setorPorId = {}, mesaPorId = {};
  SETORES.forEach(function (s) { setorPorId[s.id] = s; });
  MESAS.forEach(function (m) { mesaPorId[m.id] = m; });

  function el(n, a) { var e = document.createElementNS(NS, n); for (var k in a) if (a[k] !== undefined) e.setAttribute(k, a[k]); return e; }
  function px(p, x, y, w, h, f, st) {
    var r = el("rect", { x:x, y:y, width:w, height:h, fill:f });
    if (st) { r.setAttribute("stroke", st); r.setAttribute("stroke-width", "2"); }
    p.appendChild(r); return r;
  }
  function txt(p, x, y, s, cls, anchor) {
    var t = el("text", { x:x, y:y, class:cls, "text-anchor":anchor || "middle" });
    t.textContent = s; p.appendChild(t); return t;
  }

  /* ---------- mobiliario ---------- */

  function mesaComum(g) {
    px(g, -38, -14, 78, 28, "rgba(0,0,0,.10)");
    px(g, -40, -18, 78, 28, "#f9f9f6", "#a9ada6");
    px(g, -28, -14, 22, 15, "#333a44");
    px(g, -26, -12, 18, 11, "#a9d9f2").setAttribute("class", "tela");
    px(g,   6, -14, 22, 15, "#333a44");
    px(g,   8, -12, 18, 11, "#a9d9f2").setAttribute("class", "tela tela-b");
    px(g, -24, -10, 3, 3, "#1d5f86").setAttribute("class", "cursor");
    px(g, -13,   3, 26,  5, "#e6e8e2", "#b6bab2");
    px(g, -11,  18, 24, 19, "#ecb63f", "#b98a1f");
    px(g, -11,  18, 24,  6, "#d9a32e");
  }
  function postoIa(g) {
    px(g, -38, -14, 78, 28, "rgba(0,0,0,.10)");
    px(g, -40, -18, 78, 28, "#eef2fb", "#8f9bb5");
    px(g, -30, -16, 60, 20, "#27304a");
    px(g, -28, -14, 56, 16, "#7fe3c4").setAttribute("class", "tela-larga");
    // seis barras que correm em sequencia: a tela carregando
    for (var i = 0; i < 6; i++) {
      var b = px(g, -25 + i * 9, -11, 5, 10, "#27304a");
      b.setAttribute("class", "barra");
      b.setAttribute("style", "animation-delay:" + (i * 0.13).toFixed(2) + "s");
    }
    px(g, -13, 3, 26, 5, "#dfe4ee", "#aab3c6");
    // Duas cadeiras: na esquerda senta a Aline, na direita o Apolo.
    px(g, -40, 18, 24, 19, "#8f9bb5", "#6b768f");
    px(g, -40, 18, 24,  6, "#7c88a3");
    px(g,  17, 18, 24, 19, "#8f9bb5", "#6b768f");
    px(g,  17, 18, 24,  6, "#7c88a3");
  }
  function mesaReuniao(g) {
    px(g, -56, -18, 114, 40, "rgba(0,0,0,.10)");
    px(g, -58, -22, 114, 40, "#b8543c", "#8a3a26");
    px(g, -54, -18, 106, 10, "#c76a52");
    for (var i = 0; i < 4; i++) {
      px(g, -46 + i * 26, -34, 18, 11, "#ecb63f", "#b98a1f");
      px(g, -46 + i * 26,  20, 18, 11, "#ecb63f", "#b98a1f");
    }
  }
  function rackServidor(g) {
    px(g, -30, -22, 62, 48, "rgba(0,0,0,.12)");
    px(g, -32, -26, 62, 48, "#3b424c", "#22272e");
    for (var l = 0; l < 4; l++) {
      px(g, -27, -21 + l * 11, 52, 8, "#2b313a");
      var l1 = px(g, -24, -19 + l * 11, 4, 4, l % 2 ? "#5fd68f" : "#ecb63f");
      l1.setAttribute("class", "luz-rack");
      l1.setAttribute("style", "animation-delay:" + (l * 0.17).toFixed(2) + "s");
      var l2 = px(g, -17, -19 + l * 11, 4, 4, "#5fd68f");
      l2.setAttribute("class", "luz-rack");
      l2.setAttribute("style", "animation-delay:" + (l * 0.23 + 0.4).toFixed(2) + "s");
      px(g,  14, -19 + l * 11, 8, 4, "#59657a");
    }
  }
  var MOVEIS = { mesa: mesaComum, posto: postoIa, reuniao: mesaReuniao, rack: rackServidor, nenhum: function () {} };

  function planta(g, x, y) {
    px(g, x - 6, y - 4, 12, 10, "#b8703f", "#8a5029");
    px(g, x - 9, y - 16, 18, 12, "#5aab41");
    px(g, x - 5, y - 22, 10, 8, "#6fc352");
  }
  function estanteVerde(g, x, y, cols, rows) {
    for (var c = 0; c < cols; c++) for (var r = 0; r < rows; r++) {
      px(g, x + c * 13, y + r * 15, 10, 12, "#6fc352", "#3f7f2c");
      px(g, x + c * 13, y + r * 15, 10, 4, "#8ddb6e");
    }
  }
  /** Sofa de tres lugares, visto de cima. */
  function sofa(g, x, y, cor) {
    px(g, x - 46, y - 20, 92, 44, "rgba(0,0,0,.10)");
    px(g, x - 48, y - 24, 92, 44, cor, "rgba(0,0,0,.28)");
    px(g, x - 48, y - 24, 92, 11, "rgba(0,0,0,.14)");          // encosto
    px(g, x - 48, y - 13, 10, 33, "rgba(0,0,0,.12)");          // bracos
    px(g, x + 34, y - 13, 10, 33, "rgba(0,0,0,.12)");
    px(g, x - 36, y - 10, 22, 27, "rgba(255,255,255,.22)");    // almofadas
    px(g, x - 11, y - 10, 22, 27, "rgba(255,255,255,.22)");
    px(g, x + 14, y - 10, 18, 27, "rgba(255,255,255,.22)");
  }

  function mesinha(g, x, y) {
    px(g, x - 22, y - 14, 44, 28, "rgba(0,0,0,.10)");
    px(g, x - 24, y - 17, 44, 28, "#b8703f", "#8a5029");
    px(g, x - 18, y - 12, 32, 8, "#cf8a55");
    px(g, x - 6, y - 3, 11, 9, "#f3f3ef", "#b9bdb6");           // duas xicaras
    px(g, x + 7, y - 3, 8, 8, "#f3f3ef", "#b9bdb6");
  }

  /** Banheiro: mictorio, cabine fechada e box de banho. */
  function banheiro(g, x, y, w, h) {
    px(g, x, y, w, h, "#e7edf0", "#9fb2bb");
    for (var i = 0; i < Math.floor(w / 22); i++)
      for (var j = 0; j < Math.floor(h / 22); j++)
        px(g, x + 4 + i * 22, y + 6 + j * 22, 18, 18, "#dde8ed");

    // mictorio, encostado na parede de cima
    px(g, x + 14, y + 8, 26, 20, "#f6f8f9", "#9fb2bb");
    px(g, x + 19, y + 12, 16, 13, "#cfe0e8");

    // pia
    px(g, x + 52, y + 8, 28, 20, "#f6f8f9", "#9fb2bb");
    px(g, x + 59, y + 13, 14, 9, "#c6d5dc");

    // cabine: paredes altas e porta fechada, so aparece quem senta la dentro
    px(g, x + 92, y + 6, 52, 62, "#cfd9de", "#9fb2bb");
    px(g, x + 95, y + 9, 46, 56, "#eef3f5");
    px(g, x + 112, y + 12, 14, 9, "#dbe6eb");
    px(g, x + 92, y + 60, 52, 8, "#b7c6cd");
    px(g, x + 138, y + 30, 3, 8, "#c9a227");

    // box de banho: piso mais escuro, chuveiro e cortina
    px(g, x + w - 58, y + 6, 52, 66, "#c4d6de", "#8ea7b2");
    px(g, x + w - 55, y + 9, 46, 60, "#d6e6ec");
    px(g, x + w - 36, y + 10, 12, 6, "#9fb2bb");
    px(g, x + w - 33, y + 16, 6, 4, "#8ea7b2");
    px(g, x + w - 58, y + 6, 9, 66, "#b6cdd6");
    // roupa dobrada esperando do lado de fora
    px(g, x + w - 78, y + 52, 16, 6, "#5b8f3f", "#3f6b2a");
    px(g, x + w - 78, y + 46, 16, 6, "#3f6b8f", "#2a4f6b");
    px(g, x + w - 75, y + 40, 10, 6, "#8a8578", "#6b6759");

    var t = txt(g, x + w / 2, y - 8, "banheiro", "m-nome");
    t.setAttribute("opacity", ".7");
  }

  function copa(g, x, y) {
    px(g, x - 52, y - 26, 104, 22, "#cfd3cc", "#a9ada6");   // bancada
    px(g, x - 44, y - 34, 14, 10, "#5a6470");                // maquina de cafe
    px(g, x - 24, y - 32, 9, 8, "#c8503f");
    px(g, x - 10, y - 32, 9, 8, "#c8503f");
    px(g,   x + 6, y - 32, 9, 8, "#c8503f");
    var t = txt(g, x, y + 8, "copa", "m-nome"); t.setAttribute("opacity", ".65");
  }
  /** Porta na parede de um setor. eixo 'h' = parede horizontal, 'v' = vertical. */
  function porta(g, x, y, eixo) {
    if (eixo === 'v') {
      px(g, x - 7, y - 26, 14, 52, "#d7dad4");          // vao aberto na parede
      px(g, x - 7, y - 26, 3, 52, "#8a5a33");
      px(g, x + 4, y - 26, 3, 52, "#8a5a33");
      px(g, x - 4, y - 2, 3, 5, "#c9a227");             // macaneta
      return;
    }
    px(g, x - 26, y - 7, 52, 14, "#d7dad4");
    px(g, x - 26, y - 7, 52, 3, "#8a5a33");
    px(g, x - 26, y + 4, 52, 3, "#8a5a33");
    px(g, x - 2, y - 4, 5, 3, "#c9a227");
  }

  /** Entrada principal: porta dupla de madeira com capacho. */
  /** Caixa de correio da entrada. O selo em cima conta as cartas nao lidas. */
  function caixaCorreio(g, x, y) {
    var c = el("g", { id: "caixa-correio", style: "cursor:pointer" });
    px(c, x - 4,  y - 6,  8,  6, "#6b6759");
    px(c, x - 16, y - 34, 32, 28, "#b8543c", "#8a3a26");
    px(c, x - 16, y - 34, 32,  7, "#c76a52");
    px(c, x - 10, y - 24, 20,  5, "#7a3322");
    px(c, x + 10, y - 44, 4,  16, "#8a8578");
    px(c, x + 13, y - 44, 9,   7, "#d9a32e");
    var selo = el("g", { id: "selo-cartas", opacity: "0" });
    px(selo, x + 4, y - 50, 22, 15, "#1c1e22");
    var n = txt(selo, x + 15, y - 39.5, "0", "c-nome");
    n.setAttribute("id", "selo-numero");
    n.setAttribute("fill", "#ffffff");
    c.appendChild(selo);
    var r = txt(c, x, y + 14, "correio", "m-nome");
    r.setAttribute("opacity", ".7");
    g.appendChild(c);
  }

  function entrada(g, x, y) {
    px(g, x - 34, y + 4, 68, 9, "#6b4326");             // capacho
    px(g, x - 32, y + 6, 64, 5, "#8a5a33");
    px(g, x - 34, y - 26, 68, 30, "#7a4720");           // batente
    px(g, x - 31, y - 23, 30, 27, "#a2632f");
    px(g, x + 1, y - 23, 30, 27, "#a2632f");
    px(g, x - 6, y - 12, 4, 6, "#e8c46a");              // macanetas
    px(g, x + 2, y - 12, 4, 6, "#e8c46a");
    var t = txt(g, x, y + 26, "entrada", "m-nome");
    t.setAttribute("opacity", ".6");
  }

  /* ---------- pessoas ---------- */

  function desenhaPessoa(camisa, cabelo, pele) {
    var g = el("g", { class:"corpo" });
    g.appendChild(el("ellipse", { cx:0, cy:0, rx:13, ry:4.5, fill:"rgba(0,0,0,.20)" }));
    var pE = el("g", { class:"pe-e" }); px(pE, -8, -18, 6, 12, "#4a515c"); px(pE, -9, -6, 8, 6, "#2b2f36");
    var pD = el("g", { class:"pe-d" }); px(pD,  2, -18, 6, 12, "#4a515c"); px(pD,  1, -6, 8, 6, "#2b2f36");
    g.appendChild(pE); g.appendChild(pD);
    // Sentado visto de cima a perna aparece encurtada e aberta, apontando para
    // frente. Sem isso o boneco virava meio corpo flutuando no sofa.
    var sent = el("g", { class: "sentado", opacity: "0" });
    px(sent, -12, -13, 8, 13, "#4a515c");
    px(sent,  -13,  0, 10,  5, "#2b2f36");
    px(sent,   4, -13, 8, 13, "#4a515c");
    px(sent,   3,  0, 10,  5, "#2b2f36");
    g.appendChild(sent);
    px(g, -12, -35, 24, 18, camisa, "rgba(0,0,0,.22)").setAttribute("class", "roupa");
    px(g, -16, -34,  4, 14, camisa).setAttribute("class", "roupa");
    px(g,  12, -34,  4, 14, camisa).setAttribute("class", "roupa");
    px(g, -16, -21,  4,  4, pele);
    px(g,  12, -21,  4,  4, pele);
    px(g,  -8, -48, 16, 13, pele);
    px(g,  -9, -51, 18,  6, cabelo);
    px(g,  -9, -48,  3,  6, cabelo);
    px(g,   6, -48,  3,  6, cabelo);
    px(g,  -5, -43,  2,  2, "#23252a");
    px(g,   3, -43,  2,  2, "#23252a");
    // xicara de cafe, escondida ate ele ir para a copa
    var xic = el("g", { class: "xicara", opacity: "0" });
    px(xic, 15, -28, 9, 8, "#f3f3ef", "#b9bdb6");
    px(xic, 24, -26, 3, 4, "#b9bdb6");
    px(xic, 16, -27, 7, 3, "#6b4326");
    px(xic, 17, -34, 2, 5, "#c9cec7").setAttribute("class", "fumaca");
    var f2 = px(xic, 21, -36, 2, 5, "#c9cec7");
    f2.setAttribute("class", "fumaca");
    f2.setAttribute("style", "animation-delay:.7s");
    g.appendChild(xic);
    // reticencias de quem esta conversando na reuniao
    var fala = el("g", { class: "fala", opacity: "0" });
    [0, 1, 2].forEach(function (i) {
      var d = px(fala, -6 + i * 6, -58, 4, 4, "#23252a");
      d.setAttribute("class", "ponto");
      d.setAttribute("style", "animation-delay:" + (i * 0.22).toFixed(2) + "s");
    });
    g.appendChild(fala);

    // Gotinhas no mictorio. Fica no registro de desenho: nada aparece alem disso.
    var gotas = el("g", { class: "gotas", opacity: "0" });
    [0, 1, 2].forEach(function (i) {
      var d = px(gotas, 10 + i * 3, -22 + i * 4, 2, 3, "#8fd4ef");
      d.setAttribute("class", "goteja");
      d.setAttribute("style", "animation-delay:" + (i * 0.18).toFixed(2) + "s");
    });
    g.appendChild(gotas);

    // Gota de esforco na cabine.
    var suor = el("g", { class: "suor", opacity: "0" });
    px(suor, 11, -52, 4, 6, "#8fd4ef").setAttribute("class", "pinga");
    g.appendChild(suor);

    // Banho: espuma cobrindo o corpo e agua caindo de cima.
    var espuma = el("g", { class: "espuma", opacity: "0" });
    [[-14, -40, 10], [-4, -46, 11], [7, -40, 10], [-13, -28, 11], [2, -26, 12], [-6, -36, 13],
     [-15, -20, 13], [3, -18, 13], [-9, -10, 14], [5, -8, 12], [-14, -4, 12], [2, -2, 13]]
      .forEach(function (b, i) {
        var o = px(espuma, b[0], b[1], b[2], b[2], "#f7fbfd");
        o.setAttribute("class", "bolha");
        o.setAttribute("style", "animation-delay:" + (i * 0.21).toFixed(2) + "s");
      });
    [-10, -2, 6].forEach(function (dx, i) {
      var a = px(espuma, dx, -62, 2, 7, "#a9dcf0");
      a.setAttribute("class", "chuva");
      a.setAttribute("style", "animation-delay:" + (i * 0.24).toFixed(2) + "s");
    });
    g.appendChild(espuma);

    return g;
  }

  /* ---------- monta a planta ---------- */

  var cChao = el("g", {}), cMoveis = el("g", {}), cGente = el("g", {});

  var estilo = el("style", {});
  estilo.textContent =
    ".s-nome{font:400 9px 'Press Start 2P',monospace;fill:#fff}" +
    ".s-sub{font:400 10px 'IBM Plex Mono',monospace;fill:#fff;opacity:.75}" +
    ".m-nome{font:400 7.5px 'Press Start 2P',monospace;fill:#23252a}" +
    ".m-nome.on{fill:#8a5a00}" +
    ".c-nome{font:400 7px 'Press Start 2P',monospace;fill:#fff}" +
    ".b-nome{font:400 11px 'IBM Plex Sans',sans-serif;fill:#23252a}" +
    "@keyframes respira{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.2px)}}" +
    ".corpo{animation:respira 2.6s ease-in-out infinite}" +
    // Tela so acende na mesa ocupada. Vazia, o monitor fica apagado.
    ".tela,.tela-larga,.barra,.luz-rack,.cursor{transition:fill .3s}" +
    ".cursor{opacity:0}" +
    "@keyframes brilho{0%,100%{fill:#a9d9f2}50%{fill:#d8f0ff}}" +
    "@keyframes cursor{0%,45%{opacity:1}50%,100%{opacity:0}}" +
    "@keyframes carrega{0%,100%{fill:#27304a}35%{fill:#7fe3c4}}" +
    "@keyframes pulsa{0%,100%{fill:#7fe3c4}50%{fill:#b6f5e0}}" +
    "@keyframes pisca{0%,60%{opacity:1}70%,100%{opacity:.25}}" +
    ".ocupada .tela{animation:brilho 2.2s ease-in-out infinite}" +
    ".ocupada .tela-b{animation-delay:.9s}" +
    ".ocupada .cursor{animation:cursor 1s steps(1) infinite}" +
    ".ocupada .tela-larga{animation:pulsa 1.8s ease-in-out infinite}" +
    ".ocupada .barra{animation:carrega 1.1s ease-in-out infinite}" +
    ".ocupada .luz-rack{animation:pisca .9s steps(1) infinite}" +
    // Copa e reuniao
    "@keyframes sobe{0%{opacity:.7;transform:translateY(0)}100%{opacity:0;transform:translateY(-6px)}}" +
    ".fumaca{animation:sobe 1.8s ease-out infinite}" +
    "@keyframes conversa{0%,100%{opacity:.25}50%{opacity:1}}" +
    ".ponto{animation:conversa 1.3s ease-in-out infinite}" +
    "@keyframes pinga{0%{opacity:0;transform:translateY(-4px)}30%{opacity:1}100%{opacity:0;transform:translateY(7px)}}" +
    ".goteja,.pinga,.chuva{animation:pinga .9s linear infinite}" +
    "@keyframes borbulha{0%,100%{opacity:.85;transform:translateY(0)}50%{opacity:1;transform:translateY(-1.5px)}}" +
    ".bolha{animation:borbulha 1.7s ease-in-out infinite}" +
    "@media(prefers-reduced-motion:reduce){.corpo,.tela,.tela-larga,.barra,.luz-rack,.cursor,.fumaca,.ponto,.goteja,.pinga,.chuva,.bolha{animation:none}}";
  chao.appendChild(estilo);

  px(cChao, 0, 0, 1240, 920, "#d7dad4");
  for (var yy = 0; yy < 920; yy += 26) px(cChao, 0, yy, 1240, 13, "#dcdfd9");

  SETORES.forEach(function (s) {
    px(cChao, s.x, s.y, s.w, s.h, s.piso, "#b0b5ac");
    px(cChao, s.x, s.y, s.w, 26, s.cor);
    txt(cChao, s.x + 14, s.y + 18, s.nome, "s-nome", "start");
    txt(cChao, s.x + s.w - 14, s.y + 18, s.sub, "s-sub", "end");
  });

  estanteVerde(cChao, 62, 706, 5, 3);
  planta(cChao, 556, 396); planta(cChao, 1112, 396);
  planta(cChao, 556, 766); planta(cChao, 862, 766);
  // Faixa de descanso, embaixo de tudo: copa, estar com sofas, banheiro e entrada.
  px(cChao, 34, 792, 1096, 118, "#e6e3dd", "#b0b5ac");
  var faixa = txt(cChao, 48, 810, "DESCANSO", "s-nome", "start");
  faixa.setAttribute("fill", "#8a8578");

  copa(cChao, 150, 878);
  sofa(cChao, 420, 862, "#5f7f9c");
  sofa(cChao, 660, 862, "#8a6f9c");
  mesinha(cChao, 540, 866);
  banheiro(cChao, 780, 800, 232, 100);
  entrada(cChao, 1060, 896);
  caixaCorreio(cChao, 980, 896);

  // Estar lateral, encostado na parede da direita.
  sofa(cChao, 1190, 240, "#7f9c6f");
  sofa(cChao, 1190, 560, "#9c7f5f");
  planta(cChao, 1190, 400);

  // Portas nas paredes que dao para os corredores.
  porta(cChao, 300, 400, 'h');    // Corretoras -> corredor do meio
  porta(cChao, 860, 400, 'h');    // Kripto -> corredor do meio
  porta(cChao, 300, 430, 'h');    // Apollo
  porta(cChao, 722, 430, 'h');    // Diretoria
  porta(cChao, 1003, 430, 'h');   // Maquinas
  porta(cChao, 587, 230, 'v');    // Corretoras <-> Kripto
  porta(cChao, 863, 600, 'v');    // Diretoria <-> Maquinas

  chao.appendChild(cChao); chao.appendChild(cMoveis); chao.appendChild(cGente);

  MESAS.forEach(function (m) {
    var g = el("g", { transform:"translate(" + m.x + "," + m.y + ")", id:"movel-" + m.id, class:"movel" });
    g.appendChild(el("rect", { x:-52, y:-44, width:104, height:96, fill:"#ffcb45", opacity:"0", id:"halo-" + m.id }));
    MOVEIS[m.tipo](g);
    var t = txt(g, 0, 52, m.nome, "m-nome");
    t.setAttribute("id", "rot-" + m.id);
    cMoveis.appendChild(g);
  });

  /* ---------- motor de caminhada ---------- */

  var reduzir = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var pessoas = {};   // id -> { g, vira, corpo, pE, pD, badge, balao, pos, anim, passo, mesa }

  function criaPessoa(id, dados) {
    var g = el("g", { });
    var vira = el("g", {});
    var corpo = desenhaPessoa(dados.cor || "#f7f8f4", dados.cabelo || "#3c2c22", dados.pele || "#e5b48a");
    vira.appendChild(corpo);
    g.appendChild(vira);

    var badge = el("g", {});
    var bf = el("rect", { x:-30, y:-72, width:60, height:15, rx:3, fill:"#1c1e22" });
    badge.appendChild(bf);
    var bt = txt(badge, 0, -61.5, dados.nome || id, "c-nome");
    g.appendChild(badge);

    var balao = el("g", { opacity:"0" });
    var kf = el("rect", { x:22, y:-54, width:150, height:22, rx:4, fill:"#fff", stroke:"#23252a", "stroke-width":"2" });
    balao.appendChild(kf);
    var kt = txt(balao, 30, -39.5, "", "b-nome", "start");
    g.appendChild(balao);

    cGente.appendChild(g);

    var p = {
      g:g, vira:vira, corpo:corpo, badge:badge, badgeFundo:bf, badgeTxt:bt,
      balao:balao, balaoFundo:kf, balaoTxt:kt,
      pE:corpo.querySelector(".pe-e"), pD:corpo.querySelector(".pe-d"),
      xicara:corpo.querySelector(".xicara"), fala:corpo.querySelector(".fala"),
      sentado:corpo.querySelector(".sentado"),
      roupa:corpo.querySelectorAll(".roupa"),
      corCamisa:(dados.cor || "#f7f8f4"), corPele:(dados.pele || "#e5b48a"),
      gotas:corpo.querySelector(".gotas"), suor:corpo.querySelector(".suor"),
      espuma:corpo.querySelector(".espuma"),
      pos:{ x:CAFE.x, y:CAFE.y }, anim:null, passo:null, mesa:null
    };
    g.setAttribute("transform", "translate(" + CAFE.x + "," + CAFE.y + ")");
    corpo.style.animationDelay = (Math.random() * 2.4).toFixed(2) + "s";
    pessoas[id] = p;
    return p;
  }

  function ajustaBadge(p, nome) {
    p.badgeTxt.textContent = nome;
    var l = 40;
    try { l = p.badgeTxt.getComputedTextLength(); } catch (e) { l = nome.length * 7; }
    var w = Math.max(46, l + 14);
    p.badgeFundo.setAttribute("width", w);
    p.badgeFundo.setAttribute("x", -w / 2);
  }

  function ajustaBalao(p, texto) {
    if (p.balaoTimer) { clearTimeout(p.balaoTimer); p.balaoTimer = null; }
    if (!texto) { p.balao.setAttribute("opacity", "0"); return; }
    var curto = texto.length > 40 ? texto.slice(0, 39) + "…" : texto;
    p.balaoTxt.textContent = curto;
    var l = 100;
    try { l = p.balaoTxt.getComputedTextLength(); } catch (e) { l = curto.length * 6; }
    var w = Math.max(60, l + 18);
    p.balaoFundo.setAttribute("width", w);
    // Perto da borda direita o balao abre para a esquerda, senao sai da tela.
    var paraEsquerda = p.pos.x > 860;
    p.balaoFundo.setAttribute("x", paraEsquerda ? -(22 + w) : 22);
    p.balaoTxt.setAttribute("x", paraEsquerda ? -(14 + w) : 30);
    p.balao.setAttribute("opacity", "1");
    // Com varios falando junto a tela vira sopa de letrinha. O balao e um aviso
    // momentaneo; o texto inteiro fica no painel de baixo.
    p.balaoTimer = setTimeout(function () { p.balao.setAttribute("opacity", "0"); }, 9000);
  }

  // Corredor horizontal entre a fileira de cima e a de baixo. Quem troca de
  // setor passa por ele, em vez de cortar as mesas na diagonal.
  var CORREDOR_Y = 414;
  var VELOCIDADE = 105;          // pixels por segundo: passo de gente, nao de foguete
  var PASSO = 19;                // distancia entre uma pernada e outra

  /** Pontos por onde a pessoa passa ate chegar na mesa. */
  var CORREDOR_BAIXO_Y = 812;   // faixa de descanso
  var VAO_X = 587;              // unico vao que atravessa o predio de cima a baixo

  function rota(de, para, mesmoSetor) {
    var deFundo = de.y > 780, paraFundo = para.y > 780;
    if (deFundo && paraFundo) return [{ x: para.x, y: de.y }, para];
    if (mesmoSetor && !deFundo && !paraFundo) return [{ x: de.x, y: para.y }, para];
    // Entre os setores e a faixa de baixo so da para passar pelo vao do meio.
    if (deFundo !== paraFundo) {
      return deFundo
        ? [{ x: VAO_X, y: de.y }, { x: VAO_X, y: CORREDOR_Y }, { x: para.x, y: CORREDOR_Y }, para]
        : [{ x: de.x, y: CORREDOR_Y }, { x: VAO_X, y: CORREDOR_Y },
           { x: VAO_X, y: CORREDOR_BAIXO_Y }, { x: para.x, y: CORREDOR_BAIXO_Y }, para];
    }
    return [{ x: de.x, y: CORREDOR_Y }, { x: para.x, y: CORREDOR_Y }, para];
  }

  /**
   * Ronda de quem nao esta trabalhando. Nao e enfeite: a pessoa so entra aqui
   * depois de passar do OCIOSO_MS sem mexer em nada, entao circular pelo cafe,
   * pelo sofa e pelo banheiro e a leitura honesta de "nao tem trabalho agora".
   */
  function pararRonda(p) { if (p.ronda) { clearTimeout(p.ronda); p.ronda = null; } }

  function ronda(p) {
    pararRonda(p);
    function proximo() {
      if (!p.ocioso) return;
      var d = DESCANSOS[Math.floor(Math.random() * DESCANSOS.length)];
      var x = d.x + (Math.random() * 28 - 14);
      var viagem = Math.hypot(x - p.pos.x, d.y - p.pos.y) / VELOCIDADE * 1000 + 400;
      pose(p, "anda");                       // enquanto anda, fica de pe
      andar(p, x, d.y, false);
      setTimeout(function () { if (p.ocioso) { pose(p, d.pose); ajustaBalao(p, d.texto); } }, viagem);
      p.ronda = setTimeout(proximo, viagem + 9000 + Math.random() * 11000);
    }
    p.ronda = setTimeout(proximo, 400);
  }

  function parar(p, x, y) {
    p.pos = { x: x, y: y };
    p.g.setAttribute("transform", "translate(" + x + "," + y + ")");
    p.pE.setAttribute("transform", "translate(0,0)");
    p.pD.setAttribute("transform", "translate(0,0)");
  }

  function andar(p, ax, ay, mesmoSetor) {
    if (p.anim) cancelAnimationFrame(p.anim);
    var de = { x: p.pos.x, y: p.pos.y };
    if (reduzir || Math.hypot(ax - de.x, ay - de.y) < 2) { parar(p, ax, ay); return; }

    var pontos = [de].concat(rota(de, { x: ax, y: ay }, mesmoSetor));
    var segs = [], total = 0;
    for (var i = 1; i < pontos.length; i++) {
      var d = Math.hypot(pontos[i].x - pontos[i - 1].x, pontos[i].y - pontos[i - 1].y);
      segs.push(d); total += d;
    }
    if (total < 1) { parar(p, ax, ay); return; }

    var dur = (total / VELOCIDADE) * 1000;
    var t0 = performance.now();

    (function frame(agora) {
      var t = Math.min(1, (agora - t0) / dur);
      var e = t * t * (3 - 2 * t);                 // acelera e freia de leve nas pontas
      var percorrido = e * total;

      var acc = 0, idx = 0;
      while (idx < segs.length - 1 && acc + segs[idx] < percorrido) { acc += segs[idx]; idx++; }
      var f = segs[idx] > 0 ? (percorrido - acc) / segs[idx] : 1;
      var a = pontos[idx], b = pontos[idx + 1];
      var nx = a.x + (b.x - a.x) * f;
      var ny = a.y + (b.y - a.y) * f;

      if (Math.abs(b.x - a.x) > 2) p.vira.setAttribute("transform", b.x < a.x ? "scale(-1,1)" : "scale(1,1)");

      // Pernas e quique amarrados na distancia andada, nao no relogio: o passo
      // acompanha a velocidade em vez de patinar.
      var pernada = Math.floor(percorrido / PASSO) % 2 === 0;
      p.pE.setAttribute("transform", pernada ? "translate(0,0)" : "translate(3,0)");
      p.pD.setAttribute("transform", pernada ? "translate(-3,0)" : "translate(0,0)");
      var quique = t < 1 ? Math.abs(Math.sin(percorrido / (PASSO / Math.PI))) * 1.6 : 0;

      p.pos.x = nx; p.pos.y = ny;
      p.g.setAttribute("transform", "translate(" + nx.toFixed(1) + "," + (ny - quique).toFixed(1) + ")");

      if (t < 1) p.anim = requestAnimationFrame(frame);
      else parar(p, ax, ay);
    })(t0);
  }

  /** Poses: sentado na reuniao, cafe na copa, de pe no resto. */
  function pose(p, nome) {
    // Sentado: na reuniao, no sofa ou na cabine, as pernas somem.
    var sentado = nome === "reuniao" || nome === "sofa" || nome === "cabine";
    p.pE.setAttribute("opacity", sentado ? "0" : "1");
    p.pD.setAttribute("opacity", sentado ? "0" : "1");
    // A cabine tapa as pernas; no sofa e na reuniao elas aparecem dobradas.
    if (p.sentado) p.sentado.setAttribute("opacity", sentado && nome !== "cabine" ? "1" : "0");
    if (p.fala)   p.fala.setAttribute("opacity",   nome === "reuniao" || nome === "cabine" ? "1" : "0");
    if (p.xicara) p.xicara.setAttribute("opacity", nome === "copa" ? "1" : "0");
    if (p.gotas)  p.gotas.setAttribute("opacity",  nome === "mijar" ? "1" : "0");
    if (p.suor)   p.suor.setAttribute("opacity",   nome === "cabine" ? "1" : "0");
    var noBanho = nome === "banho";
    if (p.espuma) p.espuma.setAttribute("opacity", noBanho ? "1" : "0");
    // Tirou a roupa: a camisa vira pele e as pernas somem atras da espuma, que
    // cobre do ombro ao chao. Nao da para mostrar mais do que ombro e cabeca.
    if (p.roupa) for (var i = 0; i < p.roupa.length; i++)
      p.roupa[i].setAttribute("fill", noBanho ? p.corPele : p.corCamisa);
    if (noBanho) {
      p.pE.setAttribute("opacity", "0");
      p.pD.setAttribute("opacity", "0");
      if (p.sentado) p.sentado.setAttribute("opacity", "0");
    }
  }

  // Duas falas curtas, uma de cada lado. So acontece entre quem esta ocioso:
  // quem esta na mesa trabalhando nao para para bater papo.
  var PAPOS = [
    ["e aí, tudo certo?", "tudo, e você?"],
    ["viu a fila de leads?", "vi, tá cheia hoje"],
    ["já almoçou?", "tô indo agora"],
    ["o deploy subiu?", "subiu, sem cair nada"],
    ["café?", "bora"],
    ["tá tranquilo por aí?", "tranquilo, sem alerta"],
    ["a Meta tá lenta hoje", "o cache segura"]
  ];
  var PERTO = 90;
  var conversando = {};

  function puxarConversa(a, b) {
    var papo = PAPOS[Math.floor(Math.random() * PAPOS.length)];
    conversando[a.quem] = conversando[b.quem] = true;
    ajustaBalao(a, papo[0]);
    setTimeout(function () { ajustaBalao(b, papo[1]); }, 1900);
    setTimeout(function () { delete conversando[a.quem]; delete conversando[b.quem]; }, 26000);
  }

  function olharEmVolta() {
    var lista = [];
    Object.keys(pessoas).forEach(function (id) {
      var p = pessoas[id];
      if (p.ocioso && !conversando[id]) { p.quem = id; lista.push(p); }
    });
    for (var i = 0; i < lista.length; i++)
      for (var j = i + 1; j < lista.length; j++) {
        var a = lista[i], b = lista[j];
        if (conversando[a.quem] || conversando[b.quem]) continue;
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < PERTO) puxarConversa(a, b);
      }
  }
  var relogioConversa = setInterval(olharEmVolta, 3000);

  function acendeMesas(ocupadas) {
    MESAS.forEach(function (m) {
      var h = document.getElementById("halo-" + m.id);
      var r = document.getElementById("rot-" + m.id);
      var g = document.getElementById("movel-" + m.id);
      var on = ocupadas[m.id];
      if (h) h.setAttribute("opacity", on ? ".22" : "0");
      if (r) r.setAttribute("class", on ? "m-nome on" : "m-nome");
      // A classe e o que faz a tela acender, o cursor piscar e as barras correrem.
      if (g) g.setAttribute("class", on ? "movel ocupada" : "movel");
    });
  }

  /* ---------- paineis ---------- */

  function hora(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });
  }

  function pintaPaineis(lista) {
    var ul = document.getElementById("equipe");
    ul.textContent = "";
    if (!lista.length) {
      var v = document.createElement("li"); v.className = "nada";
      v.textContent = "Ninguém no escritório."; ul.appendChild(v);
      document.getElementById("f-quem").textContent = "Escritório vazio";
      document.getElementById("f-mesa").textContent = "Ninguém trabalhando agora.";
      document.getElementById("f-arquivo").textContent = "nenhum arquivo aberto";
      document.getElementById("f-quando").textContent = "";
      return;
    }

    lista.forEach(function (d) {
      var ocioso = d.em ? (Date.now() - new Date(d.em).getTime()) > OCIOSO_MS : false;
      var mesa = ocioso ? null : mesaPorId[d.mesa];
      var li = document.createElement("li");
      var i = document.createElement("i"); i.style.background = d.cor || "#f7f8f4";
      var box = document.createElement("div"); box.className = "quem";
      var b = document.createElement("b"); b.textContent = d.nome || d.id;
      var e = document.createElement("em"); e.textContent = d.acao || (d.papel || "sem tarefa");
      box.appendChild(b); box.appendChild(e);
      var o = document.createElement("span"); o.className = "onde";
      o.textContent = mesa ? mesa.nome : "copa";
      li.appendChild(i); li.appendChild(box); li.appendChild(o);
      ul.appendChild(li);
    });

    var topo = lista[0];
    var mesaTopo = mesaPorId[topo.mesa];
    document.getElementById("f-quem").textContent = (topo.nome || topo.id);
    document.getElementById("f-mesa").textContent =
      (mesaTopo ? mesaTopo.nome + " · " + setorPorId[mesaTopo.setor].nome.toLowerCase() : "copa") +
      (topo.papel ? " · " + topo.papel : "");
    document.getElementById("f-arquivo").textContent = topo.arquivo || "(sem arquivo)";
    document.getElementById("f-quando").textContent = topo.em ? "às " + hora(topo.em) : "";
  }

  function crachaTxt(t, viva) {
    document.getElementById("cracha-txt").textContent = t;
    document.getElementById("luz").className = viva ? "luz viva" : "luz";
  }

  /* ---------- sincroniza com o db ---------- */

  function sincroniza(docs) {
    var vistos = {}, ocupadas = {}, porMesa = {};

    docs.forEach(function (d) { if (d.mesa) (porMesa[d.mesa] = porMesa[d.mesa] || []).push(d.id); });

    docs.forEach(function (d) {
      vistos[d.id] = true;
      var p = pessoas[d.id] || criaPessoa(d.id, d);
      var continuar = true;
      ajustaBadge(p, d.nome || d.id);
      if (p.acaoAnterior !== d.acao) { ajustaBalao(p, d.acao); p.acaoAnterior = d.acao; }
      // Quem nao mexe em nada ha 10 minutos vai para a copa. Nao e enfeite: e a
      // forma honesta de mostrar que ninguem esta trabalhando naquela mesa.
      var parado = d.em ? (Date.now() - new Date(d.em).getTime()) > OCIOSO_MS : false;
      var mesa = parado ? null : mesaPorId[d.mesa];
      var alvoX, alvoY;
      if (mesa) {
        ocupadas[mesa.id] = true;
        var fila = porMesa[d.mesa] || [d.id];
        var i = fila.indexOf(d.id);
        var desloca = (i - (fila.length - 1) / 2) * 58;   // 58px: menos que isso e os crachas se sobrepoem
        alvoX = mesa.x + desloca;
        // Na reuniao ele senta encostado na mesa; no resto fica no corredor.
        alvoY = mesa.y + (mesa.tipo === "reuniao" ? 44 : 76);
      }

      if (!mesa) {
        // Ocioso: entra na ronda e nao volta para a posicao fixa.
        if (!p.ocioso) { p.ocioso = true; ronda(p); }
        continuar = false;
      } else {
        if (p.ocioso) { p.ocioso = false; pararRonda(p); }
        pose(p, mesa.tipo);
      }
      if (continuar && (p.mesa !== d.mesa || Math.abs(p.pos.x - alvoX) > 3)) {
        var setorAnterior = mesaPorId[p.mesa] ? mesaPorId[p.mesa].setor : null;
        andar(p, alvoX, alvoY, Boolean(mesa) && setorAnterior === mesa.setor);
        p.mesa = d.mesa;
      }
    });

    Object.keys(pessoas).forEach(function (id) {
      if (!vistos[id]) { pararRonda(pessoas[id]); cGente.removeChild(pessoas[id].g); delete pessoas[id]; }
    });

    acendeMesas(ocupadas);
    pintaPaineis(docs);
  }

  /* ---------- legenda ---------- */

  var caixa = document.getElementById("setores");
  SETORES.forEach(function (s) {
    var span = document.createElement("span");
    var i = document.createElement("i"); i.style.background = s.cor;
    span.appendChild(i); span.appendChild(document.createTextNode(s.nome));
    caixa.appendChild(span);
  });
  /* ---------- fronteira com o React ---------- */

  // A pagina entrega os agentes prontos; o motor so desenha.
  function aplicar(dados) {
    var pessoas = (dados && dados.pessoas) || [];
    sincroniza(pessoas);
    crachaTxt(pessoas.length ? "AO VIVO · " + pessoas.length + " NO ESCRITORIO" : "AO VIVO · VAZIO", true);
    var selo = document.getElementById("selo-cartas");
    var numero = document.getElementById("selo-numero");
    var n = (dados && dados.naoLidas) || 0;
    if (selo) selo.setAttribute("opacity", n > 0 ? "1" : "0");
    if (numero) numero.textContent = n > 99 ? "99+" : String(n);
  }

  function aoClicarCorreio(fn) {
    var c = document.getElementById("caixa-correio");
    if (c) c.addEventListener("click", fn);
  }

  function destruir() {
    // Mata tudo que ficou agendado: sem isso, sair da pagina deixa timer vivo.
    Object.keys(pessoas).forEach(function (id) {
      pararRonda(pessoas[id]);
      if (pessoas[id].anim) cancelAnimationFrame(pessoas[id].anim);
      if (pessoas[id].balaoTimer) clearTimeout(pessoas[id].balaoTimer);
    });
    clearInterval(relogioConversa);
    raiz.textContent = "";
  }

  crachaTxt("CONECTANDO", false);
  return { aplicar: aplicar, aoClicarCorreio: aoClicarCorreio, destruir: destruir };
}
