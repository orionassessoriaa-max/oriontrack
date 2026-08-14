// Gera o mapa do Brasil pre-projetado usado pela sala imersiva do comercial.
//
// O geojson bruto tem 3,3 MB e 85 mil pontos, o que trava a rotacao continua da
// cabine. Aqui ele vira paths SVG ja projetados, simplificados por
// Douglas-Peucker, com centroide por estado e os parametros de projecao para o
// cliente posicionar os pinos de DDD sem refazer conta de geografia.
//
// Uso: node scripts/build-brazil-map.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = resolve('public/brazil-states.geojson');
const TARGET = resolve('public/brazil-map.json');

const VIEW_WIDTH = 1000;
// Tolerancia da simplificacao em unidades do viewBox. 0.55 mantem o contorno
// reconhecivel de cada estado e derruba ~97% dos pontos.
const TOLERANCE = 0.55;
// Ilhas menores que isso somem no tamanho em que o mapa e exibido.
const MIN_RING_AREA = 1.5;

const REGIONS = {
  Norte: ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'],
  Nordeste: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'Centro-Oeste': ['DF', 'GO', 'MT', 'MS'],
  Sudeste: ['ES', 'MG', 'RJ', 'SP'],
  Sul: ['PR', 'RS', 'SC'],
};

function regionForState(sigla) {
  for (const [region, states] of Object.entries(REGIONS)) {
    if (states.includes(sigla)) return region;
  }
  return 'Brasil';
}

function ringsOf(feature) {
  const polygons =
    feature.geometry.type === 'MultiPolygon'
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];
  return polygons.flat();
}

function perpendicularDistance(point, start, end) {
  const [px, py] = point;
  const [sx, sy] = start;
  const [ex, ey] = end;
  const dx = ex - sx;
  const dy = ey - sy;
  if (dx === 0 && dy === 0) return Math.hypot(px - sx, py - sy);
  const t = ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (sx + clamped * dx), py - (sy + clamped * dy));
}

// Douglas-Peucker iterativo: a versao recursiva estoura a pilha nos aneis de
// litoral, que passam de 10 mil pontos.
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDistance = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistance(points[i], points[first], points[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (index !== -1 && maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function ringArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    area += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(area / 2);
}

function ringCentroid(points) {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const cross = points[j][0] * points[i][1] - points[i][0] * points[j][1];
    twiceArea += cross;
    x += (points[j][0] + points[i][0]) * cross;
    y += (points[j][1] + points[i][1]) * cross;
  }
  if (!twiceArea) return points[0];
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

const geojson = JSON.parse(readFileSync(SOURCE, 'utf8'));

let minLon = Infinity;
let maxLon = -Infinity;
let minLat = Infinity;
let maxLat = -Infinity;
for (const feature of geojson.features) {
  for (const ring of ringsOf(feature)) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
}

// Equirretangular com correcao de cosseno na latitude media, senao o Brasil sai
// esticado na horizontal.
const midLat = (minLat + maxLat) / 2;
const lonScale = Math.cos((midLat * Math.PI) / 180);
const spanX = (maxLon - minLon) * lonScale;
const spanY = maxLat - minLat;
const scale = VIEW_WIDTH / spanX;
const viewHeight = Number((spanY * scale).toFixed(2));

const kx = lonScale * scale;
const ox = -minLon * lonScale * scale;
const ky = -scale;
const oy = maxLat * scale;

function project([lon, lat]) {
  return [lon * kx + ox, lat * ky + oy];
}

function round(value) {
  return Number(value.toFixed(1));
}

const states = [];
let keptPoints = 0;
let sourcePoints = 0;

for (const feature of geojson.features) {
  const sigla = feature.properties.sigla;
  const rings = ringsOf(feature).map((ring) => ring.map(project));
  sourcePoints += rings.reduce((total, ring) => total + ring.length, 0);

  const simplified = rings
    .map((ring) => simplify(ring, TOLERANCE))
    .filter((ring) => ring.length >= 4)
    .map((ring) => ({ ring, area: ringArea(ring) }))
    .sort((a, b) => b.area - a.area);

  if (!simplified.length) throw new Error(`Estado ${sigla} ficou sem geometria apos a simplificacao.`);

  // O maior anel sempre fica, mesmo que o estado seja pequeno.
  const usable = simplified.filter((item, index) => index === 0 || item.area >= MIN_RING_AREA);
  keptPoints += usable.reduce((total, item) => total + item.ring.length, 0);

  const path = usable
    .map(({ ring }) => `M${ring.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`)
    .join('');
  const [cx, cy] = ringCentroid(usable[0].ring);

  states.push({
    sigla,
    nome: feature.properties.name,
    regiao: regionForState(sigla),
    path,
    cx: round(cx),
    cy: round(cy),
  });
}

states.sort((a, b) => a.sigla.localeCompare(b.sigla));

const output = {
  width: VIEW_WIDTH,
  height: viewHeight,
  // x = lon * kx + ox | y = lat * ky + oy
  projection: {
    kx: Number(kx.toFixed(6)),
    ox: Number(ox.toFixed(6)),
    ky: Number(ky.toFixed(6)),
    oy: Number(oy.toFixed(6)),
  },
  states,
};

writeFileSync(TARGET, JSON.stringify(output));

const sizeKb = (Buffer.byteLength(JSON.stringify(output)) / 1024).toFixed(1);
console.log(`estados: ${states.length}`);
console.log(`pontos: ${sourcePoints} -> ${keptPoints}`);
console.log(`viewBox: 0 0 ${VIEW_WIDTH} ${viewHeight}`);
console.log(`saida: public/brazil-map.json (${sizeKb} KB)`);
