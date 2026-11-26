/* =====================================================================
 * SISTEMA AGRÍCOLA — aplicativo instalável com registro OFFLINE
 * Os dados ficam no Google (Apps Script + planilhas + Drive).
 * Sem internet, os registros e fotos ficam guardados no aparelho
 * e são enviados sozinhos quando a conexão volta.
 * ===================================================================== */

/* ===================== ESTADO E UTILITÁRIOS ===================== */
const S = { token: null, user: null, cfg: null, tela: 'inicio', geo: null, fotos: {}, charts: [], osMinhas: [], rel: null, dash: null,
  fila: [], pend: 0, pendErro: 0, pendOutros: 0, sincronizando: false, sessaoExpirada: false };
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const hojeISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const agoraISO = () => { const d = new Date(); return hojeISO() + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const inicioMesISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01'; };
const fmtDH = ts => { const d = new Date(ts); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
const num = v => { const n = parseFloat(String(v || '').replace(',', '.')); return isFinite(n) ? n : 0; };
const br = (n, c) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: c || 0, maximumFractionDigits: c === undefined ? 1 : c });
const moeda = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const isAdmin = () => S.user && S.user.nivel === 'administrador';
const form = id => S.cfg.forms.find(f => f.id === id);
const nomeUsu = l => { const u = (S.cfg && S.cfg.refs.usuarios || []).find(x => x.login === l); return u ? u.nome : l; };
const URL_MAPA = 'https://www.google.com/maps?q=';
const URL_THUMB = 'https://drive.google.com/thumbnail?id=';
const CORES = ['#2e7d32', '#f9a825', '#1565c0', '#c62828', '#6a1b9a', '#00838f', '#ef6c00', '#5d4037', '#ad1457', '#546e7a'];
const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() :
  'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

/* ---------- armazenamento simples ---------- */
function guardar(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function guardarJSON(k, v) { guardar(k, v === null ? null : JSON.stringify(v)); }
function lerJSON(k) { try { return JSON.parse(ler(k) || 'null'); } catch (e) { return null; } }

/* ---------- fila offline (IndexedDB: guarda registros e fotos) ---------- */
const DB = {
  db: null,
  abrir() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('sistema-agricola', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('fila', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; res(r.result); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(modo, fn) {
    const db = await this.abrir();
    return new Promise((res, rej) => {
      const t = db.transaction('fila', modo), rq = fn(t.objectStore('fila'));
      let out;
      if (rq) rq.onsuccess = () => { out = rq.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error || new Error('Falha ao gravar no aparelho'));
      t.onabort = () => rej(t.error || new Error('Sem espaço no aparelho'));
    });
  },
  put(it) { return this.tx('readwrite', st => st.put(it)); },
  del(id) { return this.tx('readwrite', st => st.delete(id)); },
  todos() { return this.tx('readonly', st => st.getAll()).then(l => (l || []).sort((a, b) => a.criadoEm < b.criadoEm ? -1 : 1)); }
};

/* ---------- comunicação com o Apps Script ---------- */
function apiUrl() {
  const l = ler('agro_api');
  if (l) return l;
  return (typeof API_URL === 'string' && /^https:/.test(API_URL) && API_URL.indexOf('COLE_AQUI') < 0) ? API_URL : '';
}
function erroOffline() { const e = new Error('Sem conexão com a internet.'); e.offline = true; return e; }

async function api(fn, ...args) {
  const url = apiUrl();
  if (!url) throw new Error('Endereço do servidor não configurado.');
  if (!navigator.onLine) throw erroOffline();
  let resp;
  const ctl = new AbortController();
  const tempo = setTimeout(() => ctl.abort(), fn === 'uploadFoto' ? 120000 : 60000);
  try {
    resp = await fetch(url, {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args })
    });
  } catch (e) { throw erroOffline(); }
  finally { clearTimeout(tempo); }
  let j;
  try { j = await resp.json(); }
  catch (e) { throw new Error('O servidor não respondeu como esperado. Confira o endereço do App da Web e se ele está publicado para "Qualquer pessoa" com a versão nova do Code.gs.'); }
  if (!j.ok) {
    const m = String(j.erro || 'Erro no servidor');
    if (m.indexOf('SESSAO_EXPIRADA') >= 0) { const e = new Error('Sessão expirada. Saia e entre novamente com internet.'); e.sessao = true; throw e; }
    throw new Error(m);
  }
  return j.res;
}

let _tt;
function toast(msg, tipo) {
  const t = $('#toast');
  t.textContent = msg; t.className = tipo || '';
  clearTimeout(_tt); _tt = setTimeout(() => t.classList.add('hide'), tipo === 'erro' ? 6000 : 3500);
}
function carregando(on, txt) { $('#carg').classList.toggle('hide', !on); if (txt) $('#cargTxt').textContent = txt; }
const offlineHTML = nome => `<div class="card"><h3>📡 Sem internet</h3><p>${esc(nome)} precisa de conexão. Os registros de campo continuam funcionando offline.</p>
  <button class="btn" onclick="ir('inicio')">📋 Ir para registros</button></div>`;

/* ===================== CONFIGURAÇÃO E LOGIN ===================== */
function telaConfig() {
  $('#app').innerHTML = `
  <div class="login"><div class="logo">🌾</div><h1>Sistema Agrícola</h1>
    <div class="card"><h3>Configurar servidor</h3>
      <p class="muted">Cole o endereço do App da Web do Apps Script (Implantar → Gerenciar implantações → URL, termina em <b>/exec</b>).</p>
      <div class="campo"><input id="cfgUrl" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(apiUrl())}"></div>
      <button class="btn largo" onclick="salvarConfig()">Salvar e testar</button>
    </div></div>`;
}
async function salvarConfig() {
  const u = $('#cfgUrl').value.trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) return toast('Endereço inválido: deve começar com https://script.google.com e terminar em /exec', 'erro');
  guardar('agro_api', u);
  carregando(true, 'Testando conexão…');
  try { await api('ping'); carregando(false); toast('✔ Servidor conectado', 'ok'); telaLogin(); }
  catch (e) { carregando(false); toast(e.offline ? 'Endereço salvo. Sem internet para testar agora.' : e.message, e.offline ? '' : 'erro'); if (e.offline) telaLogin(); }
}

function telaLogin(msg) {
  const off = !navigator.onLine;
  $('#app').innerHTML = `
  <div class="login">
    <div class="logo">🌾</div>
    <h1>Sistema Agrícola</h1>
    <div class="card">
      ${msg ? `<div class="info">${esc(msg)}</div>` : ''}
      ${off ? '<div class="info">📡 Sem internet: só entra quem já fez login neste aparelho antes.</div>' : ''}
      <div class="campo"><label>Login</label><input id="lgU" autocomplete="username" autocapitalize="none"></div>
      <div class="campo"><label>Senha</label><input id="lgS" type="password" autocomplete="current-password"></div>
      <button class="btn largo" id="lgB" onclick="entrar()">Entrar</button>
      <p class="muted" style="text-align:center;margin:12px 0 0"><a href="#" onclick="telaConfig();return false">⚙ Configurar servidor</a></p>
    </div>
  </div>`;
  $('#lgS').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
  $('#lgU').focus();
}

async function hashSenha(login, senha) {
  const txt = 'agro|' + String(login).trim().toLowerCase() + '|' + senha;
  if (window.crypto && crypto.subtle) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  let h = 0; for (let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) | 0; return 'x' + h;
}
const contas = () => lerJSON('agro_contas') || {};

async function entrar() {
  const u = $('#lgU').value.trim(), s = $('#lgS').value;
  if (!u || !s) return toast('Informe login e senha.', 'erro');
  const h = await hashSenha(u, s);
  const cs = contas();
  if (navigator.onLine) {
    carregando(true, 'Entrando…');
    try {
      const r = await api('login', u, s);
      const cfg = await api('getConfig', r.token);
      cs[r.user.login.toLowerCase()] = { hash: h, user: r.user, token: r.token };
      guardarJSON('agro_contas', cs);
      guardarJSON('agro_cfg', cfg);
      carregando(false);
      return abrirSessao(r.token, r.user, cfg);
    } catch (e) {
      carregando(false);
      if (!e.offline) return toast(e.message, 'erro');
    }
  }
  // sem internet: confere com o último login feito neste aparelho
  const c = cs[u.toLowerCase()];
  if (!c) return toast('Sem internet. Este usuário ainda não entrou neste aparelho: o primeiro acesso precisa de conexão.', 'erro');
  if (c.hash !== h) return toast('Login ou senha inválidos.', 'erro');
  const cfg = lerJSON('agro_cfg');
  if (!cfg) return toast('Os dados do sistema ainda não estão neste aparelho. Conecte-se à internet uma vez.', 'erro');
  abrirSessao(c.token, c.user, cfg);
  toast('Modo offline: os registros ficam guardados e serão enviados quando houver internet.');
}

function abrirSessao(token, user, cfg) {
  S.token = token; S.user = user; S.cfg = cfg; S.cfg.user = user; S.sessaoExpirada = false;
  S.osMinhas = lerJSON('agro_os_' + user.login) || [];
  guardarJSON('agro_sessao', { token: token, user: user });
  iniciar();
}

