export const EXPORT_COLUMNS = [
  'source_rank', 'source_title', 'source_image_url', 'candidate_no',
  'candidate_image_url', 'candidate_1688_url', 'candidate_title',
  'candidate_price_cny', 'candidate_moq', 'candidate_sales',
  'supplier_name', 'supplier_city', 'similar_total', 'status',
];

export function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"' && value === '') quoted = true;
    else if (character === ',') { row.push(value); value = ''; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value); value = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else value += character;
  }
  if (quoted) throw new Error('CSV 引号未闭合。');
  row.push(value);
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

function xmlDocument(bytes, path) {
  if (!bytes) throw new Error(`Excel 缺少 ${path}。`);
  const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error(`Excel 的 ${path} 无法解析。`);
  return document;
}

function localElements(node, name) {
  return [...node.getElementsByTagNameNS('*', name)];
}

function zipPath(from, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function columnIndex(reference) {
  const letters = /^[A-Z]+/i.exec(reference)?.[0] || '';
  let number = 0;
  for (const letter of letters.toUpperCase()) number = number * 26 + letter.charCodeAt(0) - 64;
  return number - 1;
}

export function parseXlsx(buffer, unzipSync) {
  if (typeof unzipSync !== 'function') throw new Error('Excel 解析组件未加载。');
  const zip = unzipSync(new Uint8Array(buffer));
  const workbook = xmlDocument(zip['xl/workbook.xml'], '工作簿');
  const firstSheet = localElements(workbook, 'sheet')[0];
  if (!firstSheet) throw new Error('Excel 没有工作表。');
  const relationshipId = firstSheet.getAttribute('r:id') || firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const relationships = xmlDocument(zip['xl/_rels/workbook.xml.rels'], '工作表关系');
  const relationship = localElements(relationships, 'Relationship').find((item) => item.getAttribute('Id') === relationshipId);
  if (!relationship) throw new Error('找不到第一个 Excel 工作表。');
  const sheetPath = zipPath('xl/workbook.xml', relationship.getAttribute('Target') || '');
  const sheet = xmlDocument(zip[sheetPath], sheetPath);
  const strings = zip['xl/sharedStrings.xml']
    ? localElements(xmlDocument(zip['xl/sharedStrings.xml'], '共享字符串'), 'si').map((item) => localElements(item, 't').map((text) => text.textContent || '').join(''))
    : [];
  return localElements(sheet, 'row').map((row) => {
    const cells = [];
    for (const cell of localElements(row, 'c')) {
      const position = columnIndex(cell.getAttribute('r') || '');
      if (position < 0 || position > 100) continue;
      let value = localElements(cell, 'v')[0]?.textContent || '';
      if (cell.getAttribute('t') === 's') value = strings[Number(value)] || '';
      else if (cell.getAttribute('t') === 'inlineStr') value = localElements(cell, 't').map((item) => item.textContent || '').join('');
      cells[position] = value;
    }
    return cells;
  }).filter((row) => row.some((cell) => String(cell || '').trim()));
}

export function normalizeSources(table) {
  if (!Array.isArray(table) || table.length < 2) throw new Error('文件没有商品数据。');
  const headers = table[0].map((value) => String(value || '').trim().toLowerCase());
  const rankColumn = headers.indexOf('rank');
  const titleColumn = headers.indexOf('product_name') >= 0 ? headers.indexOf('product_name') : headers.indexOf('title');
  const imageColumn = headers.indexOf('image');
  if ([rankColumn, titleColumn, imageColumn].some((index) => index < 0)) throw new Error('表头必须包含 rank、product_name（或 title）、image。');
  const entries = table.slice(1).filter((row) => row.some((cell) => String(cell || '').trim()));
  if (entries.length > 1000) throw new Error('一次最多导入 1000 条，请拆分文件。');
  const usedRanks = new Set();
  return entries.map((row, index) => {
    const source_rank = String(row[rankColumn] || '').trim();
    const source_title = String(row[titleColumn] || '').trim();
    const source_image_url = String(row[imageColumn] || '').trim();
    const rowNumber = index + 2;
    if (!source_rank || !source_title || !source_image_url) throw new Error(`第 ${rowNumber} 行缺少 rank、标题或 image。`);
    if (usedRanks.has(source_rank)) throw new Error(`rank ${source_rank} 重复，请先整理输入文件。`);
    usedRanks.add(source_rank);
    let url;
    try { url = new URL(source_image_url); } catch { throw new Error(`第 ${rowNumber} 行的图片链接无效。`); }
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.tiktokcdn-eu.com')) {
      throw new Error(`第 ${rowNumber} 行的图片域名 ${url.hostname || '未知'} 暂未授权。`);
    }
    return { source_rank, source_title, source_image_url: url.href, status: '待处理', candidates: [], similarTotal: 0, error: '' };
  });
}

