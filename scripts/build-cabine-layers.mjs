// Separa o chaveiro do Kripto Hunters da arte da cabine, para ele poder
// balancar por cima da cena em vez de ficar chapado no fundo.
//
// Entrada:  public/sala-cabine.png
// Saidas:   public/sala-cabine-base.png      cabine sem o chaveiro
//           public/sala-cabine-chaveiro.png  so o chaveiro, com alfa
//
// Uso: node scripts/build-cabine-layers.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { resolve } from 'node:path';

const SOURCE = resolve('public/sala-cabine.png');
const BASE_OUT = resolve('public/sala-cabine-base.png');
const TAG_OUT = resolve('public/sala-cabine-chaveiro.png');

// Retangulo que contem argola, corrente e plaqueta, medido na arte 1672x941.
const CUT = { x0: 958, y0: 0, x1: 1078, y1: 250 };
// Diferenca de canal, contra o fundo reconstruido, que ja conta como chaveiro.
const ALPHA_FULL = 26;
// Manchas menores que isso sao estrelas do ceu, nao o chaveiro.
const MIN_BLOB = 40;

// ---------- PNG ----------

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('so bitDepth 8');
      colorType = data[9];
      if (data[12] !== 0) throw new Error('entrelacado nao suportado');
    }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`colorType ${colorType} nao suportado`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? out[i - channels] : 0;
      const b = prior ? prior[i] : 0;
      const c = prior && i >= channels ? prior[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = value & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i += 1) {
    rgba[j++] = pixels[i * channels];
    rgba[j++] = pixels[i * channels + 1];
    rgba[j++] = pixels[i * channels + 2];
    rgba[j++] = channels === 4 ? pixels[i * channels + 3] : 255;
  }
  return { width, height, data: rgba };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- separacao ----------

const src = decodePng(readFileSync(SOURCE));
const { width, height } = src;
const cutW = CUT.x1 - CUT.x0;
const cutH = CUT.y1 - CUT.y0;

const px = (x, y) => (y * width + x) * 4;

// Fundo reconstruido: interpola cada linha entre o pixel imediatamente a
// esquerda e a direita do recorte. O ceu e o friso do aro sao horizontalmente
// uniformes, entao a emenda nao aparece.
//
// A amostra de cada lado e a MEDIANA de uma faixa, nao um pixel unico. Com um
// pixel so, bastava ele calhar de ser uma estrela para a linha inteira virar um
// rastro claro atravessando o recorte. A mediana ignora as estrelas e devolve o
// tom real do ceu naquela altura.
const SAMPLE = 15;

function medianaLateral(xInicio, passo, y) {
  const canais = [[], [], []];
  for (let i = 0; i < SAMPLE; i += 1) {
    const x = xInicio + passo * i;
    if (x < 0 || x >= width) continue;
    const p = px(x, y);
    for (let c = 0; c < 3; c += 1) canais[c].push(src.data[p + c]);
  }
  return canais.map((valores) => {
    valores.sort((a, b) => a - b);
    return valores[Math.floor(valores.length / 2)] || 0;
  });
}

// O fundo e clonado de uma faixa de ceu vizinha, na MESMA altura de cada linha.
// Preencher com interpolacao lisa devolvia um corredor sem estrela nenhuma,
// visivel no meio do campo estelar. Clonando, o trecho ganha estrelas de volta
// e a estrutura horizontal (o friso do aro) continua batendo, porque a arte e
// horizontalmente uniforme nessa faixa.
const CLONE_OFFSET = cutW + 24;

const background = Buffer.alloc(cutW * cutH * 3);
for (let y = 0; y < cutH; y += 1) {
  // A mediana das bordas serve de referencia para corrigir a diferenca de tom
  // entre a faixa clonada e o lugar de destino.
  const destino = medianaLateral(CUT.x0 - 1, -1, CUT.y0 + y);
  const origem = medianaLateral(CUT.x0 - CLONE_OFFSET, 1, CUT.y0 + y);
  for (let x = 0; x < cutW; x += 1) {
    const fonte = px(CUT.x0 - CLONE_OFFSET + x, CUT.y0 + y);
    for (let c = 0; c < 3; c += 1) {
      const ajuste = destino[c] - origem[c];
      background[(y * cutW + x) * 3 + c] = Math.max(
        0,
        Math.min(255, src.data[fonte + c] + ajuste),
      );
    }
  }
}