async function sair() {
  await contarPend();
  if (S.pend && !confirm(`Há ${S.pend} registro(s) aguardando envio. Eles continuam guardados neste aparelho e serão enviados quando você entrar de novo. Sair mesmo assim?`)) return;
  guardarJSON('agro_sessao', null);
  Object.assign(S, { token: null, user: null, cfg: null });
  telaLogin();
}

async function iniciar() {
  await contarPend();
  reaplicarPendentes();
  ir(isAdmin() ? 'escolha' : 'inicio');
  await sincronizar();
  await atualizarDoServidor();
}

/* Baixa cadastros, usuários e OS atualizados (quando há internet) */
async function atualizarDoServidor() {
  if (!navigator.onLine || !S.user) return;
  try {
    const cfg = await api('getConfig', S.token);
    S.cfg = cfg; S.cfg.user = S.user;
    guardarJSON('agro_cfg', cfg);
    S.osMinhas = await api('listarOS', S.token, { status: 'abertas' });
    guardarJSON('agro_os_' + S.user.login, S.osMinhas);
    reaplicarPendentes();
    atualizarNav();
  } catch (e) { if (e.sessao) sessaoExpirou(); }
}
function sessaoExpirou() {
  if (S.sessaoExpirada) return;
  S.sessaoExpirada = true; atualizarStatus();
  toast('Seu login venceu. Saia e entre de novo com internet para enviar os registros pendentes.', 'erro');
}

/* ===================== NAVEGAÇÃO ===================== */
function itensNav() {
  const it = [['inicio', '📋 Registrar'], ['os', '🛠️ Minhas OS'], ['rel', '📊 Relatórios']];
  if (isAdmin()) it.push(['dash', '📈 Dashboard'], ['adminos', '🗂️ Ordens de Serviço']);
  return it;
}
function shell(html) {
  S.charts.forEach(c => { try { c.destroy(); } catch (e) {} }); S.charts = [];
  const minhas = (S.osMinhas || []).filter(o => o.responsaveis.indexOf(S.user.login) >= 0).length;
  $('#app').innerHTML = `
  <header>
    <div class="topo"><h1>🌾 Sistema Agrícola</h1>
      <div class="quem">${esc(S.user.nome)}<br>${isAdmin() ? 'Administrador' : 'Usuário'} · <a href="#" style="color:#fff" onclick="sair();return false">Sair</a></div></div>
    <div id="stBar" class="stbar"></div>
    <nav>${itensNav().map(([k, t]) => `<button class="${S.tela === k ? 'ativo' : ''}" onclick="ir('${k}')">${t}${k === 'os' && minhas ? ` (${minhas})` : ''}</button>`).join('')}</nav>
  </header>
  <main>${html}</main>`;
  window.scrollTo(0, 0);
  atualizarStatus();
}
function atualizarNav() { if (S.user && $('nav')) { $('nav').innerHTML = itensNav().map(([k, t]) => { const n = (S.osMinhas || []).filter(o => o.responsaveis.indexOf(S.user.login) >= 0).length; return `<button class="${S.tela === k ? 'ativo' : ''}" onclick="ir('${k}')">${t}${k === 'os' && n ? ` (${n})` : ''}</button>`; }).join(''); } }

function ir(tela, ...args) {
  S.tela = tela;
  ({ escolha: telaEscolha, inicio: telaInicio, form: telaForm, os: telaMinhasOS, rel: telaRel, dash: telaDash, adminos: telaAdminOS, fila: telaFila }[tela] || telaInicio)(...args);
}

function telaEscolha() {
  S.tela = 'inicio';
  shell(`<h2>Olá, ${esc(S.user.nome)}</h2>
  <div class="grid">
    <div class="card mod"><h3><span class="ic">📋</span>Registrar atividades</h3><p class="muted">Lançar registros de campo, cadastros e fotos.</p><button onclick="ir('inicio')">Abrir registros</button></div>
    <div class="card mod"><h3><span class="ic">📈</span>Dashboard</h3><p class="muted">Produtividade, pastagens, manejos, rebanho, lavoura, máquinas e compras.</p><button onclick="ir('dash')">Abrir dashboard</button></div>
    <div class="card mod"><h3><span class="ic">🗂️</span>Ordens de Serviço</h3><p class="muted">Criar e acompanhar OS para os usuários.</p><button onclick="ir('adminos')">Abrir OS</button></div>
  </div>`);
}

function telaInicio() {
  const mods = S.cfg.modulos.map(m => {
    const fs = S.cfg.forms.filter(f => f.mod === m.id);
    return `<div class="card mod"><h3><span class="ic">${m.icone}</span>${esc(m.nome)}</h3>
      ${fs.map(f => `<button onclick="ir('form','${f.id}')">${esc(f.titulo)}${f.cadastro ? '<small>Cadastro</small>' : (f.fotos && f.fotos.modo === 'ad' ? '<small>Fotos antes e depois</small>' : '')}</button>`).join('')}
    </div>`;
  }).join('');
  const minhas = (S.osMinhas || []).filter(o => o.responsaveis.indexOf(S.user.login) >= 0);
  shell(`${minhas.length ? `<div class="info">Você tem <b>${minhas.length}</b> ordem(ns) de serviço aberta(s). <a href="#" onclick="ir('os');return false">Ver minhas OS</a></div>` : ''}
    <h2>Registrar</h2><div class="grid">${mods}</div>`);
}

/* ===================== FORMULÁRIO ===================== */
function campoHTML(c) {
  const id = 'c_' + c.k;
  const ph = c.dica ? ` placeholder="${esc(c.dica)}"` : '';
  let inp = '';
  switch (c.t) {
    case 'number': inp = `<input id="${id}" type="number" step="any" inputmode="decimal"${ph}>`; break;
    case 'textarea': inp = `<textarea id="${id}" rows="3"${ph}></textarea>`; break;
    case 'date': inp = `<input id="${id}" type="date" value="${c.auto ? hojeISO() : ''}">`; break;
    case 'datetime': inp = `<input id="${id}" type="datetime-local" value="${c.auto ? agoraISO() : ''}">`; break;
    case 'select': inp = `<select id="${id}"><option value="">Selecione…</option>${c.op.map(o => `<option>${esc(o)}</option>`).join('')}</select>`; break;
    case 'ref': {
      const l = S.cfg.refs[c.src] || [];
      inp = l.length ? `<select id="${id}"><option value="">Selecione…</option>${l.map(o => `<option>${esc(o)}</option>`).join('')}</select>`
        : `<select id="${id}" disabled><option value="">Nenhum cadastrado</option></select><div class="muted">Faça o cadastro primeiro (${c.src === 'piquetes' ? '1.1 Piquetes' : c.src === 'lotes' ? '2.1 Lotes' : '3.1/3.2 Máquinas e implementos'}).</div>`;
      break;
    }
    case 'calc': inp = `<input id="${id}" disabled placeholder="calculado automaticamente">`; break;
    default: inp = `<input id="${id}" type="text"${c.lista ? ` list="dl_${c.lista}"` : ''}${ph}>`;
  }
  return `<div class="campo" data-k="${c.k}"><label for="${id}">${esc(c.l)}${c.req ? ' <b class="req">*</b>' : ''}</label>${inp}</div>`;
}

function slotsDe(f) {
  if (!f.fotos) return [];
  return f.fotos.modo === 'ad' ? [['antes', 'Fotos ANTES do serviço'], ['depois', 'Fotos DEPOIS do serviço']] : [['fotos', 'Registro fotográfico']];
}