function supplied(value) {
  const text = String(value ?? '').trim();
  return text || '未提供';
}

export function exportRows(rows) {
  return rows.flatMap((source) => {
    const base = {
      source_rank: source.source_rank,
      source_title: source.source_title,
      source_image_url: source.source_image_url,
    };
    if (source.status === '无' || !source.candidates?.length) {
      return [{ ...base, candidate_no: '', candidate_image_url: '', candidate_1688_url: '', candidate_title: '', candidate_price_cny: '', candidate_moq: '', candidate_sales: '', supplier_name: '', supplier_city: '', similar_total: source.status === '无' ? 0 : '', status: source.status }];
    }
    return source.candidates.slice(0, 5).map((item, index) => ({
      ...base,
      candidate_no: index + 1,
      candidate_image_url: supplied(item.image_url),
      candidate_1688_url: supplied(item.detail_url),
      candidate_title: supplied(item.title),
      candidate_price_cny: supplied(item.price?.display?.replace(/[¥￥]/g, '')),
      candidate_moq: supplied(item.minimum_order),
      candidate_sales: supplied(item.sales),
      supplier_name: supplied(item.supplier_name),
      supplier_city: supplied(item.supplier_city),
      similar_total: source.similarTotal,
      status: source.status,
    }));
  });
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows) {
  return '\uFEFF' + [EXPORT_COLUMNS.join(','), ...rows.map((row) => EXPORT_COLUMNS.map((column) => csvCell(row[column])).join(','))].join('\r\n');
}

export function toZip(rows, fflate) {
  if (typeof fflate?.zipSync !== 'function' || typeof fflate?.strToU8 !== 'function') throw new Error('ZIP 组件未加载。');
  return fflate.zipSync({
    'storesnapper-muse.csv': fflate.strToU8(toCsv(rows)),
    'storesnapper-muse.json': fflate.strToU8(JSON.stringify(rows, null, 2)),
    'storesnapper-muse.html': fflate.strToU8(toHtml(rows)),
  }, { level: 6 });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function safeHttps(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}

export function toHtml(rows) {
  const cards = rows.map((row) => {
    const sourceImage = safeHttps(row.source_image_url);
    const candidateImage = safeHttps(row.candidate_image_url);
    const offerUrl = safeHttps(row.candidate_1688_url);
    const image = (url, label) => url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy" referrerpolicy="no-referrer"></a>` : '<span>无图片</span>';
    return `<article><div class="images">${image(sourceImage, '原图')}${image(candidateImage, '候选图')}</div><div><strong>${escapeHtml(row.source_rank)} · ${escapeHtml(row.source_title)}</strong><p>状态：${escapeHtml(row.status)}　候选 ${escapeHtml(row.candidate_no || '无')} / 相似总数 ${escapeHtml(row.similar_total)}</p><p>${offerUrl ? `<a href="${escapeHtml(offerUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.candidate_title)}</a>` : escapeHtml(row.candidate_title || '无候选')}</p><p>价格：${escapeHtml(row.candidate_price_cny)} 元　起批：${escapeHtml(row.candidate_moq)}　销量：${escapeHtml(row.candidate_sales)}</p><p>供应商：${escapeHtml(row.supplier_name)}　城市：${escapeHtml(row.supplier_city)}</p></div></article>`;
  }).join('\n');
  return `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StoreSnapper Muse 结果</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:1100px;margin:auto;padding:20px;background:#f7faf9;color:#20312f}article{display:grid;grid-template-columns:220px 1fr;gap:16px;margin:12px 0;padding:12px;background:#fff;border:1px solid #ddd;border-radius:10px}.images{display:flex;gap:6px}.images img{width:104px;height:104px;object-fit:contain}p{margin:6px 0;overflow-wrap:anywhere}a{color:#0b6d62}@media(max-width:600px){article{grid-template-columns:1fr}}</style></head><body><h1>StoreSnapper Muse 结果</h1><p>缩略图从原始图片链接加载，需要网络；请以 CSV/JSON 中的 URL 字段为准。</p>${cards}</body></html>`;
}
