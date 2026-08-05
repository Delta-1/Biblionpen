import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const raiz = '/workspace/biblionmed';
const servidor = http.createServer((req, res) => {
  const p = path.join(raiz, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  const t = p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'text/javascript'
          : p.endsWith('.json') ? 'application/json' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': t });
  res.end(fs.readFileSync(p));
});
await new Promise(r => servidor.listen(8899, r));

let falhas = 0;
const ok = (c, n) => { console.log((c ? 'ok  ' : 'FALHOU ') + n); if (!c) falhas++; };

const nav = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pag = await nav.newPage();
const erros = [];
pag.on('pageerror', e => { erros.push(String(e)); console.log('[pageerror]', String(e).split('\n')[0]); });
pag.on('console', m => { if (m.text().startsWith('[REJEICAO]')) console.log(m.text().slice(0,300)); if (m.type()==='error') console.log('[console]', m.text().slice(0,160)); });


// Um interceptador só, olhando a URL: padrões glob não casam bem com
// subdomínios (www.gstatic.com), e aqui a regra fica explícita.
const FB_APP = 'export const initializeApp = () => ({});';
const FB_AUTH = 'export const getAuth=()=>({});export const signInAnonymously=async()=>({user:{uid:"teste"}});export const onAuthStateChanged=(a,cb)=>{cb(null);};';
const FB_FS = 'export const getFirestore=()=>({});export const doc=()=>({});export const getDoc=async()=>({exists:()=>false,data:()=>({})});export const setDoc=async()=>{};export const updateDoc=async()=>{};export const collection=()=>({});export const addDoc=async()=>{};export const onSnapshot=()=>()=>{};export const deleteDoc=async()=>{};';

const chamados = new Set();
const js = (body) => ({ contentType: 'text/javascript', body });
const json = (o) => ({ contentType: 'application/json', body: JSON.stringify(o) });

await pag.route('**/*', (rota) => {
  const u = rota.request().url();
  if (u.startsWith('http://localhost:8899')) return rota.continue();

  // CDNs: viram stub para a página conseguir subir sem rede.
  if (u.includes('cdn.tailwindcss.com')) return rota.fulfill(js('window.tailwind={config:{}};'));
  if (u.includes('firebase-app.js')) return rota.fulfill(js(FB_APP));
  if (u.includes('firebase-auth.js')) return rota.fulfill(js(FB_AUTH));
  if (u.includes('firebase-firestore.js')) return rota.fulfill(js(FB_FS));
  if (u.includes('cdnjs.cloudflare.com') || u.includes('fonts.googleapis.com')) {
    return rota.fulfill({ contentType: 'text/css', body: '' });
  }

  // Catálogos: respostas reais, no formato que eles devolvem.
  if (u.includes('gutendex.com')) {
    chamados.add('gutenberg');
    return rota.fulfill(json({ results: [{
      id: 1342, title: 'Pride and Prejudice',
      authors: [{ name: 'Austen, Jane, 1775-1817' }], languages: ['en'], copyright: false,
      formats: { 'image/jpeg': 'https://x/cover.jpg', 'text/plain; charset=us-ascii': 'https://x/1342.txt' }
    }] }));
  }
  if (u.includes('archive.org/advancedsearch')) {
    chamados.add('archive');
    return rota.fulfill(json({ response: { docs: [
      { identifier: 'prideprejudice00aust', title: 'Pride and prejudice (edição de 1918)',
        creator: 'Austen, Jane', year: 1918, language: 'English' }
    ] } }));
  }
  if (u.includes('wikisource.org')) {
    chamados.add('wikisource');
    return rota.fulfill(json({ query: { search: [{ pageid: 99, title: 'Orgulho e Preconceito' }] } }));
  }
  // Este cai de propósito: as outras três têm que continuar respondendo.
  if (u.includes('openlibrary.org')) { chamados.add('openlibrary'); return rota.abort(); }

  return rota.abort();
});

// Sem planilha configurada: o acervo da casa fica vazio, que é o pior caso.
await pag.addInitScript(() => { localStorage.clear(); window.addEventListener('unhandledrejection', e => console.log('[REJEICAO] ' + (e.reason && e.reason.stack ? e.reason.stack.split('\n').slice(0,3).join(' | ') : e.reason))); });
await pag.goto('http://localhost:8899/index.html', { waitUntil: 'domcontentloaded' });
await pag.waitForTimeout(1500);

await pag.fill('#search-input', 'pride and prejudice');
await pag.waitForTimeout(4000);

const cartoes = await pag.$$eval('#books-grid > div', ns => ns.map(n => n.innerText.replace(/\s+/g, ' ').trim()));
const rotulo = await pag.$eval('#books-count-label', n => n.textContent).catch(() => '');

console.log('\n--- catálogos chamados:', [...chamados].join(', '));
console.log('--- rótulo:', rotulo);
console.log('--- cartões:', cartoes.length);
cartoes.forEach(c => console.log('    •', c.slice(0, 80)));

ok(chamados.has('gutenberg'), 'chamou o Gutenberg');
ok(chamados.has('archive'), 'chamou o Internet Archive');
ok(chamados.has('wikisource'), 'chamou o Wikisource');
ok(cartoes.length >= 3, 'apareceram os 3 resultados das fontes que responderam');
ok(cartoes.some(c => /Pride and Prejudice/i.test(c)), 'trouxe o livro do Gutenberg');
ok(cartoes.some(c => /Orgulho e Preconceito/i.test(c)), 'trouxe o do Wikisource');
ok(cartoes.some(c => /ACERVO COMUNITÁRIO/i.test(c)), 'marcou o acervo comunitário');
ok(cartoes.some(c => /Jane Austen/.test(c)), 'arrumou o nome do autor (sem as datas)');
ok(/catálogos abertos/i.test(rotulo), 'o rótulo avisa que veio de catálogo aberto');
ok(erros.length === 0, 'nenhum erro de JavaScript' + (erros.length ? ': ' + erros[0] : ''));

// Clicar num resultado da web tem que abrir o modal.
await pag.click('#books-grid > div h4');
await pag.waitForTimeout(600);
const tituloModal = await pag.$eval('#modal-title', n => n.textContent).catch(() => '');
ok(/Pride|Orgulho/i.test(tituloModal), 'o modal abre num resultado da web (' + tituloModal + ')');

// Limpar tem que apagar os resultados da web.
await pag.click('#clear-search-btn');
await pag.waitForTimeout(500);
const depois = await pag.$$eval('#books-grid > div', ns => ns.length);
ok(depois === 0, 'limpar a busca apaga os resultados da web');


// ── falha total: os quatro catálogos fora do ar ──────────────────────────
await pag.evaluate(() => { window.__derrubarTudo = true; });
await pag.unroute('**/*');
await pag.route('**/*', (rota) => {
  const u = rota.request().url();
  if (u.startsWith('http://localhost:8899')) return rota.continue();
  if (u.includes('cdn.tailwindcss.com')) return rota.fulfill(js('window.tailwind={config:{}};'));
  if (u.includes('firebase-app.js')) return rota.fulfill(js(FB_APP));
  if (u.includes('firebase-auth.js')) return rota.fulfill(js(FB_AUTH));
  if (u.includes('firebase-firestore.js')) return rota.fulfill(js(FB_FS));
  if (u.includes('cdnjs.cloudflare.com') || u.includes('fonts.googleapis.com')) {
    return rota.fulfill({ contentType: 'text/css', body: '' });
  }
  return rota.abort(); // tudo mais cai
});

await pag.fill('#search-input', 'moby dick');
await pag.waitForTimeout(4000);
const painel = await pag.$eval('#books-grid', n => n.innerText.replace(/\s+/g,' ').trim()).catch(() => '');
const gridVisivel = await pag.$eval('#books-grid', n => !n.classList.contains('hidden'));
const vazioEscondido = await pag.$eval('#empty-state', n => n.classList.contains('hidden')).catch(() => true);

ok(/Não consegui falar com os catálogos/i.test(painel), 'com tudo fora do ar, avisa que é conexão — não "nada encontrado"');
ok(gridVisivel, 'o painel de erro fica visível');
ok(vazioEscondido, 'o "nada encontrado" fica escondido (seria diagnóstico errado)');
ok(/Tentar de novo/i.test(painel), 'oferece tentar de novo');

// O botão precisa realmente refazer a busca.
let refez = false;
await pag.unroute('**/*');
await pag.route('**/*', (rota) => {
  const u = rota.request().url();
  if (u.startsWith('http://localhost:8899')) return rota.continue();
  if (u.includes('gutendex.com')) { refez = true; return rota.fulfill(json({ results: [{
    id: 15, title: 'Moby Dick', authors: [{ name: 'Melville, Herman' }], languages: ['en'], copyright: false,
    formats: { 'text/plain; charset=us-ascii': 'https://g/15.txt' } }] })); }
  if (u.includes('cdn.tailwindcss.com')) return rota.fulfill(js('window.tailwind={config:{}};'));
  if (u.includes('cdnjs.cloudflare.com') || u.includes('fonts.googleapis.com')) return rota.fulfill({ contentType: 'text/css', body: '' });
  return rota.abort();
});
await pag.click('#books-grid button');
await pag.waitForTimeout(3500);
const depoisRetry = await pag.$eval('#books-grid', n => n.innerText).catch(() => '');
ok(refez, 'o botao "tentar de novo" realmente refaz a busca');
ok(/Moby Dick/i.test(depoisRetry), 'depois do retry o resultado aparece');

// Falha PARCIAL tem que aparecer no rotulo.
const rotuloParcial = await pag.$eval('#books-count-label', n => n.textContent);
ok(/sem resposta de/i.test(rotuloParcial), 'falha parcial aparece no rotulo (' + rotuloParcial.slice(0,90) + ')');

await nav.close(); servidor.close();
console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo passou');
process.exit(falhas ? 1 : 0);