function telaForm(fid, osNum) {
  const f = form(fid);
  S.tela = 'inicio';
  S.fotos = {}; slotsDe(f).forEach(([s]) => { S.fotos[s] = []; });
  const modNome = (S.cfg.modulos.find(m => m.id === f.mod) || {}).nome;
  const meus = (S.osMinhas || []).filter(o => o.responsaveis.indexOf(S.user.login) >= 0 && o.aberta && (o.modulo === modNome || o.formId === f.id || o.num === osNum));
  const outros = S.cfg.refs.usuarios.filter(u => u.login !== S.user.login);
  const ocup = f.especial === 'pastejo' ? S.cfg.refs.ocupacao : null;
  const reqFoto = f.fotos && f.fotos.req;

  shell(`
  <button class="btn sec peq" onclick="ir('inicio')">← Voltar</button>
  <h2 style="margin-top:10px">${esc(f.titulo)}</h2>
  ${ocup ? `<div class="card"><h3>Gado nos piquetes agora</h3>${ocup.length ? `<div class="tab-wrap"><table><tr><th>Piquete</th><th>Grupo</th><th>Cab.</th><th>Desde</th></tr>${ocup.map(o => `<tr><td>${esc(o.piquete)}</td><td>${esc(o.grupo)}</td><td>${esc(o.qtd)}</td><td>${esc(o.desde)}</td></tr>`).join('')}</table></div>` : '<div class="muted">Nenhum piquete ocupado.</div>'}
    <p class="muted">Ao registrar a entrada de um grupo em outro piquete, a saída do piquete anterior é lançada automaticamente.</p></div>` : ''}
  <div class="card">
    ${!f.cadastro && meus.length ? `<div class="campo"><label>Vincular à Ordem de Serviço</label>
      <select id="osSel"><option value="">— Sem OS —</option>${meus.map(o => `<option value="${esc(o.num)}" ${o.num === osNum ? 'selected' : ''}>${esc(o.num)} · ${esc(o.servico)} · ${esc(o.local || '')}</option>`).join('')}</select>
      <label class="chip" style="margin-top:6px"><input type="checkbox" id="osConcluir" ${osNum ? 'checked' : ''}> Concluir a OS ao salvar</label></div>` : ''}
    ${f.campos.map(campoHTML).join('')}
    ${S.cfg.refs.grupos ? `<datalist id="dl_grupos">${S.cfg.refs.grupos.map(g => `<option value="${esc(g)}">`).join('')}</datalist>` : ''}
  </div>
  ${f.equipe && outros.length ? `<div class="card"><h3>Pessoas envolvidas (equipe)</h3><p class="muted">Você já é o responsável. Marque quem trabalhou junto.</p>
    <div class="chips">${outros.map(u => `<label class="chip"><input type="checkbox" class="eqp" value="${esc(u.login)}"> ${esc(u.nome)}</label>`).join('')}</div></div>` : ''}
  ${f.fotos ? `<div class="card"><h3>Fotos ${reqFoto ? '<b class="req">*</b>' : '(opcional)'}</h3>
    <p class="muted">Cada foto recebe data, hora, usuário e posição GPS gravados na imagem. Você pode marcar com setas, círculos e textos.</p>
    ${slotsDe(f).map(([s, t]) => `<div class="slot"><div class="slot-t">${t}${reqFoto ? ' <b class="req">*</b>' : ''}</div><div class="thumbs" id="th_${s}"></div>
      <div class="linha"><label class="btn sec peq">📷 Câmera<input type="file" accept="image/*" capture="environment" hidden onchange="novaFoto(event,'${s}')"></label>
      <label class="btn sec peq">🖼️ Galeria<input type="file" accept="image/*" hidden onchange="novaFoto(event,'${s}')"></label></div></div>`).join('')}
  </div>` : ''}
  <div id="gpsInfo" class="gps">📍 Obtendo localização…</div>
  <button class="btn largo" id="btnSalvar" onclick="enviar('${f.id}')">💾 Salvar registro</button>
  <p class="muted" style="text-align:center">Funciona sem internet: o registro fica guardado e é enviado depois.</p>
  <div style="height:40px"></div>`);

  f.campos.forEach(c => {
    const el = $('#c_' + c.k);
    if (el) { el.addEventListener('change', () => condicoes(f)); el.addEventListener('input', () => calcular(f)); }
  });
  condicoes(f);
  obterGeo();
}

function valor(k) { const el = $('#c_' + k); return el ? el.value.trim() : ''; }
function condicoes(f) {
  f.campos.forEach(c => {
    if (!c.se) return;
    const ok = [].concat(c.se[1]).indexOf(valor(c.se[0])) >= 0;
    const box = $(`.campo[data-k="${c.k}"]`);
    if (box) box.style.display = ok ? '' : 'none';
  });
  calcular(f);
}
function calcular(f) {
  if (f.id === 'produtividade') { const a = num(valor('area')), p = num(valor('producao')); $('#c_prod').value = a ? br(p / a, 2) + ' sc/ha' : ''; }
  if (f.id === 'compra') { const q = num(valor('quantidade')), u = num(valor('valorUnit')); $('#c_valorTotal').value = q && u ? moeda(q * u) : ''; }
}

function obterGeo() {
  return new Promise(res => {
    const info = $('#gpsInfo');
    const mostrar = () => {
      const i = $('#gpsInfo'); if (!i) return;
      if (S.geo) { i.className = 'gps ok'; i.textContent = `📍 GPS: ${S.geo.lat.toFixed(6)}, ${S.geo.lon.toFixed(6)} (±${Math.round(S.geo.acc)} m)`; }
      else { i.className = 'gps erro'; i.innerHTML = '📍 Localização indisponível. Permita o acesso ao GPS no navegador. <a href="#" onclick="obterGeo();return false">Tentar de novo</a>'; }
    };
    if (!navigator.geolocation) { S.geo = null; mostrar(); return res(null); }
    if (info) { info.className = 'gps'; info.textContent = '📍 Obtendo localização…'; }
    navigator.geolocation.getCurrentPosition(p => {
      S.geo = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() };
      mostrar(); res(S.geo);
    }, () => {
      if (S.geo && Date.now() - S.geo.ts > 600000) S.geo = null;
      mostrar(); res(S.geo);
    }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 });
  });
}

/* ===================== FOTOS ===================== */
function carregarImagem(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Não foi possível abrir a imagem.'));
    img.src = URL.createObjectURL(file);
  });
}
function redimensionar(img, max) {
  const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function novaFoto(ev, slot) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  carregando(true, 'Obtendo localização (GPS)…');
  const geo = await obterGeo();
  carregando(false);
  if (!geo) toast('Sem GPS: a foto será salva sem coordenadas.', 'erro');
  try {
    const img = await carregarImagem(file);
    const foto = { base: redimensionar(img, 1600), shapes: [], geo: geo ? Object.assign({}, geo) : null, ts: Date.now() };
    abrirEditor(foto, () => { S.fotos[slot].push(foto); renderThumbs(slot); });
  } catch (e) { toast(e.message, 'erro'); }
}

function compor(foto, escala) {
  const c = document.createElement('canvas');
  c.width = Math.round(foto.base.width * escala); c.height = Math.round(foto.base.height * escala);
  const ctx = c.getContext('2d');
  ctx.drawImage(foto.base, 0, 0, c.width, c.height);
  ctx.save(); ctx.scale(escala, escala);
  foto.shapes.forEach(s => desenharForma(ctx, s));
  ctx.restore();
  return c;
}

function renderThumbs(slot) {
  const box = $('#th_' + slot); if (!box) return;
  box.innerHTML = S.fotos[slot].map((f, i) => {
    const sc = 180 / Math.max(f.base.width, f.base.height);
    return `<div class="th"><img src="${compor(f, sc).toDataURL('image/jpeg', 0.7)}" onclick="editarFoto('${slot}',${i})" title="Toque para editar"><button onclick="removerFoto('${slot}',${i})">✕</button></div>`;
  }).join('');
}
function removerFoto(slot, i) { S.fotos[slot].splice(i, 1); renderThumbs(slot); }
function editarFoto(slot, i) { abrirEditor(S.fotos[slot][i], () => renderThumbs(slot)); }

function carimbar(cv, foto, rotulo, f) {
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const fs = Math.max(14, Math.round(W / 52));
  const linhas = [
    (rotulo ? rotulo.toUpperCase() + ' • ' : '') + f.titulo,
    fmtDH(foto.ts) + ' • ' + S.user.nome,
    foto.geo ? `Lat ${foto.geo.lat.toFixed(6)}  Lon ${foto.geo.lon.toFixed(6)}  (±${Math.round(foto.geo.acc)} m)` : 'GPS indisponível'
  ];
  const lh = fs * 1.32, p = fs * 0.6, h = linhas.length * lh + p * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, cv.height - h, W, h);
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  linhas.forEach((t, i) => ctx.fillText(t, p, cv.height - h + p + i * lh, W - p * 2));
}