// Matte por diferenca: o que esta mais claro que o fundo e chaveiro.
const alpha = new Uint8Array(cutW * cutH);
for (let y = 0; y < cutH; y += 1) {
  for (let x = 0; x < cutW; x += 1) {
    const s = px(CUT.x0 + x, CUT.y0 + y);
    const b = (y * cutW + x) * 3;
    let diff = 0;
    for (let c = 0; c < 3; c += 1) {
      diff = Math.max(diff, src.data[s + c] - background[b + c]);
    }
    alpha[y * cutW + x] = Math.max(0, Math.min(255, Math.round((diff / ALPHA_FULL) * 255)));
  }
}

// Limpa o matte por forma. Duas coisas caem dentro do recorte sem ser chaveiro:
// estrelas soltas (manchas minusculas) e o friso do aro da janela, que atravessa
// a faixa como uma listra larga e baixa. As duas balancariam junto se ficassem.
const visited = new Uint8Array(cutW * cutH);
for (let start = 0; start < alpha.length; start += 1) {
  if (visited[start] || alpha[start] < 24) continue;
  const blob = [];
  const stack = [start];
  visited[start] = 1;
  let minX = cutW;
  let maxX = 0;
  let minY = cutH;
  let maxY = 0;
  while (stack.length) {
    const index = stack.pop();
    blob.push(index);
    const x = index % cutW;
    const y = (index - x) / cutW;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cutW || ny >= cutH) continue;
      const next = ny * cutW + nx;
      if (visited[next] || alpha[next] < 24) continue;
      visited[next] = 1;
      stack.push(next);
    }
  }
  const larga = maxX - minX + 1;
  const alta = maxY - minY + 1;
  const estrela = blob.length < MIN_BLOB;
  const friso = alta <= 8 && larga >= 60;
  if (estrela || friso) for (const index of blob) alpha[index] = 0;
}

// Camada do chaveiro.
const tag = Buffer.alloc(cutW * cutH * 4);
for (let y = 0; y < cutH; y += 1) {
  for (let x = 0; x < cutW; x += 1) {
    const s = px(CUT.x0 + x, CUT.y0 + y);
    const d = (y * cutW + x) * 4;
    tag[d] = src.data[s];
    tag[d + 1] = src.data[s + 1];
    tag[d + 2] = src.data[s + 2];
    tag[d + 3] = alpha[y * cutW + x];
  }
}

// Camada da cabine: onde havia chaveiro, entra fundo puro.
//
// Aqui a mascara e binaria e dilatada, nao proporcional ao matte. Apagar na
// proporcao do alfa deixava um fantasma legivel do chaveiro na base, porque nas
// partes de brilho baixo o alfa nao chegava perto de 255 e a arte original
// continuava aparecendo por baixo.
const REMOVE_RADIUS = 3;
const remove = new Uint8Array(cutW * cutH);
for (let y = 0; y < cutH; y += 1) {
  for (let x = 0; x < cutW; x += 1) {
    if (alpha[y * cutW + x] < 8) continue;
    for (let dy = -REMOVE_RADIUS; dy <= REMOVE_RADIUS; dy += 1) {
      for (let dx = -REMOVE_RADIUS; dx <= REMOVE_RADIUS; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cutW || ny >= cutH) continue;
        remove[ny * cutW + nx] = 1;
      }
    }
  }
}

const base = Buffer.from(src.data);
for (let y = 0; y < cutH; y += 1) {
  for (let x = 0; x < cutW; x += 1) {
    if (!remove[y * cutW + x]) continue;
    const d = px(CUT.x0 + x, CUT.y0 + y);
    const b = (y * cutW + x) * 3;
    for (let c = 0; c < 3; c += 1) base[d + c] = background[b + c];
  }
}

writeFileSync(BASE_OUT, encodePng({ width, height, data: base }));
writeFileSync(TAG_OUT, encodePng({ width: cutW, height: cutH, data: tag }));

const cobertos = alpha.reduce((total, value) => total + (value > 24 ? 1 : 0), 0);
console.log(`recorte: x ${CUT.x0}-${CUT.x1}, y ${CUT.y0}-${CUT.y1} (${cutW}x${cutH})`);
console.log(`pixels do chaveiro: ${cobertos}`);
console.log('posicao para o CSS, em % da arte:');
console.log(`  left   ${((CUT.x0 / width) * 100).toFixed(3)}%`);
console.log(`  top    ${((CUT.y0 / height) * 100).toFixed(3)}%`);
console.log(`  width  ${((cutW / width) * 100).toFixed(3)}%`);
console.log(`  height ${((cutH / height) * 100).toFixed(3)}%`);