function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ''); }
function inserirExif(dataUrl, foto, f, rotulo) {
  if (!window.piexif) return dataUrl;
  try {
    const d = new Date(foto.ts);
    const dt = `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const z = {}, ex = {}, gps = {};
    z[piexif.ImageIFD.Make] = 'Sistema Agricola';
    z[piexif.ImageIFD.Artist] = semAcento(S.user.nome + ' (' + S.user.login + ')');
    z[piexif.ImageIFD.ImageDescription] = semAcento((rotulo ? rotulo + ' - ' : '') + f.titulo);
    z[piexif.ImageIFD.DateTime] = dt;
    ex[piexif.ExifIFD.DateTimeOriginal] = dt;
    if (foto.geo) {
      gps[piexif.GPSIFD.GPSLatitudeRef] = foto.geo.lat < 0 ? 'S' : 'N';
      gps[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(foto.geo.lat));
      gps[piexif.GPSIFD.GPSLongitudeRef] = foto.geo.lon < 0 ? 'W' : 'E';
      gps[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(foto.geo.lon));
    }
    return piexif.insert(piexif.dump({ '0th': z, 'Exif': ex, 'GPS': gps }), dataUrl);
  } catch (e) { return dataUrl; }
}

/* ===================== EDITOR DE FOTO ===================== */
const ED = { foto: null, shapes: [], tool: 'seta', cor: '#ff1744', atual: null, cb: null };
const ED_CORES = ['#ff1744', '#ffea00', '#00e676', '#2979ff', '#ffffff', '#000000'];
(function prepararEditor() {
  $('#edCores').innerHTML = ED_CORES.map((c, i) => `<button class="cor ${i === 0 ? 'ativo' : ''}" style="background:${c}" data-cor="${c}"></button>`).join('');
  $$('#edCores .cor').forEach(b => b.onclick = () => { ED.cor = b.dataset.cor; $$('#edCores .cor').forEach(x => x.classList.toggle('ativo', x === b)); });
  $$('.ed-tools [data-tool]').forEach(b => b.onclick = () => { ED.tool = b.dataset.tool; $$('.ed-tools [data-tool]').forEach(x => x.classList.toggle('ativo', x === b)); });
  const cv = $('#edCanvas');
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  const larg = () => Math.max(4, Math.round(Math.max(cv.width, cv.height) / 200));
  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    const p = pos(e);
    if (ED.tool === 'texto') {
      const t = $('#edTexto').value.trim();
      if (!t) return toast('Digite o texto no campo e toque na foto.', 'erro');
      ED.shapes.push({ t: 'texto', x: p.x, y: p.y, txt: t, cor: ED.cor, w: larg() });
      edDesenhar(); return;
    }
    ED.atual = { t: ED.tool, cor: ED.cor, w: larg(), x1: p.x, y1: p.y, x2: p.x, y2: p.y, pts: [[p.x, p.y]] };
    try { cv.setPointerCapture(e.pointerId); } catch (er) {}
  });
  cv.addEventListener('pointermove', e => {
    if (!ED.atual) return;
    const p = pos(e);
    ED.atual.x2 = p.x; ED.atual.y2 = p.y; ED.atual.pts.push([p.x, p.y]);
    edDesenhar();
  });
  const fim = () => {
    if (!ED.atual) return;
    const a = ED.atual; ED.atual = null;
    if (Math.hypot(a.x2 - a.x1, a.y2 - a.y1) > 6 || (a.t === 'livre' && a.pts.length > 3)) ED.shapes.push(a);
    edDesenhar();
  };
  cv.addEventListener('pointerup', fim); cv.addEventListener('pointercancel', fim);
})();

function abrirEditor(foto, cb) {
  ED.foto = foto; ED.shapes = foto.shapes.slice(); ED.cb = cb; ED.atual = null;
  const cv = $('#edCanvas'); cv.width = foto.base.width; cv.height = foto.base.height;
  $('#editor').classList.remove('hide');
  edDesenhar();
}
function edDesenhar() {
  const cv = $('#edCanvas'), ctx = cv.getContext('2d');
  ctx.drawImage(ED.foto.base, 0, 0);
  ED.shapes.concat(ED.atual ? [ED.atual] : []).forEach(s => desenharForma(ctx, s));
}
function edDesfazer() { ED.shapes.pop(); edDesenhar(); }
function edLimpar() { ED.shapes = []; edDesenhar(); }
function edFechar(ok) {
  $('#editor').classList.add('hide');
  if (ok) { ED.foto.shapes = ED.shapes.slice(); if (ED.cb) ED.cb(); }
}
function desenharForma(ctx, s) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = s.cor; ctx.lineWidth = s.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = s.w;
  if (s.t === 'seta') {
    const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), L = s.w * 5;
    ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2 - Math.cos(ang) * L * 0.6, s.y2 - Math.sin(ang) * L * 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s.x2, s.y2);
    ctx.lineTo(s.x2 - L * Math.cos(ang - 0.45), s.y2 - L * Math.sin(ang - 0.45));
    ctx.lineTo(s.x2 - L * Math.cos(ang + 0.45), s.y2 - L * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill();
  } else if (s.t === 'circulo') {
    ctx.beginPath();
    ctx.ellipse((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.abs(s.x2 - s.x1) / 2, Math.abs(s.y2 - s.y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.t === 'ret') {
    ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
  } else if (s.t === 'livre') {
    ctx.beginPath(); s.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
  } else if (s.t === 'texto') {
    const fs = s.w * 9;
    ctx.font = `bold ${fs}px system-ui, sans-serif`; ctx.textBaseline = 'middle';
    ctx.shadowBlur = 0; ctx.lineWidth = Math.max(2, fs / 7); ctx.strokeStyle = s.cor === '#000000' ? '#fff' : '#000';
    ctx.strokeText(s.txt, s.x, s.y); ctx.fillText(s.txt, s.x, s.y);
  }
  ctx.restore();
}

/* ===================== ENVIO (guarda no aparelho e sincroniza) ===================== */
async function enviar(fid) {
  const f = form(fid);
  const dados = {}, falta = [];
  f.campos.forEach(c => {
    const box = $(`.campo[data-k="${c.k}"]`);
    if (!box || box.style.display === 'none' || c.t === 'calc') return;
    dados[c.k] = valor(c.k);
    if (c.req && !dados[c.k]) falta.push(c.l);
  });
  if (falta.length) return toast('Preencha: ' + falta.join(', '), 'erro');
  const slots = slotsDe(f);
  if (f.fotos && f.fotos.req) {
    const sem = slots.filter(([s]) => !S.fotos[s].length).map(([, t]) => t);
    if (sem.length) return toast('Inclua: ' + sem.join(' e '), 'erro');
  }
  if (f.cadastro && dados.nome) {
    const lista = f.id === 'piquete' ? S.cfg.refs.piquetes : f.id === 'lote' ? S.cfg.refs.lotes :
      S.cfg.refs.equipamentos.map(x => x.replace(/^(Máquina|Implemento): /, ''));
    if (lista.some(x => x.toUpperCase() === dados.nome.toUpperCase())) return toast('Já existe um cadastro com o nome "' + dados.nome + '".', 'erro');
  }
  const equipe = $$('.eqp:checked').map(x => x.value);
  const os = $('#osSel') ? $('#osSel').value : '';
  const concluirOS = !!(os && $('#osConcluir') && $('#osConcluir').checked);
  const btn = $('#btnSalvar'); btn.disabled = true;
  carregando(true, 'Preparando fotos…');
  try {
    const fotos = {};
    let geoFoto = null;
    for (const [s] of slots) {
      fotos[s] = [];
      for (const foto of S.fotos[s]) {
        const rot = s === 'fotos' ? '' : s;
        const cv = compor(foto, 1);
        carimbar(cv, foto, rot, f);
        fotos[s].push(inserirExif(cv.toDataURL('image/jpeg', 0.82), foto, f, rot));
        if (!geoFoto && foto.geo) geoFoto = foto.geo;
      }
    }
    const g = geoFoto || S.geo;
    const agora = new Date().toISOString();
    const item = {
      id: uuid(), login: S.user.login, formId: fid, titulo: f.titulo, criadoEm: agora,
      dados: dados, fotos: fotos, urls: {}, status: 'pendente', erro: '',
      extra: { lat: g ? g.lat : '', lon: g ? g.lon : '', equipe: equipe, os: os, concluirOS: concluirOS, registradoEm: agora }
    };
    await DB.put(item);
    aplicarItemLocal(item);
    carregando(false);
    await contarPend();
    toast(navigator.onLine ? '✔ Registro guardado. Enviando…' : '✔ Registro guardado no aparelho. Será enviado quando houver internet.', 'ok');
    telaForm(fid);
    sincronizar();
  } catch (e) {
    carregando(false); btn.disabled = false;
    toast('Não foi possível guardar o registro: ' + e.message, 'erro');
  }
}

/* Reflete no aparelho um registro ainda não enviado (cadastros, gado no piquete, OS concluída) */
function aplicarItemLocal(it) {
  const R = S.cfg.refs, d = it.dados;
  const add = (lista, v) => { if (v && lista.indexOf(v) < 0) { lista.push(v); lista.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })); } };
  if (it.formId === 'piquete') add(R.piquetes, d.nome);
  if (it.formId === 'lote') add(R.lotes, d.nome);
  if (it.formId === 'maquina') add(R.equipamentos, 'Máquina: ' + d.nome);
  if (it.formId === 'implemento') add(R.equipamentos, 'Implemento: ' + d.nome);
  if (it.formId === 'pastejo') {
    const g = String(d.grupo || '').trim().toUpperCase();
    if (d.mov === 'Entrada no piquete') {
      R.ocupacao = R.ocupacao.filter(o => String(o.grupo).toUpperCase() !== g);
      R.ocupacao.push({ piquete: d.piquete, grupo: d.grupo, qtd: d.qtd, desde: fmtDH(d.dataHora).slice(0, 16) + ' (não enviado)' });
      add(R.grupos, d.grupo);
    } else {
      R.ocupacao = R.ocupacao.filter(o => !(o.piquete === d.piquete && (!g || String(o.grupo).toUpperCase() === g)));
    }
  }
  if (it.extra.os && it.extra.concluirOS) S.osMinhas = (S.osMinhas || []).filter(o => o.num !== it.extra.os);
}
function reaplicarPendentes() {
  if (!S.cfg) return;
  S.fila.filter(i => i.status !== 'erro').forEach(i => { try { aplicarItemLocal(i); } catch (e) {} });
}

async function contarPend() {
  try { S.fila = await DB.todos(); } catch (e) { S.fila = []; }
  const meus = S.user ? S.fila.filter(i => i.login === S.user.login) : [];
  S.pend = meus.length;
  S.pendErro = meus.filter(i => i.status === 'erro').length;
  S.pendOutros = S.fila.length - meus.length;
  atualizarStatus();
}

/* Envia a fila em ordem; fotos já enviadas não são reenviadas; o servidor ignora repetidos */
async function sincronizar(manual) {
  if (S.sincronizando || !S.user || !S.token) return;
  if (!navigator.onLine) { if (manual) toast('Sem internet no momento.', 'erro'); return; }
  if (S.sessaoExpirada) { if (manual) toast('Saia e entre de novo com internet para enviar.', 'erro'); return; }
  S.sincronizando = true; atualizarStatus();
  let enviados = 0, falhas = 0, parou = false;
  try {
    const itens = (await DB.todos()).filter(i => i.login === S.user.login && (manual || i.status !== 'erro'));
    for (const it of itens) {
      try {
        for (const s of Object.keys(it.fotos || {})) {
          it.urls[s] = it.urls[s] || [];
          while (it.urls[s].length < it.fotos[s].length) {
            it.urls[s].push(await api('uploadFoto', S.token, it.formId, s, it.fotos[s][it.urls[s].length]));
            await DB.put(it);
          }
        }
        await api('salvarRegistro', S.token, it.formId, it.dados, Object.assign({}, it.extra, { fotos: it.urls, idLocal: it.id }));
        await DB.del(it.id);
        enviados++;
      } catch (e) {
        if (e.offline) { parou = true; break; }
        if (e.sessao) { sessaoExpirou(); parou = true; break; }
        it.status = 'erro'; it.erro = e.message; it.tentativa = new Date().toISOString();
        await DB.put(it);
        falhas++;
      }
      await contarPend();
    }
  } finally {
    S.sincronizando = false;
    await contarPend();
  }
  if (enviados) {
    toast(`✔ ${enviados} registro(s) enviado(s)` + (falhas ? ` · ${falhas} com erro (veja Pendentes)` : ''), falhas ? 'erro' : 'ok');
    atualizarDoServidor();
  } else if (falhas) toast(`${falhas} registro(s) não foram aceitos pelo servidor. Veja em Pendentes.`, 'erro');
  else if (manual && parou) toast('Conexão fraca ou ausente. Tentarei de novo automaticamente.', 'erro');
  if (S.tela === 'fila') telaFila();
}

/* ===================== PENDENTES ===================== */
async function telaFila() {
  S.tela = 'fila';
  await contarPend();
  const meus = S.fila.filter(i => i.login === S.user.login);
  const nf = it => Object.keys(it.fotos || {}).reduce((n, s) => n + it.fotos[s].length, 0);
  shell(`<h2>Registros aguardando envio</h2>
  <p class="muted">Ficam guardados neste aparelho até chegarem ao servidor. O envio é automático quando há internet.</p>
  <div class="linha" style="margin-bottom:12px"><button class="btn" onclick="sincronizar(true)">🔄 Enviar agora</button></div>
  ${S.pendOutros ? `<div class="info">Há ${S.pendOutros} registro(s) de outro usuário neste aparelho. Serão enviados quando ele entrar.</div>` : ''}
  ${meus.length ? meus.map(it => `<div class="card os ${it.status === 'erro' ? 'atr' : ''}">
    <b>${esc(it.titulo)}</b>
    <div class="meta">Registrado em ${esc(fmtDH(it.criadoEm))} · ${nf(it)} foto(s)${it.extra.os ? ' · ' + esc(it.extra.os) : ''}
      ${it.status === 'erro' ? '' : ' · aguardando'}</div>
    <div class="muted">${esc(Object.keys(it.dados).filter(k => it.dados[k]).slice(0, 5).map(k => /^\d{4}-\d{2}-\d{2}/.test(it.dados[k]) ? fmtDH(it.dados[k]).slice(0, it.dados[k].length > 10 ? 16 : 10) : it.dados[k]).join(' · '))}</div>
    ${it.status === 'erro' ? `<div class="info" style="margin-top:8px">⚠ O servidor recusou: <b>${esc(it.erro)}</b><br>Corrija lançando de novo e descarte este, ou tente reenviar.</div>` : ''}
    <div class="linha">${it.status === 'erro' ? `<button class="btn sec peq" onclick="reenviar('${it.id}')">↻ Tentar de novo</button>` : ''}
      <button class="btn perigo peq" onclick="descartar('${it.id}')">🗑 Descartar</button></div>
  </div>`).join('') : '<div class="card muted">✔ Nada pendente. Tudo foi enviado.</div>'}`);
}
async function reenviar(id) {
  const it = S.fila.find(i => i.id === id); if (!it) return;
  it.status = 'pendente'; it.erro = ''; await DB.put(it);
  sincronizar(true);
}
async function descartar(id) {
  if (!confirm('Descartar este registro? Ele será apagado do aparelho e não será enviado.')) return;
  await DB.del(id); toast('Registro descartado.'); telaFila();
}

function atualizarStatus() {
  const el = $('#stBar'); if (!el) return;
  const on = navigator.onLine;
  el.innerHTML = `<span class="dot ${on ? 'on' : 'off'}"></span>${on ? 'Online' : 'Offline'}`
    + (S.sincronizando ? ' · enviando…' : '')
    + (S.pend ? ` · <a href="#" onclick="ir('fila');return false">⏳ ${S.pend} pendente(s)${S.pendErro ? ` · ${S.pendErro} com erro` : ''}</a>` : ' · tudo enviado')
    + (S.sessaoExpirada ? ' · <b>login vencido: saia e entre de novo</b>' : '');
}
window.addEventListener('online', () => { atualizarStatus(); sincronizar(); atualizarDoServidor(); });
window.addEventListener('offline', atualizarStatus);
setInterval(() => { if (S.user && S.pend && navigator.onLine) sincronizar(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && S.pend) sincronizar(); });

/* ===================== MINHAS OS ===================== */
async function telaMinhasOS(status) {
  status = status || 'abertas';
  shell(`<h2>Minhas Ordens de Serviço</h2>
    <div class="linha" style="margin-bottom:12px"><select id="osSt" onchange="telaMinhasOS(this.value)">
      <option value="abertas">Abertas e em andamento</option><option value="Concluída">Concluídas</option><option value="todas">Todas</option></select></div>
    <div id="osLista" class="muted">Carregando…</div>`);
  $('#osSt').value = status;
  if (!navigator.onLine) {
    const l = (S.osMinhas || []).filter(o => o.responsaveis.indexOf(S.user.login) >= 0);
    $('#osLista').innerHTML = '<div class="info">📡 Sem internet: mostrando as OS abertas baixadas na última conexão. Use "Registrar execução" para concluir; o envio é feito depois.</div>'
      + (l.length ? l.map(o => cardOS(o, false)).join('') : '<div class="card muted">Nenhuma OS aberta.</div>');
    return;
  }
  try {
    const l = await api('listarOS', S.token, { status: status, usuario: isAdmin() ? S.user.login : '' });
    if (status === 'abertas' && !isAdmin()) { S.osMinhas = l; guardarJSON('agro_os_' + S.user.login, l); atualizarNav(); }
    $('#osLista').innerHTML = l.length ? l.map(o => cardOS(o, false)).join('') : '<div class="card muted">Nenhuma OS encontrada.</div>';
  } catch (e) { toast(e.message, 'erro'); }
}

function cardOS(o, admin) {
  const f = S.cfg.forms.find(x => x.id === o.formId) || S.cfg.forms.find(x => x.titulo === o.servico);
  const st = o.status.split(' ')[0];
  return `<div class="card os ${o.atrasada ? 'atr' : ''}">
    <div class="linha" style="justify-content:space-between"><b>${esc(o.num)} · ${esc(o.servico)}</b>
      <span><span class="badge b-${esc(st)}">${esc(o.status)}</span> <span class="badge b-${esc(o.prioridade)}">${esc(o.prioridade)}</span>${o.atrasada ? ' <span class="badge b-atr">ATRASADA</span>' : ''}</span></div>
    <div class="meta">${esc(o.modulo)}${o.local ? ' · Local: ' + esc(o.local) : ''}${o.prazo ? ' · Prazo: ' + esc(o.prazo) : ''} · Criada ${esc(o.criada)} por ${esc(o.criadaPor)}</div>
    <div>${esc(o.descricao)}</div>
    <div class="meta">Responsáveis: ${esc(o.responsaveisNomes)}${o.concluida ? ' · Concluída ' + esc(o.concluida) + ' por ' + esc(o.concluidaPor) : ''}${o.registro ? ' · Registros: ' + esc(o.registro) : ''}
      ${o.lat ? ` · <a href="${URL_MAPA}${esc(o.lat)},${esc(o.lon)}" target="_blank">📍 mapa</a>` : ''}</div>
    <div class="linha">
      ${o.aberta && o.responsaveis.indexOf(S.user.login) >= 0 ? `
        ${f ? `<button class="btn peq" onclick="ir('form','${f.id}','${esc(o.num)}')">📋 Registrar execução</button>` : ''}
        ${o.status === 'Aberta' ? `<button class="btn sec peq" onclick="mudarOS('${esc(o.num)}','Em andamento')">▶ Iniciar</button>` : ''}
        <button class="btn sec peq" onclick="mudarOS('${esc(o.num)}','Concluída')">✔ Concluir</button>` : ''}
      ${admin ? `<select onchange="mudarOS('${esc(o.num)}',this.value)" style="max-width:200px"><option value="">Alterar status…</option>${S.cfg.op.statusOS.map(s => `<option>${s}</option>`).join('')}</select>` : ''}
    </div></div>`;
}

async function mudarOS(num, status) {
  if (!status) return;
  if (!navigator.onLine) return toast('Sem internet. Para concluir offline, use "Registrar execução" e marque "Concluir a OS".', 'erro');
  carregando(true, 'Atualizando OS…');
  try {
    await api('atualizarOS', S.token, num, status, '');
    S.osMinhas = await api('listarOS', S.token, { status: 'abertas' });
    carregando(false); toast('OS ' + num + ': ' + status, 'ok');
    S.tela === 'adminos' ? carregarAdminOS() : telaMinhasOS($('#osSt') ? $('#osSt').value : 'abertas');
  } catch (e) { carregando(false); toast(e.message, 'erro'); }
}

/* ===================== ADMIN: ORDENS DE SERVIÇO ===================== */
function telaAdminOS() {
  if (!navigator.onLine) return shell(offlineHTML('Ordens de Serviço (administração)'));
  const us = S.cfg.refs.usuarios;
  const locais = [].concat(S.cfg.refs.piquetes.map(x => 'Piquete ' + x), S.cfg.refs.lotes.map(x => 'Lote ' + x), S.cfg.refs.equipamentos);
  shell(`<h2>Ordens de Serviço</h2>
  <div class="card"><h3>Nova OS</h3>
    <div class="linha">
      <div class="campo"><label>Módulo <b class="req">*</b></label><select id="osMod" onchange="osServicos()">${S.cfg.modulos.map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join('')}</select></div>
      <div class="campo"><label>Serviço <b class="req">*</b></label><select id="osServ"></select></div>
    </div>
    <div class="linha">
      <div class="campo"><label>Local</label><input id="osLocal" list="dlLocais" placeholder="Piquete, lote, máquina…"><datalist id="dlLocais">${locais.map(l => `<option value="${esc(l)}">`).join('')}</datalist></div>
      <div class="campo"><label>Prazo</label><input id="osPrazo" type="date"></div>
      <div class="campo"><label>Prioridade</label><select id="osPrio">${S.cfg.op.prioridade.map(p => `<option ${p === 'Normal' ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    </div>
    <div class="campo"><label>Descrição do serviço <b class="req">*</b></label><textarea id="osDesc" rows="3"></textarea></div>
    <div class="campo"><label>Responsáveis <b class="req">*</b></label><div class="chips">${us.map(u => `<label class="chip"><input type="checkbox" class="osResp" value="${esc(u.login)}"> ${esc(u.nome)}</label>`).join('')}</div></div>
    <label class="chip" style="margin-bottom:12px"><input type="checkbox" id="osGeo"> Gravar minha localização atual na OS</label>
    <button class="btn" onclick="criarOS()">➕ Criar OS</button>
  </div>
  <div class="card"><div class="linha">
    <div><label>Status</label><select id="aoSt" onchange="carregarAdminOS()"><option value="abertas">Abertas e em andamento</option>${S.cfg.op.statusOS.map(s => `<option>${s}</option>`).join('')}<option value="todas">Todas</option></select></div>
    <div><label>Usuário</label><select id="aoU" onchange="carregarAdminOS()"><option value="">Todos</option>${us.map(u => `<option value="${esc(u.login)}">${esc(u.nome)}</option>`).join('')}</select></div>
  </div></div>
  <div id="aoLista" class="muted">Carregando…</div>`);
  osServicos();
  carregarAdminOS();
}
function osServicos() {
  const m = $('#osMod').value;
  $('#osServ').innerHTML = S.cfg.forms.filter(f => f.mod === m && !f.cadastro).map(f => `<option value="${f.id}">${esc(f.titulo)}</option>`).join('') + '<option value="">Outro serviço</option>';
}
async function carregarAdminOS() {
  try {
    const l = await api('listarOS', S.token, { status: $('#aoSt').value, usuario: $('#aoU').value });
    $('#aoLista').innerHTML = l.length ? l.map(o => cardOS(o, true)).join('') : '<div class="card muted">Nenhuma OS encontrada.</div>';
  } catch (e) { toast(e.message, 'erro'); }
}
async function criarOS() {
  const sel = $('#osServ');
  const d = {
    modulo: $('#osMod').value, formId: sel.value, servico: sel.value ? sel.options[sel.selectedIndex].text : 'Outro serviço',
    local: $('#osLocal').value.trim(), prazo: $('#osPrazo').value, prioridade: $('#osPrio').value,
    descricao: $('#osDesc').value.trim(), responsaveis: $$('.osResp:checked').map(x => x.value)
  };
  d.modulo = S.cfg.modulos.find(m => m.id === d.modulo).nome;
  if (!d.descricao) return toast('Descreva o serviço.', 'erro');
  if (!d.responsaveis.length) return toast('Selecione ao menos um responsável.', 'erro');
  carregando(true, 'Criando OS…');
  try {
    if ($('#osGeo').checked) { const g = await obterGeo(); if (g) { d.lat = g.lat; d.lon = g.lon; } }
    const num = await api('criarOS', S.token, d);
    S.osMinhas = await api('listarOS', S.token, { status: 'abertas' });
    carregando(false); toast('OS criada: ' + num, 'ok');
    telaAdminOS();
  } catch (e) { carregando(false); toast(e.message, 'erro'); }
}

/* ===================== RELATÓRIOS ===================== */
function telaRel() {
  if (!navigator.onLine) return shell(offlineHTML('Relatórios'));
  const og = S.cfg.modulos.map(m => `<optgroup label="${esc(m.nome)}">${S.cfg.forms.filter(f => f.mod === m.id).map(f => `<option value="${f.id}">${esc(f.titulo)}</option>`).join('')}</optgroup>`).join('');
  shell(`<h2>${isAdmin() ? 'Relatórios de registros' : 'Meus relatórios'}</h2>
  ${isAdmin() ? '' : '<p class="muted">Você vê os registros que fez ou dos quais participou como equipe.</p>'}
  <div class="card"><div class="linha">
    <div><label>De</label><input type="date" id="rDe" value="${inicioMesISO()}"></div>
    <div><label>Até</label><input type="date" id="rAte" value="${hojeISO()}"></div>
    ${isAdmin() ? `<div><label>Usuário</label><select id="rU"><option value="">Todos</option>${S.cfg.refs.usuarios.map(u => `<option value="${esc(u.login)}">${esc(u.nome)}</option>`).join('')}</select></div>` : ''}
    <button class="btn" onclick="carregarResumo()">Atualizar resumo</button>
  </div></div>
  ${S.pend ? `<div class="info">⏳ ${S.pend} registro(s) seus ainda não foram enviados e não aparecem aqui. <a href="#" onclick="ir('fila');return false">Ver pendentes</a></div>` : ''}
  <div id="rResumo"></div>
  <div class="card"><h3>Registros detalhados</h3><div class="linha">
    <div style="flex:2"><label>Formulário</label><select id="rForm">${og}</select></div>
    <button class="btn" onclick="buscarRel()">Buscar</button>
    <button class="btn sec" onclick="exportarCSV()">⬇ CSV</button>
  </div><p class="muted">Para cadastros (piquetes, lotes, máquinas) limpe as datas para ver todos.</p><div id="rTab"></div></div>`);
  carregarResumo();
}

async function carregarResumo() {
  const box = $('#rResumo'); box.innerHTML = '<div class="muted">Carregando resumo…</div>';
  try {
    const r = await api('meuResumo', S.token, $('#rDe').value, $('#rAte').value, $('#rU') ? $('#rU').value : '');
    const tot = r.reduce((s, x) => s + x.total, 0);
    const porMod = S.cfg.modulos.map(m => ({ m, n: r.filter(x => x.mod === m.id).reduce((s, x) => s + x.total, 0) }));
    box.innerHTML = `<div class="kpis"><div class="kpi"><b>${tot}</b><span>Registros no período</span></div>
      ${porMod.map(p => `<div class="kpi"><b>${p.n}</b><span>${p.m.icone} ${esc(p.m.nome)}</span></div>`).join('')}</div>
      <div class="card"><h3>Atividades por tipo</h3><div class="tab-wrap"><table><tr><th>Atividade</th><th>Total</th><th>Como responsável</th><th>Como equipe</th></tr>
      ${r.filter(x => x.total).map(x => `<tr><td><a href="#" onclick="$('#rForm').value='${x.id}';buscarRel();return false">${esc(x.titulo)}</a></td><td>${x.total}</td><td>${x.comoResponsavel}</td><td>${x.total - x.comoResponsavel}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhuma atividade no período.</td></tr>'}
      </table></div></div>`;
  } catch (e) { box.innerHTML = ''; toast(e.message, 'erro'); }
}

function idDrive(u) { const m = String(u).match(/\/d\/([\w-]+)/); return m ? m[1] : ''; }
async function buscarRel() {
  const box = $('#rTab'); box.innerHTML = '<div class="muted">Carregando…</div>';
  try {
    const r = await api('listarRegistros', S.token, $('#rForm').value, { de: $('#rDe').value, ate: $('#rAte').value, usuario: $('#rU') ? $('#rU').value : '' });
    S.rel = r;
    if (!r.linhas.length) { box.innerHTML = '<div class="muted">Nenhum registro encontrado.</div>'; return; }
    const iLat = r.cab.indexOf('Latitude'), iLon = r.cab.indexOf('Longitude');
    const cols = r.cab.map((c, i) => i).filter(i => i !== iLon);
    box.innerHTML = `<p class="muted">${r.total} registro(s)${r.total > r.linhas.length ? ` · mostrando os ${r.linhas.length} mais recentes` : ''}</p>
    <div class="tab-wrap" style="max-height:70vh"><table><tr>${cols.map(i => `<th>${esc(i === iLat ? 'Local' : r.cab[i])}</th>`).join('')}</tr>
    ${r.linhas.map(l => `<tr>${cols.map(i => {
      const v = l[i], h = r.cab[i];
      if (/^Fotos/.test(h)) return `<td>${String(v || '').split('\n').filter(String).map(u => `<a href="${esc(u)}" target="_blank"><img src="${URL_THUMB}${idDrive(u)}&sz=w200" alt="foto"></a>`).join('')}</td>`;
      if (i === iLat) return `<td>${v !== '' && v !== null ? `<a href="${URL_MAPA}${esc(v)},${esc(l[iLon])}" target="_blank">📍 mapa</a>` : ''}</td>`;
      return `<td class="${String(v).length > 30 ? 'wrap' : ''}">${esc(v)}</td>`;
    }).join('')}</tr>`).join('')}</table></div>`;
  } catch (e) { box.innerHTML = ''; toast(e.message, 'erro'); }
}
function exportarCSV() {
  if (!S.rel || !S.rel.linhas.length) return toast('Busque os registros primeiro.', 'erro');
  const q = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
  const csv = '﻿' + [S.rel.cab].concat(S.rel.linhas).map(l => l.map(q).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'relatorio_' + $('#rForm').value + '_' + hojeISO() + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

/* ===================== DASHBOARD ===================== */
function telaDash() {
  if (!navigator.onLine) return shell(offlineHTML('O dashboard'));
  shell(`<h2>Dashboard</h2>
  <div class="card"><div class="linha">
    <div><label>Período</label><select id="dTipo"><option value="dia">Dia</option><option value="mes" selected>Mês</option><option value="ano">Ano</option></select></div>
    <div><label>Data de referência</label><input type="date" id="dData" value="${hojeISO()}"></div>
    <button class="btn" onclick="carregarDash()">Atualizar</button>
  </div></div>
  <div id="dash"><div class="muted">Carregando…</div></div>`);
  carregarDash();
}

function grafico(id, tipo, labels, datasets, opt) {
  if (!window.Chart) return;
  opt = opt || {};
  const el = document.getElementById(id); if (!el) return;
  const c = new Chart(el, {
    type: tipo,
    data: { labels, datasets: datasets.map((d, i) => Object.assign({ backgroundColor: CORES[i % CORES.length], borderColor: CORES[i % CORES.length], borderWidth: tipo === 'line' ? 2 : 0, borderRadius: tipo === 'bar' ? 4 : 0, tension: .3 }, d)) },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: opt.horizontal ? 'y' : 'x',
      plugins: { legend: { display: datasets.length > 1 || tipo === 'doughnut', position: 'bottom' } },
      scales: tipo === 'doughnut' ? {} : { x: { stacked: !!opt.stacked, grid: { display: false } }, y: { stacked: !!opt.stacked, beginAtZero: true } }
    }
  });
  S.charts.push(c);
}
const tabela = (cab, linhas, cls) => `<div class="tab-wrap"><table class="${cls || ''}"><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr>${linhas.length ? linhas.map(l => `<tr>${l.map(v => String(v).startsWith('<td') ? v : `<td>${v}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cab.length}" class="muted">Sem dados no período.</td></tr>`}</table></div>`;
const heat = (v, max) => { const a = max ? Math.min(1, v / max) : 0; return `<td class="v" style="background:rgba(46,125,50,${(a * 0.75).toFixed(2)});color:${a > .55 ? '#fff' : 'inherit'}">${v ? br(v, 1) : ''}</td>`; };

async function carregarDash() {
  const box = $('#dash');
  S.charts.forEach(c => { try { c.destroy(); } catch (e) {} }); S.charts = [];
  box.innerHTML = '<div class="muted">Calculando…</div>';
  let D;
  try { D = await api('dashboard', S.token, { tipo: $('#dTipo').value, data: $('#dData').value }); }
  catch (e) { box.innerHTML = ''; return toast(e.message, 'erro'); }
  S.dash = D;
  const P = D.periodo, K = D.kpi;
  const mods = S.cfg.modulos;
  const piq = D.pastagens.piquetes.slice().sort((a, b) => (a.ocupado - b.ocupado) || (b.diasOcioso - a.diasOcioso));
  const maxMes = Math.max(1, ...D.pastagens.piquetes.map(p => Math.max(...p.mesesAno)));
  const tiposMan = Object.keys(D.manejos.ano);
  const R = D.rebanho;
  const catC = Object.keys(D.compras.ano);

  box.innerHTML = `
  <p class="muted">Período: <b>${esc(P.titulo)}</b> · atualizado em ${esc(D.gerado)}</p>
  <div class="kpis">
    <div class="kpi"><b>${K.registros}</b><span>Registros no período</span></div>
    <div class="kpi"><b>${K.osAbertas}</b><span>OS abertas / em andamento</span></div>
    <div class="kpi ${K.osAtrasadas ? 'alerta' : ''}"><b>${K.osAtrasadas}</b><span>OS atrasadas</span></div>
    <div class="kpi"><b>${K.osConcluidas}</b><span>OS concluídas no período</span></div>
    <div class="kpi"><b>${K.rebanho}</b><span>Rebanho ativo (brincos)</span></div>
    <div class="kpi"><b>${K.piquetesOcupados} / ${K.piquetesOciosos}</b><span>Piquetes ocupados / ociosos</span></div>
    <div class="kpi"><b>${moeda(K.comprasTotal)}</b><span>Compras no período</span></div>
  </div>

  <div class="card"><h3>👷 Produtividade por usuário</h3>
    <div class="dois"><div class="graf alto"><canvas id="gUsu"></canvas></div>
    <div>${tabela(['Usuário', 'Como responsável', 'Participações', 'OS concluídas'].concat(mods.map(m => m.icone)),
      D.produtividade.usuarios.map(u => [esc(u.nome), u.responsavel, `<b>${u.participacoes}</b>`, u.osConcluidas].concat(mods.map(m => u.mod[m.id] || ''))))}</div></div>
    <h3 style="margin-top:14px">Equipes (registros feitos em conjunto)</h3>
    ${tabela(['Equipe', 'Registros'], D.produtividade.equipes.map(e => [esc(e.equipe), e.registros]))}
    <h3 style="margin-top:14px">Participações ao longo do período</h3>
    <div class="graf"><canvas id="gUsuSerie"></canvas></div>
  </div>

  <div class="card"><h3>🌿 Manejo das pastagens</h3>
    <p class="muted">Tempo de gado em cada piquete no período, piquetes ociosos e há quanto tempo.</p>
    ${tabela(['Piquete', 'Área (ha)', 'Tipo', 'Condição', 'Situação', 'Ocioso há (dias)', 'Tempo ocupado no período', 'Cab.×dia', 'Ocupação'],
      piq.map(p => [`<b>${esc(p.nome)}</b>`, br(p.area, 2), esc(p.tipo), `<span class="badge b-${esc(p.condicao)}">${esc(p.condicao)}</span>`,
        p.ocupado ? `🐂 Ocupado desde ${esc(p.ocupadoDesde)}<br><span class="muted">${esc(p.grupos)}</span>` : (p.nuncaUsado ? '⏸ Ocioso (nunca usado)' : `⏸ Ocioso desde ${esc(p.ociosoDesde)}`),
        p.ocupado ? '—' : `<b style="color:${p.diasOcioso > 45 ? 'var(--vermelho)' : 'inherit'}">${br(p.diasOcioso, 1)}</b>`,
        `${br(p.diasPeriodo, 1)} dias (${br(p.horasPeriodo, 0)} h)`, br(p.cabDias, 0), br(p.taxa, 0) + '%']))}
    <div class="dois" style="margin-top:14px">
      <div><h3>Tempo ocupado no período (dias)</h3><div class="graf"><canvas id="gPiq"></canvas></div></div>
      <div><h3>Ociosos há mais tempo (dias)</h3><div class="graf"><canvas id="gOcioso"></canvas></div></div>
    </div>
    <h3 style="margin-top:14px">Dias de ocupação por mês — ${P.ano}</h3>
    ${tabela(['Piquete'].concat(P.meses).concat(['Total']), D.pastagens.piquetes.map(p => [esc(p.nome)].concat(p.mesesAno.map(v => heat(v, maxMes))).concat([`<b>${br(p.mesesAno.reduce((s, v) => s + v, 0), 1)}</b>`])), 'heat')}
    <h3 style="margin-top:14px">Permanências no período</h3>
    ${tabela(['Piquete', 'Grupo', 'Cab.', 'Entrada', 'Saída', 'Horas no período', 'Dias totais'], D.pastagens.estadias.map(e => [esc(e.piquete), esc(e.grupo), esc(e.qtd), esc(e.entrada), esc(e.saida), br(e.horas, 1), br(e.diasTotal, 1)]))}
  </div>

  <div class="card"><h3>💉 Manejos realizados no gado</h3>
    <p class="muted">${br(D.manejos.animais, 0)} animais manejados no período.</p>
    <div class="dois"><div><h3>Por tipo no período</h3><div class="graf"><canvas id="gMan"></canvas></div></div>
      <div><h3>Ao longo do período</h3><div class="graf"><canvas id="gManSerie"></canvas></div></div></div>
    <h3 style="margin-top:14px">Manejos por mês — ${P.ano}</h3>
    ${tabela(['Manejo'].concat(P.meses).concat(['Total']), tiposMan.map(t => [esc(t)].concat(D.manejos.ano[t].map(v => v || '')).concat([`<b>${D.manejos.ano[t].reduce((s, v) => s + v, 0)}</b>`])))}
    <h3 style="margin-top:14px">Serviços de cerca no período</h3>
    ${tabela(['Serviço', 'Quantidade'], Object.keys(D.manejos.cerca).map(k => [esc(k), D.manejos.cerca[k]]))}
  </div>

  <div class="card"><h3>🐄 Movimentação do rebanho</h3>
    <div class="kpis">
      <div class="kpi"><b>${R.periodo.nascimentos}</b><span>Nascimentos</span></div>
      <div class="kpi"><b>${R.periodo.compras}</b><span>Compras · ${moeda(R.valorCompras)}</span></div>
      <div class="kpi alerta"><b>${R.periodo.mortes}</b><span>Mortes</span></div>
      <div class="kpi"><b>${R.periodo.vendas}</b><span>Vendas · ${moeda(R.valorVendas)}</span></div>
    </div>
    <h3>Por mês — ${P.ano}</h3><div class="graf"><canvas id="gReb"></canvas></div>
    ${tabela(['Mês', 'Nascimentos', 'Compras', 'Mortes', 'Vendas', 'Saldo'], P.meses.map((m, i) => [m, R.ano.nascimentos[i], R.ano.compras[i], R.ano.mortes[i], R.ano.vendas[i],
      `<b>${R.ano.nascimentos[i] + R.ano.compras[i] - R.ano.mortes[i] - R.ano.vendas[i]}</b>`]).concat([['<b>Ano</b>'].concat(['nascimentos', 'compras', 'mortes', 'vendas'].map(k => `<b>${R.ano[k].reduce((s, v) => s + v, 0)}</b>`)).concat([''])]))}
    <div class="dois" style="margin-top:14px">
      <div><h3>Por tipo de animal (período)</h3>${tabela(['Tipo', 'Nasc.', 'Compras', 'Mortes', 'Vendas'], Object.keys(R.porTipoPeriodo).map(t => { const o = R.porTipoPeriodo[t]; return [esc(t), o.nascimentos, o.compras, o.mortes, o.vendas]; }))}</div>
      <div><h3>Rebanho ativo por tipo</h3>${tabela(['Tipo', 'Cabeças'], Object.keys(R.ativos).map(t => [esc(t), R.ativos[t]]))}
        <h3 style="margin-top:12px">Motivos de morte (período)</h3>${tabela(['Motivo', 'Qtd.'], Object.keys(R.motivos).map(t => [esc(t), R.motivos[t]]))}</div>
    </div>
  </div>

  <div class="card"><h3>🌱 Lavoura</h3>
    <div class="kpis">${Object.keys(D.lavoura.aplicacoes).map(k => `<div class="kpi"><b>${D.lavoura.aplicacoes[k]}</b><span>${esc(k)} no período</span></div>`).join('')}
      <div class="kpi ${D.lavoura.pragas.length ? 'alerta' : ''}"><b>${D.lavoura.pragas.length}</b><span>Registros de pragas</span></div></div>
    <div class="dois"><div><h3>Produtividade por cultura</h3>${tabela(['Cultura', 'Área (ha)', 'Produção (sc)', 'sc/ha'], Object.keys(D.lavoura.porCultura).map(c => { const o = D.lavoura.porCultura[c]; return [esc(c), br(o.area, 2), br(o.producao, 0), `<b>${br(o.scha, 2)}</b>`]; }))}</div>
      <div><h3>Colheitas no período</h3>${tabela(['Data', 'Lote', 'Cultura', 'sc/ha'], D.lavoura.produtividade.map(p => [esc(p.data), esc(p.lote), esc(p.cultura), br(p.scha, 2)]))}</div></div>
    <h3 style="margin-top:14px">Pragas no período</h3>
    ${tabela(['Data', 'Lote', 'Praga', 'Nível', 'Ação'], D.lavoura.pragas.map(p => [esc(p.data), esc(p.lote), esc(p.praga), `<span class="badge b-${p.nivel === 'Alto' ? 'Fraco' : p.nivel === 'Médio' ? 'Médio' : 'Bom'}">${esc(p.nivel)}</span>`, esc(p.acao)]))}
  </div>

  <div class="card"><h3>🚜 Maquinário e implementos</h3>
    <div class="kpis">${D.maquinario ? Object.keys(D.maquinario.porTipo).map(k => `<div class="kpi"><b>${D.maquinario.porTipo[k]}</b><span>${esc(k)}</span></div>`).join('') : ''}
      <div class="kpi"><b>${moeda(D.maquinario.custo)}</b><span>Custo de manutenção</span></div></div>
    ${tabela(['Equipamento', 'Última manutenção', 'Tipo', 'Lubrificação', 'Dias desde', 'No período'], D.maquinario.equipamentos.map(e => [esc(e.nome), esc(e.ultima), esc(e.tipo), esc(e.lubrificacao), e.dias === null ? '—' : `<b style="color:${e.dias > 90 ? 'var(--vermelho)' : 'inherit'}">${e.dias}</b>`, e.noPeriodo]))}
  </div>

  <div class="card"><h3>🧾 Compras</h3>
    <div class="dois"><div><h3>Por categoria (período)</h3><div class="graf"><canvas id="gCmp"></canvas></div></div>
      <div><h3>Por mês — ${P.ano}</h3><div class="graf"><canvas id="gCmpAno"></canvas></div></div></div>
    ${tabela(['Categoria'].concat(P.meses).concat(['Total']), catC.map(c => [esc(c)].concat(D.compras.ano[c].map(v => v ? br(v, 0) : '')).concat([`<b>${moeda(D.compras.ano[c].reduce((s, v) => s + v, 0))}</b>`])))}
  </div>`;

  /* gráficos */
  const usuG = D.produtividade.usuarios.filter(u => u.participacoes);
  grafico('gUsu', 'bar', usuG.map(u => u.nome), mods.map(m => ({ label: m.nome, data: usuG.map(u => u.mod[m.id]) })), { horizontal: true, stacked: true });
  grafico('gUsuSerie', 'bar', P.rotulos, usuG.slice(0, 10).map(u => ({ label: u.nome, data: u.serie })), { stacked: true });
  const pOrd = D.pastagens.piquetes.slice().sort((a, b) => b.diasPeriodo - a.diasPeriodo);
  grafico('gPiq', 'bar', pOrd.map(p => p.nome), [{ label: 'Dias ocupado', data: pOrd.map(p => p.diasPeriodo) }]);
  const oc = D.pastagens.piquetes.filter(p => !p.ocupado).sort((a, b) => b.diasOcioso - a.diasOcioso).slice(0, 12);
  grafico('gOcioso', 'bar', oc.map(p => p.nome), [{ label: 'Dias ocioso', data: oc.map(p => p.diasOcioso), backgroundColor: '#f9a825' }], { horizontal: true });
  const tm = Object.keys(D.manejos.porTipo);
  grafico('gMan', 'bar', tm, [{ label: 'Manejos', data: tm.map(t => D.manejos.porTipo[t]) }], { horizontal: true });
  grafico('gManSerie', 'bar', P.rotulos, Object.keys(D.manejos.serie).map(t => ({ label: t, data: D.manejos.serie[t] })), { stacked: true });
  grafico('gReb', 'bar', P.meses, [
    { label: 'Nascimentos', data: R.ano.nascimentos, backgroundColor: '#2e7d32' }, { label: 'Compras', data: R.ano.compras, backgroundColor: '#1565c0' },
    { label: 'Mortes', data: R.ano.mortes, backgroundColor: '#c62828' }, { label: 'Vendas', data: R.ano.vendas, backgroundColor: '#f9a825' }]);
  const cp = Object.keys(D.compras.porCategoria);
  grafico('gCmp', 'doughnut', cp, [{ data: cp.map(c => D.compras.porCategoria[c]), backgroundColor: cp.map((c, i) => CORES[(catC.indexOf(c) >= 0 ? catC.indexOf(c) : i) % CORES.length]) }]);
  grafico('gCmpAno', 'bar', P.meses, catC.map(c => ({ label: c, data: D.compras.ano[c] })), { stacked: true });
}
/* ===================== INÍCIO ===================== */
(async () => {
  window.__agroOK = true;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  if (!apiUrl()) return telaConfig();
  const ses = lerJSON('agro_sessao'), cfg = lerJSON('agro_cfg');
  if (ses && cfg) {
    S.token = ses.token; S.user = ses.user; S.cfg = cfg; S.cfg.user = ses.user;
    S.osMinhas = lerJSON('agro_os_' + ses.user.login) || [];
    return iniciar();
  }
  telaLogin();
})();
