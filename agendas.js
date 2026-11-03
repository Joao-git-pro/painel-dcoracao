/* =====================================================================
   AGENDAS (quadros estilo Trello) + MENU CIRCULAR DO CELULAR — Painel D Coração Home

   - Cada agenda é um quadro: listas (colunas) com cartões.
   - Papéis por agenda: dono, editor, colaborador, leitor. Administradores do painel
     veem e editam todas as agendas.
   - As permissões valem de verdade nas regras do Firestore (firebase/firestore.rules.completo);
     aqui a tela só esconde o que a pessoa não pode fazer.

   Coleções:
     boards/{id}                    { name, ownerUid, ownerName, members:{uid:papel}, memberUids:[uid], createdAt, updatedAt }
     boards/{id}/lists/{id}         { name, order, createdAt }
     boards/{id}/cards/{id}         { listId, title, desc, order, due(ms|null), done, assignees:[uid],
                                      checklist:[{id,text,done}], createdBy, createdByName, createdAt, updatedAt }
     boards/{id}/cards/{id}/comments/{id}  { text, authorUid, authorName, createdAt }

   Este arquivo usa as variáveis e funções globais do index.html (db, auth, isAdmin, myUid,
   allUsers, section, goSection, openMain, goBack, byId, escapeHtml, showSnack, ...).
   ===================================================================== */
(function(){
'use strict';

const ROLES = { dono: 'Dono', editor: 'Editor', colab: 'Colaborador', leitor: 'Leitor' };
const ROLE_HELP = {
  editor: 'Mexe em tudo: listas, cartões e comentários.',
  colab: 'Inclui cartões e edita só os que criou.',
  leitor: 'Só visualiza. Não inclui nem edita.'
};
const TEMPLATES = [
  { id: 'basico', label: 'A fazer, Fazendo, Concluído', lists: ['A fazer', 'Fazendo', 'Concluído'] },
  { id: 'semana', label: 'Semana de trabalho', lists: ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Concluído'] },
  { id: 'vazio', label: 'Em branco', lists: [] }
];

// ---------- estado ----------
let boards = [];
let view = null;                 // { id } da agenda aberta
let lists = [], cards = [], comments = [];
let unsubBoards = null, unsubLists = null, unsubCards = null, unsubComments = null;
let sheet = null;                // null | { kind:'card', id } | { kind:'members' }
let composing = null;            // id da lista com o campo "novo cartão" aberto
let search = '';
let mainSig = '';
let drag = null;
let dragPendingRender = false;
let lastDragEnd = 0;
let sheetHistory = false;        // empurramos um passo no histórico para o "voltar" fechar a folha
let sheetBackPending = false;
let confirmDelete = false;
let fanOpen = false;
let first = { b: true };
let mode = 'quadro';              // quadro | dia | semana | custom | mes | agenda | caixa
let customN = 3, fit = false;
try{
  const m = localStorage.getItem('agMode'); if(['quadro','dia','semana','custom','mes','agenda','caixa'].includes(m)) mode = m;
  const n = +localStorage.getItem('agCustomN'); if(n >= 2 && n <= 7) customN = n;
  fit = localStorage.getItem('agFit') === '1';
}catch(e){}
function savePref(){ try{ localStorage.setItem('agMode', mode); localStorage.setItem('agCustomN', String(customN)); localStorage.setItem('agFit', fit ? '1' : '0'); }catch(e){} }
let filter = { q: '', who: '', st: '' }, filterOpen = false;
let cdrag = null;
let trayTab = 'dia';
const mobileLayout = () => { try{ return window.matchMedia('(max-width:768px), (pointer:coarse) and (max-height:520px)').matches; }catch(e){ return false; } };
let selDay = sod(Date.now());     // dia em foco (visão Dia)
let pickerOpen = false, pkY = new Date().getFullYear(), pkM = new Date().getMonth();
let wk = weekStart(Date.now());   // segunda-feira (ms) da semana em exibição
let moY = new Date().getFullYear(), moM = new Date().getMonth();   // mês em exibição

const FV = () => firebase.firestore.FieldValue;
const esc = s => escapeHtml(String(s == null ? '' : s));
const attr = s => escapeAttr(String(s == null ? '' : s));

// ---------- ícones ----------
const I = {
  kanban: ic('<rect x="3" y="3" width="18" height="18" rx="3"></rect><path d="M8 7v7"></path><path d="M12 7v3"></path><path d="M16 7v10"></path>'),
  box: ic('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>'),
  clip: ic('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1"></rect><path d="m9 14 2 2 4-4"></path>'),
  gear: ic('<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>'),
  cal: ic('<rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>'),
  list: ic('<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><polyline points="3 6 4 7 6 5"></polyline><polyline points="3 12 4 13 6 11"></polyline><polyline points="3 18 4 19 6 17"></polyline>'),
  text: ic('<line x1="17" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="17" y1="18" x2="3" y2="18"></line>'),
  chat: ic('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>'),
  move: ic('<polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5"></polyline><polyline points="15 19 12 22 9 19"></polyline><polyline points="19 9 22 12 19 15"></polyline><line x1="2" y1="12" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="22"></line>'),
  send: ic('<line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>'),
  check: ic('<polyline points="20 6 9 17 4 12"></polyline>'),
  left: ic('<polyline points="15 18 9 12 15 6"></polyline>'),
  right: ic('<polyline points="9 18 15 12 9 6"></polyline>')
};

// ---------- utilitários ----------
function myName(){ return (typeof myChatName === 'string' && myChatName.trim()) || (auth.currentUser && auth.currentUser.email) || 'Alguém'; }
function userObj(uid){ return allUsers.find(u => u.uid === uid); }
function userName(uid){
  if(uid === myUid) return myName();
  const u = userObj(uid);
  return u ? displayNameFor(u) : 'Pessoa';
}
function firstName(n){ return String(n || '').trim().split(/\s+/)[0] || ''; }
function curBoard(){ return view ? boards.find(b => b.id === view.id) : null; }
function bRef(id){ return db.collection('boards').doc(id || (view && view.id)); }
function cardById(id){ return cards.find(c => c.id === id); }
function listName(id){ const l = lists.find(x => x.id === id); return l ? l.name : ''; }
function sortedCards(listId, all){ return cards.filter(c => c.listId === listId && (all || (cardWeek(c) === wk && vis(c)))).sort((a, b) => (a.order || 0) - (b.order || 0)); }
function toast(msg){ if(typeof showSnack === 'function') showSnack(msg); }
function fail(err){ toast(errMsg(err)); }

// semanas e meses (a agenda é preenchida semana a semana; cada mês começa vazio)
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const WDAYS = { 'segunda': 0, 'terça': 1, 'terca': 1, 'quarta': 2, 'quinta': 3, 'sexta': 4, 'sábado': 5, 'sabado': 5, 'domingo': 6 };
function weekStart(ms){ const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
function addDays(ms, n){ const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }
function cardWeek(c){ return c.week || weekStart(tsMs(c.createdAt) || Date.now()); }
function sod(ms){ const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
const DIAS = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
function dayTitle(ms){ const d = new Date(ms), t = `${DIAS[d.getDay()].replace('-feira', '')}, ${d.getDate()} de ${MESES[d.getMonth()]}`; return t.charAt(0).toUpperCase() + t.slice(1); }
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const pad2 = n => String(n).padStart(2, '0');
function isDayList(l){ return !!l && WDAYS[String(l.name).trim().toLowerCase()] !== undefined; }
function dayListFor(day){ const dow = (new Date(day).getDay() + 6) % 7; return lists.find(l => WDAYS[String(l.name).trim().toLowerCase()] === dow); }
function hasTime(c){ return !!c.due && !c.allDay; }
function minsOf(ms){ const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); }
function fmtT(ms){ const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function cardDate(c){
  if(c.due) return sod(c.due);
  const l = lists.find(x => x.id === c.listId);
  if(isDayList(l)) return addDays(cardWeek(c), WDAYS[String(l.name).trim().toLowerCase()]);
  return cardWeek(c);
}
function cardStartDay(c){ return c.start ? Math.min(sod(c.start), cardDate(c)) : cardDate(c); }
function isInbox(c){ const l = lists.find(x => x.id === c.listId); return !c.due && !c.done && !isDayList(l) && !(l && /conclu/i.test(l.name)); }
function vis(c){
  if(filter.q && !(String(c.title) + ' ' + String(c.desc || '')).toLowerCase().includes(filter.q.toLowerCase())) return false;
  if(filter.who && !(c.assignees || []).includes(filter.who)) return false;
  if(filter.st === 'done' && !c.done) return false;
  if(filter.st === 'open' && c.done) return false;
  if(filter.st === 'late' && !(!c.done && c.due && c.due < Date.now())) return false;
  return true;
}
function cardsOnDay(d){ return cards.filter(c => vis(c) && !isInbox(c) && cardStartDay(c) <= d && d <= cardDate(c)).sort((a, z) => (a.done - z.done) || ((hasTime(a) ? a.due : 0) - (hasTime(z) ? z.due : 0)) || ((a.order || 0) - (z.order || 0))); }
function daysShown(){
  if(mode === 'dia') return [selDay];
  if(mode === 'semana'){ const w = weekStart(selDay); return [0, 1, 2, 3, 4, 5, 6].map(i => addDays(w, i)); }
  return Array.from({ length: customN }, (_, i) => addDays(selDay, i));
}
function setMode(m){ mode = m; savePref(); pickerOpen = false; filterOpen = filterOpen; composing = null; mainSig = ''; renderMain(true); }
function pickDay(d){ selDay = sod(d); pickerOpen = false; goWeek(weekStart(d)); }
function stepPeriod(delta){
  if(mode === 'dia') { pickDay(addDays(selDay, delta)); return; }
  if(mode === 'semana'){ pickDay(addDays(selDay, 7 * delta)); return; }
  if(mode === 'custom'){ pickDay(addDays(selDay, customN * delta)); return; }
  goMonth(delta);
}
function curWeek(){ return weekStart(Date.now()); }
function weekOpen(w){ const c = curWeek(); return w === c || w === addDays(c, 7); }   // só a semana atual e a próxima recebem cartões
function weeksOfMonth(y, m){ const out = []; let d = weekStart(new Date(y, m, 1).getTime()); if(new Date(d).getMonth() !== m || new Date(d).getFullYear() !== y) d = addDays(d, 7); while(new Date(d).getMonth() === m){ out.push(d); d = addDays(d, 7); } return out; }
function shortDay(ms){ return new Date(ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', ''); }
function weekLabel(w){ const ab = x => new Date(x).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''); const e = addDays(w, 5), a = new Date(w), z = new Date(e); return a.getMonth() === z.getMonth() ? `${a.getDate()}–${z.getDate()} ${ab(e)}` : `${a.getDate()} ${ab(w)} – ${z.getDate()} ${ab(e)}`; }
function goWeek(w){ wk = w; if(sod(selDay) < w || sod(selDay) > addDays(w, 6)){ const t = sod(Date.now()); selDay = (t >= w && t <= addDays(w, 6)) ? t : w; } const d = new Date(w); moY = d.getFullYear(); moM = d.getMonth(); composing = null; mainSig = ''; renderMain(true); }
function goMonth(delta){
  if(delta === 0){ selDay = sod(Date.now()); pickerOpen = false; goWeek(curWeek()); return; }
  const d = new Date(moY, moM + delta, 1); moY = d.getFullYear(); moM = d.getMonth();
  const ws = weeksOfMonth(moY, moM); const c = curWeek();
  wk = ws.includes(c) ? c : (ws.includes(addDays(c, 7)) ? addDays(c, 7) : ws[0]);
  selDay = wk; pickerOpen = false; composing = null; mainSig = ''; renderMain(true);
}

// permissões (espelham as regras do Firestore)
function memberRole(b){ return (b && b.members && b.members[myUid]) || ''; }
function canManage(b){ return !!b && (isAdmin || b.ownerUid === myUid); }
function canEditAll(b){ return canManage(b) || memberRole(b) === 'editor'; }
function canAdd(b){ return canEditAll(b) || memberRole(b) === 'colab'; }
function canEditCard(b, c){ return canEditAll(b) || (memberRole(b) === 'colab' && c && c.createdBy === myUid); }
function roleKey(b){
  if(b.ownerUid === myUid) return 'dono';
  const r = memberRole(b);
  if(r) return r;
  return isAdmin ? 'admin' : 'leitor';
}
const BOARD_COLORS = ['#8b6446','#a9764a','#6f4e37','#b5835a','#7a5c43','#9c6b4e','#5e4330','#c08a5c'];
function boardColor(k){ let h = 0; String(k || '').split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return BOARD_COLORS[h % BOARD_COLORS.length]; }
function roleLabel(b){ const k = roleKey(b); return k === 'admin' ? 'Admin' : ROLES[k] || ''; }
function myPermNote(b){
  if(canEditAll(b)) return '';
  if(canAdd(b)) return 'Você pode incluir cartões e editar os que criou.';
  return 'Somente leitura. Você vê a agenda, mas não altera.';
}

// datas
function dueInfo(c){
  if(!c.due) return null;
  const d = new Date(c.due), now = new Date();
  const sod = x => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y.getTime(); };
  const diff = Math.round((sod(d) - sod(now)) / 86400000);
  const hh = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  let label;
  if(diff === 0) label = c.allDay ? 'Hoje' : 'Hoje, ' + hh;
  else if(diff === 1) label = c.allDay ? 'Amanhã' : 'Amanhã, ' + hh;
  else label = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '') + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '');
  let tone = '';
  if(c.done) tone = 'ok';
  else if(c.due < now.getTime()) tone = 'late';
  else if(diff === 0) tone = 'soon';
  return { label, tone };
}
function toLocalInput(ms){
  if(!ms) return '';
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function ago(ms){
  if(!ms) return '';
  const diff = Date.now() - ms;
  if(diff < 60000) return 'agora';
  if(diff < 3600000) return Math.floor(diff / 60000) + ' min';
  if(diff < 86400000) return Math.floor(diff / 3600000) + ' h';
  return new Date(ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
}

// ---------- ESTILO ----------
const CSS = `
/* menu circular (celular) */
#railFabBadge{position:absolute; top:-2px; right:-2px; min-width:20px; height:20px; padding:0 5px; border-radius:10px; background:var(--badge-bg); color:var(--badge-ink); font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; border:2px solid var(--rail-bg); line-height:1;}
.rail-mob-only{display:none !important;}
@media (max-width:768px), (pointer:coarse) and (max-height:520px){
  #rail{z-index:40; overflow:visible;}
  #rail .rail-btn[data-section="agendas"], #rail .rail-btn[data-section="demands"], #rail .rail-btn[data-section="requisicao"]{display:none !important;}
  #rail .rail-btn[data-section="home"]{order:1;}
  #rail .rail-btn[data-section="sheets"]{order:2;}
  #rail #railMeBtn{order:3; flex:0 0 84px; position:relative; align-self:flex-start; padding-top:0; padding-bottom:0;}
  #rail .rail-btn[data-section="chats"]{order:4;}
  #rail #railAdminBtn, #rail #railSetBtn{order:5;}
  #rail .rail-mob-only:not(.hidden){display:flex !important;}
  #rail #railMeBtn .rail-label{display:none !important;}
  #rail #railMeBtn .rail-ico.rail-me{width:62px; height:62px; min-width:62px; flex:none; border-radius:50%; margin:-26px auto 0; background:var(--rail-bg); position:relative; display:flex; align-items:center; justify-content:center; box-shadow:0 0 0 5px var(--rail-bg), 0 10px 22px rgba(0,0,0,.30); transition:transform .22s cubic-bezier(.3,1.4,.5,1), box-shadow .2s;}
  #rail #railMeBtn .rail-avatar{width:54px; height:54px; min-width:54px; flex:none; font-size:19px; box-shadow:none !important;}
  #rail.fan-open #railMeBtn .rail-ico.rail-me{transform:scale(.92); box-shadow:0 0 0 5px var(--rail-bg), 0 0 0 7px var(--rail-indicator), 0 10px 22px rgba(0,0,0,.30);}
  #rail #railMeBtn:focus-visible .rail-ico.rail-me{box-shadow:0 0 0 5px var(--rail-bg), 0 0 0 7px var(--accent);}
}
.ag-fan{position:fixed; inset:0; z-index:300; touch-action:none;}
.ag-fan-scrim{position:absolute; inset:0; background:rgba(22,13,8,.58); -webkit-backdrop-filter:blur(3px); backdrop-filter:blur(3px); opacity:0; transition:opacity .2s ease-out;}
.ag-fan.in .ag-fan-scrim{opacity:1;}
.ag-fan-item{position:absolute; left:0; top:0; width:60px; height:60px; margin:-30px 0 0 -30px; border-radius:50%; border:0; padding:0; cursor:pointer; background:var(--accent); color:var(--accent-ink); display:flex; align-items:center; justify-content:center; box-shadow:0 10px 24px rgba(0,0,0,.34); opacity:0; transform:translate(var(--sx), var(--sy)) scale(.3); transition:transform .38s cubic-bezier(.3,1.45,.5,1) var(--d), opacity .16s ease-out var(--d);}
.ag-fan.in .ag-fan-item{opacity:1; transform:translate(var(--tx), var(--ty)) scale(1);}
.ag-fan-item:active{filter:brightness(.92);}
.ag-fan-item:focus-visible{outline:3px solid #fff; outline-offset:3px;}
.ag-fan-item svg{width:26px; height:26px;}
.ag-fan-lbl{position:absolute; top:100%; left:50%; transform:translateX(-50%); margin-top:7px; font-size:13px; font-weight:700; color:#fff; white-space:nowrap; text-shadow:0 1px 6px rgba(0,0,0,.6);}
.ag-fan-badge{position:absolute; top:-3px; right:-3px; min-width:20px; height:20px; padding:0 5px; border-radius:10px; background:var(--badge-bg); color:var(--badge-ink); font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; border:2px solid var(--accent); line-height:1;}
@media (prefers-reduced-motion:reduce){
  .ag-fan-item, .ag-fan-scrim, #rail #railMeBtn .rail-ico.rail-me{transition:opacity .01s !important;}
  .ag-fan-item{transform:translate(var(--tx), var(--ty)) scale(1) !important;}
}

/* lista de agendas (coluna da esquerda) */
.ag-sec{font-size:12.5px; font-weight:800; color:var(--ink-soft); padding:16px 16px 6px; letter-spacing:.01em;}
.ag-row{display:flex; align-items:center; gap:12px; padding:11px 16px; cursor:pointer; border-bottom:1px solid var(--line);}
.ag-row:hover{background:var(--row-hover);}
.ag-row.active{background:var(--row-active);}
.ag-row:focus-visible{outline:2px solid var(--accent); outline-offset:-2px;}
.ag-ico{width:42px; height:42px; border-radius:12px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:800; font-size:17px; flex:none; background:var(--av, var(--accent));}
.ag-row-main{flex:1; min-width:0;}
.ag-row-name{font-size:15px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.ag-row-sub{font-size:12.5px; color:var(--ink-soft); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.ag-role{font-size:11px; font-weight:800; padding:3px 9px; border-radius:999px; background:var(--surface-2); color:var(--ink-soft); white-space:nowrap; display:inline-flex; align-items:center; gap:4px; flex:none;}
.ag-role svg{width:11px; height:11px;}
.ag-role.dono{background:var(--accent); color:var(--accent-ink);}
.ag-role.editor{background:var(--accent-soft); color:var(--accent-strong);}
.ag-role.admin{background:transparent; color:var(--ink); box-shadow:inset 0 0 0 1.5px var(--line-strong, var(--line));}
.ag-empty{padding:34px 22px; text-align:center; color:var(--ink-soft); font-size:14px; line-height:1.55;}
.ag-empty b{display:block; color:var(--ink); font-size:16px; margin-bottom:4px;}
.ag-empty .ag-btn{margin-top:14px;}

/* botões */
.ag-btn{display:inline-flex; align-items:center; justify-content:center; gap:7px; border:1px solid var(--line); background:var(--surface-2); color:var(--ink); font-size:14px; font-weight:700; padding:10px 16px; border-radius:11px; cursor:pointer; font-family:inherit;}
.ag-btn:hover{border-color:var(--accent);}
.ag-btn:focus-visible{outline:2px solid var(--accent); outline-offset:2px;}
.ag-btn svg{width:16px; height:16px;}
.ag-btn.pri{background:var(--accent); border-color:var(--accent); color:var(--accent-ink);}
.ag-btn.pri:hover{filter:brightness(1.06);}
.ag-btn.danger{color:var(--danger);}
.ag-btn.danger.armed{background:var(--danger); border-color:var(--danger); color:#fff;}
.ag-btn.sm{padding:7px 12px; font-size:13px; border-radius:9px;}
.ag-btn:disabled{opacity:.5; cursor:default;}

/* período (mês e semanas) */
.ag-period{flex-shrink:0; padding:10px 16px 8px; background:var(--surface); border-bottom:1px solid var(--line);}
.ag-mo{display:flex; align-items:center; gap:4px;}
.ag-mo-t{flex:1; text-align:center; font-weight:800; font-size:16px; letter-spacing:-.01em;}
.ag-mo-t i{font-style:normal; font-weight:600; color:var(--ink-soft);}
.ag-wks{display:flex; gap:8px; overflow-x:auto; padding:10px 0 2px; scrollbar-width:none;}
.ag-wks::-webkit-scrollbar{display:none;}
.ag-wk{flex:0 0 auto; display:flex; flex-direction:column; align-items:flex-start; gap:1px; padding:7px 13px; border-radius:12px; border:1px solid var(--line); background:var(--surface-2); color:var(--ink); cursor:pointer; font:inherit; text-align:left; min-width:104px;}
.ag-wk b{font-size:13.5px; font-weight:800;}
.ag-wk span{font-size:11.5px; font-weight:600; color:var(--ink-soft);}
.ag-wk.past{opacity:.72;}
.ag-wk.on{background:var(--accent); border-color:var(--accent); color:var(--accent-ink); opacity:1;}
.ag-wk.on span{color:var(--accent-ink); opacity:.85;}
.ag-wk:focus-visible{outline:2px solid var(--accent-strong); outline-offset:2px;}
.ag-day{font-style:normal; font-size:12px; font-weight:700; color:var(--ink-soft); margin-left:6px;}
.ag-day.today{color:var(--accent-strong); background:var(--accent-soft); padding:1px 7px; border-radius:999px;}

.ag-tabs{display:flex; gap:4px; padding:3px; margin-bottom:8px; background:var(--surface-2); border-radius:12px;}
.ag-tab{flex:1; padding:7px 4px; border:0; border-radius:9px; background:transparent; color:var(--ink-soft); font:inherit; font-size:13.5px; font-weight:700; cursor:pointer;}
.ag-tab.on{background:var(--surface); color:var(--ink); box-shadow:0 1px 3px rgba(0,0,0,.12);}
.ag-tab:focus-visible{outline:2px solid var(--accent-strong); outline-offset:1px;}
.ag-period{position:relative;}
.ag-mo-t{border:0; background:transparent; color:inherit; font:inherit; font-weight:800; font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px; padding:6px 8px; border-radius:10px;}
.ag-mo-t svg{width:15px; height:15px; color:var(--ink-soft);}
.ag-mo-t:hover{background:var(--surface-2);}
.ag-pk-bg{position:fixed; inset:0; z-index:30;}
.ag-pk{position:absolute; z-index:31; left:50%; transform:translateX(-50%); top:96px; width:min(320px, calc(100vw - 32px)); background:var(--surface); border:1px solid var(--line); border-radius:16px; box-shadow:0 18px 40px rgba(0,0,0,.28); padding:12px; animation:agFade .12s;}
.ag-pk-h{display:flex; align-items:center; justify-content:space-between; text-transform:capitalize; margin-bottom:6px;}
.ag-pk-w, .ag-pk-g{display:grid; grid-template-columns:repeat(7, 1fr); gap:2px; text-align:center;}
.ag-pk-w i{font-style:normal; font-size:11.5px; font-weight:700; color:var(--ink-soft); padding:4px 0; text-transform:uppercase; letter-spacing:.02em;}
.ag-pk-d{position:relative; aspect-ratio:1; border:0; border-radius:50%; background:transparent; color:var(--ink); font:inherit; font-size:14px; font-weight:600; cursor:pointer;}
.ag-pk-d:hover{background:var(--surface-2);}
.ag-pk-d.out{color:var(--ink-soft); opacity:.5;}
.ag-pk-d.today{box-shadow:inset 0 0 0 1.5px var(--accent);}
.ag-pk-d.sel{background:var(--accent); color:var(--accent-ink); opacity:1;}
.ag-pk-d.has::after{content:''; position:absolute; bottom:4px; left:50%; width:4px; height:4px; margin-left:-2px; border-radius:50%; background:currentColor; opacity:.7;}
.ag-view{flex:1; min-height:0; overflow-y:auto; padding:14px 16px 24px; -webkit-overflow-scrolling:touch;}
.ag-day-card{max-width:560px; margin:0 auto; background:var(--surface-2); border:1px solid var(--line); border-radius:18px; padding:6px 10px 10px;}
.ag-day-h{display:flex; align-items:center; justify-content:space-between; padding:10px 6px 8px;}
.ag-day-h h3{margin:0; font-size:16px; font-weight:800;}
.ag-day-l{display:flex; flex-direction:column; gap:8px;}
.ag-nothing{padding:18px 6px; color:var(--ink-soft); font-size:14px;}
.ag-ag-day{max-width:560px; margin:0 auto 14px; display:flex; flex-direction:column; gap:8px;}
.ag-ag-day h3{margin:4px 2px 0; font-size:14px; font-weight:800; color:var(--ink-soft); display:flex; align-items:center; gap:8px;}
.ag-ag-day h3.today{color:var(--accent-strong);}
.ag-ag-day h3 em{font-style:normal; font-size:11px; background:var(--accent); color:var(--accent-ink); padding:2px 8px; border-radius:999px;}
.ag-mgrid{max-width:980px; margin:0 auto; background:var(--surface); border:1px solid var(--line); border-radius:16px; overflow:hidden;}
.ag-mh, .ag-mb{display:grid; grid-template-columns:repeat(7, minmax(0, 1fr));}
.ag-mh i{font-style:normal; text-align:center; padding:8px 0; font-size:12px; font-weight:700; text-transform:uppercase; color:var(--ink-soft); border-bottom:1px solid var(--line); background:var(--surface-2);}
.ag-mc{min-height:92px; display:flex; flex-direction:column; align-items:stretch; gap:3px; padding:6px; border:0; border-right:1px solid var(--line); border-bottom:1px solid var(--line); background:var(--surface); color:var(--ink); font:inherit; text-align:left; cursor:pointer; overflow:hidden;}
.ag-mc:nth-child(7n){border-right:0;}
.ag-mc:hover{background:var(--surface-2);}
.ag-mc.out{background:var(--surface-2); opacity:.6;}
.ag-mc.sel{box-shadow:inset 0 0 0 2px var(--accent);}
.ag-mc-n{align-self:flex-end; font-size:13px; font-weight:700; min-width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%;}
.ag-mc.today .ag-mc-n{background:var(--accent); color:var(--accent-ink);}
.ag-ev{font-size:11.5px; font-weight:600; padding:2px 6px; min-width:0; border-radius:6px; background:var(--accent-soft); color:var(--accent-strong); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.ag-ev.done{opacity:.55; text-decoration:line-through;}
.ag-ev.late{background:rgba(193,80,61,.14); color:var(--danger);}
.ag-ev.more{background:transparent; color:var(--ink-soft);}
.ag-dotn{display:none; font-size:14px; line-height:1; color:var(--accent-strong); letter-spacing:1px; align-self:center;}
@media (max-width:768px), (pointer:coarse) and (max-height:520px){
  .ag-mc{min-height:56px; align-items:center; padding:4px 2px;}
  .ag-mc-n{align-self:center;}
  .ag-mc .ag-ev, .ag-mc .ag-more{display:none;}
  .ag-dotn{display:block;}
  .ag-gh b{font-size:15px; min-width:28px; height:28px;}
  .ag-view{padding:12px 12px 24px;}
  .ag-pk{top:112px;}
}

.ag-bar{display:flex; align-items:center; gap:8px; margin-bottom:8px;}
.ag-spacer{flex:1;}
.ag-view-btn{display:inline-flex; align-items:center; gap:6px; padding:8px 12px; border-radius:11px; border:1px solid var(--line); background:var(--surface-2); color:var(--ink); font:inherit; font-size:14px; font-weight:800; cursor:pointer;}
.ag-view-btn svg{width:15px; height:15px; color:var(--ink-soft);}
.ag-view-btn:focus-visible{outline:2px solid var(--accent-strong); outline-offset:2px;}
.ag-bar .head-btn.on{background:var(--accent-soft); color:var(--accent-strong);}
.ag-bar .ag-btn svg{width:15px; height:15px;}
.ag-filter{display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px;}
.ag-filter .ag-field{flex:1 1 180px; min-width:0;}
.ag-filter .ag-select{flex:1 1 150px; min-width:0;}
.ag-allday{display:flex; align-items:center; gap:8px; margin-top:8px; font-size:13.5px; font-weight:600; color:var(--ink-soft);}
.ag-allday input{width:auto !important; accent-color:var(--accent);}
.ag-opt{font-weight:500; color:var(--ink-soft); font-size:12px;}
.ag-split{flex:1; min-height:0; display:flex;}
.ag-split > .ag-view{flex:1; min-width:0;}
.ag-side{display:none; width:300px; flex:none; overflow-y:auto; border-left:1px solid var(--line); background:var(--surface); padding:14px;}
@media (min-width:1000px) and (pointer:fine){ .ag-side{display:block;} }
.ag-side-cal .ag-pk-d{font-size:13px;}
.ag-pk-d.rng{background:var(--accent-soft); border-radius:8px;}
.ag-inbox{margin-top:16px; border:1px dashed var(--line); border-radius:14px; padding:10px; transition:background .12s, border-color .12s;}
.ag-inbox.drop{background:var(--accent-soft); border-color:var(--accent);}
.ag-inbox.full{margin:0 auto; max-width:560px; background:var(--surface-2); border-style:solid;}
.ag-inb-h{display:flex; align-items:center; justify-content:space-between;}
.ag-inb-h h3{margin:0; font-size:15px; font-weight:800;}
.ag-inb-hint{font-size:12.5px; color:var(--ink-soft); margin:2px 0 8px;}
.ag-inb-add{display:flex; gap:6px; margin-bottom:8px;}
.ag-inb-add .ag-field{flex:1; min-width:0;}
.ag-inb-l{display:flex; flex-direction:column; gap:6px;}
.ag-inb{padding:9px 11px; border-radius:10px; background:var(--surface); border:1px solid var(--line); font-size:14px; font-weight:600; cursor:grab; box-shadow:0 1px 2px rgba(0,0,0,.06);}
.ag-inb:focus-visible, .ag-ev:focus-visible, .ag-gev:focus-visible{outline:2px solid var(--accent-strong); outline-offset:1px;}
.ag-view.grid{padding:0; display:flex; flex-direction:column; overflow:hidden;}
.ag-gscroll{flex:1; min-height:0; overflow:auto; position:relative; --hh:54px;}
.ag-ghead, .ag-gall{display:grid; grid-template-columns:52px repeat(var(--cols), minmax(var(--cw), 1fr)); position:sticky; background:var(--surface); z-index:4;}
.ag-ghead{top:0; height:62px; border-bottom:1px solid var(--line);}
.ag-gall{top:62px; border-bottom:1px solid var(--line); z-index:3;}
.ag-gcorner{display:flex; align-items:center; justify-content:center; font-size:10.5px; color:var(--ink-soft); font-weight:700; text-align:center; line-height:1.1;}
.ag-gh{display:flex; flex-direction:column; align-items:center; padding:8px 0 6px; border-left:1px solid var(--line); gap:2px;}
.ag-gh span{font-size:12px; font-weight:700; text-transform:uppercase; color:var(--ink-soft);}
.ag-gh b{font-size:17px; font-weight:800; min-width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%;}
.ag-gh.today span{color:var(--accent-strong);}
.ag-gh.today b{background:var(--accent); color:var(--accent-ink);}
.ag-gad{border-left:1px solid var(--line); padding:4px; display:flex; flex-direction:column; gap:3px; min-height:34px; position:relative; transition:background .12s;}
.ag-gadd{align-self:flex-start; border:0; background:transparent; color:var(--ink-soft); cursor:pointer; padding:2px; border-radius:6px; opacity:.6;}
.ag-gadd:hover{opacity:1; background:var(--surface-2);}
.ag-gadd svg{width:14px; height:14px;}
.ag-grid{display:grid; grid-template-columns:52px repeat(var(--cols), minmax(var(--cw), 1fr)); height:calc(var(--n) * var(--hh));}
.ag-gscroll.fit .ag-grid{height:100%; min-height:calc(var(--n) * 22px);}
.ag-gutter{display:flex; flex-direction:column; position:sticky; left:0; background:var(--surface); z-index:2;}
.ag-hr{flex:1; position:relative; min-height:0;}
.ag-hr span{position:absolute; top:-8px; right:6px; font-size:11px; color:var(--ink-soft); font-weight:600;}
.ag-gcol{position:relative; border-left:1px solid var(--line); background-image:repeating-linear-gradient(to bottom, transparent 0, transparent calc(100% / var(--n) - 1px), var(--line) calc(100% / var(--n) - 1px), var(--line) calc(100% / var(--n))); cursor:cell; transition:background-color .12s;}
.ag-gcol.today{background-color:var(--accent-soft);}
.ag-gcol.drop, .ag-gad.drop, .ag-mc.drop, .ag-ag-day.drop{background-color:var(--accent-soft); box-shadow:inset 0 0 0 2px var(--accent);}
.ag-gev{position:absolute; box-sizing:border-box; padding:3px 6px; border-radius:7px; background:var(--accent); color:var(--accent-ink); font-size:12px; font-weight:600; overflow:hidden; cursor:grab; line-height:1.25; box-shadow:0 1px 3px rgba(0,0,0,.2);}
.ag-gev b{font-weight:800;}
.ag-gev.done{opacity:.55; text-decoration:line-through;}
.ag-gev.late{background:var(--danger); color:#fff;}
.ag-now{position:absolute; left:0; right:0; height:0; border-top:2px solid var(--danger); z-index:2; pointer-events:none;}
.ag-now::before{content:''; position:absolute; left:-4px; top:-5px; width:8px; height:8px; border-radius:50%; background:var(--danger);}
.ag-cghost{position:fixed !important; z-index:9999; pointer-events:none; box-shadow:0 14px 30px rgba(0,0,0,.35); opacity:.96; border-radius:10px; margin:0; max-width:240px; overflow:hidden; white-space:normal;}
.ghosted{opacity:.35;}
body.ag-dragging{user-select:none; -webkit-user-select:none; cursor:grabbing;}
.ag-ev{cursor:grab;}
.ag-ev b{font-weight:800;}
.ag-ev.span{border-radius:2px 6px 6px 2px; background:var(--accent-soft); opacity:.85;}
.ag-ev.span::before{content:'↔ ';}
.ag-more{font-size:11.5px; color:var(--ink-soft); font-weight:700; padding-left:4px;}
.ag-ag-day{transition:background-color .12s; border-radius:12px;}

.ag-tray{display:none;}
@media (max-width:768px), (pointer:coarse) and (max-height:520px){
  .ag-tray{display:block; margin:12px auto 0; max-width:560px; background:var(--surface-2); border:1px solid var(--line); border-radius:16px; padding:6px 10px 10px;}
  .ag-tray-t{display:flex; gap:4px; padding:4px 0 8px;}
  .ag-tray-t button{flex:1; padding:8px 6px; border:0; border-radius:10px; background:transparent; color:var(--ink-soft); font:inherit; font-size:13.5px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;}
  .ag-tray-t button.on{background:var(--surface); color:var(--ink); box-shadow:0 1px 3px rgba(0,0,0,.12);}
  .ag-tray-l{display:flex; flex-direction:column; gap:8px; border-radius:12px; padding:2px;}
  .ag-tray-l.drop{background:var(--accent-soft);}
  .ag-tray .ag-inbox{margin:0; border:0; padding:0; background:transparent;}
  .ag-mc.sel .ag-mc-n{background:var(--accent-soft); color:var(--accent-strong);}
  .ag-mc.today.sel .ag-mc-n{background:var(--accent); color:var(--accent-ink);}
}

/* quadro */
.ag-wrap{position:relative; flex:1; min-height:0; display:flex; flex-direction:column;}
.ag-note{padding:8px 16px; font-size:12.5px; font-weight:600; color:var(--accent-strong); background:var(--accent-soft); display:flex; align-items:center; gap:8px; flex-shrink:0;}
.ag-note svg{width:14px; height:14px;}
.ag-board{flex:1; min-height:0; display:flex; align-items:flex-start; gap:12px; padding:14px 16px 12px; overflow-x:auto; overflow-y:hidden; scroll-snap-type:x mandatory; scroll-padding:0 16px; scrollbar-width:thin; scrollbar-color:var(--line) transparent; overscroll-behavior-x:contain;}
.ag-col{flex:0 0 304px; max-height:100%; display:flex; flex-direction:column; background:var(--surface-2); border:1px solid var(--line); border-radius:16px; scroll-snap-align:start; box-shadow:0 1px 2px rgba(59,42,31,.06);}
.ag-col-h{display:flex; align-items:center; gap:8px; padding:12px 8px 8px 14px;}
.ag-col-h h3{margin:0; flex:1; min-width:0; font-size:15px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.ag-count{font-size:12px; font-weight:800; color:var(--ink-soft); background:var(--surface); border:1px solid var(--line); border-radius:999px; min-width:24px; padding:1px 7px; text-align:center;}
.ag-cards{flex:1; min-height:12px; overflow-y:auto; padding:2px 10px 4px; scrollbar-width:thin; scrollbar-color:var(--line) transparent; overscroll-behavior:contain;}
.ag-card{position:relative; display:flex; gap:10px; align-items:flex-start; background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:11px 12px 11px 10px; margin:0 0 8px; cursor:pointer; box-shadow:0 1px 1px rgba(59,42,31,.07); -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; transition:box-shadow .15s, border-color .15s;}
.ag-card:hover{border-color:var(--accent); box-shadow:0 3px 10px rgba(59,42,31,.12);}
.ag-card:focus-visible{outline:2px solid var(--accent); outline-offset:2px;}
.ag-card.late::before{content:''; position:absolute; left:0; top:10px; bottom:10px; width:3px; border-radius:0 3px 3px 0; background:var(--danger);}
.ag-card.done .ag-ct{color:var(--ink-soft); text-decoration:line-through; text-decoration-thickness:1px;}
.ag-card.ghosted{display:none;}
.ag-check{width:22px; height:22px; margin-top:1px; border-radius:50%; border:2px solid var(--ink-soft); background:transparent; padding:0; flex:none; cursor:pointer; display:flex; align-items:center; justify-content:center; color:#fff; transition:background .15s, border-color .15s;}
.ag-check svg{width:12px; height:12px; stroke-width:3.2; opacity:0; transition:opacity .12s;}
.ag-check:hover{border-color:var(--ok);}
.ag-check.on{background:var(--ok); border-color:var(--ok);}
.ag-check.on svg{opacity:1;}
.ag-check.static{cursor:default; pointer-events:none;}
.ag-cbody{flex:1; min-width:0;}
.ag-ct{font-size:14.5px; font-weight:650; line-height:1.38; word-break:break-word;}
.ag-meta{display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px; margin-top:7px; font-size:12px; color:var(--ink-soft);}
.ag-chip{display:inline-flex; align-items:center; gap:4px; font-weight:700; padding:2px 7px; border-radius:7px; background:var(--surface-2); color:var(--ink-soft);}
.ag-chip svg{width:12px; height:12px;}
.ag-chip.late{background:rgba(193,80,61,.14); color:var(--danger);}
.ag-chip.soon{background:rgba(217,138,28,.16); color:#b46e0e;}
.ag-chip.ok{background:rgba(46,158,91,.15); color:#23824a;}
html[data-mode="dark"] .ag-chip.soon{color:#f0b35a;} html[data-mode="dark"] .ag-chip.ok{color:#6fd39a;} html[data-mode="dark"] .ag-chip.late{color:#f08a76;}
.ag-by{font-weight:600;}
.ag-avs{display:flex; margin-left:auto;}
.ag-avs .avatar{width:24px !important; height:24px !important; font-size:10px !important; border:2px solid var(--surface); margin-left:-6px;}
.ag-avs .avatar:first-child{margin-left:0;}
.ag-foot{padding:6px 10px 10px;}
.ag-add{display:flex; align-items:center; gap:8px; width:100%; border:0; background:transparent; color:var(--ink-soft); font-size:14px; font-weight:700; padding:9px 8px; border-radius:10px; cursor:pointer; text-align:left;}
.ag-add:hover{background:var(--row-hover); color:var(--accent-strong);}
.ag-add svg{width:17px; height:17px;}
.ag-add.lock{cursor:default; color:var(--ink-soft); opacity:.75;}
.ag-add.lock:hover{background:transparent; color:var(--ink-soft);}
.ag-compose textarea{width:100%; min-height:62px; resize:none; border:1px solid var(--accent); border-radius:10px; background:var(--surface); color:var(--ink); font-size:14.5px; padding:9px 10px; outline:none; font-family:inherit; line-height:1.4; box-shadow:0 0 0 3px var(--accent-soft);}
.ag-compose-act{display:flex; gap:8px; margin-top:8px;}
.ag-newcol{flex:0 0 304px; scroll-snap-align:start;}
.ag-newcol .ag-add{background:var(--surface-2); border:1px dashed var(--line); border-radius:16px; padding:14px;}
.ag-newcol .ag-add:hover{border-color:var(--accent);}
.ag-newcol input{width:100%; border:1px solid var(--accent); border-radius:10px; background:var(--surface); color:var(--ink); padding:10px 11px; font-size:14.5px; outline:none; font-family:inherit; box-shadow:0 0 0 3px var(--accent-soft);}
.ag-dots{display:none; justify-content:center; gap:6px; padding:2px 0 10px; flex-shrink:0;}
.ag-dots i{width:6px; height:6px; border-radius:50%; background:var(--line); transition:background .15s, transform .15s;}
.ag-dots i.on{background:var(--accent); transform:scale(1.35);}
.ag-drop{border:2px dashed var(--accent); background:var(--accent-soft); border-radius:12px; margin:0 0 8px;}
.ag-ghost{position:fixed; left:0; top:0; z-index:900; pointer-events:none; margin:0 !important; transform-origin:30% 20%; box-shadow:0 18px 40px rgba(0,0,0,.32) !important; border-color:var(--accent) !important; cursor:grabbing;}
body.ag-dragging{cursor:grabbing; -webkit-user-select:none; user-select:none;}
body.ag-dragging .ag-board{scroll-snap-type:none;}
.ag-empty-board{margin:auto; text-align:center; padding:30px; color:var(--ink-soft); max-width:340px;}
.ag-empty-board b{display:block; color:var(--ink); font-size:17px; margin-bottom:6px;}
.ag-empty-board .ag-btn{margin-top:14px;}

/* folha de detalhe (cartão / membros) */
.ag-scrim{position:absolute; inset:0; z-index:30; background:rgba(22,13,8,.42); animation:agFade .18s ease-out;}
.ag-sheet{position:absolute; z-index:31; background:var(--bg); color:var(--ink); display:flex; flex-direction:column; overflow:hidden; right:0; top:0; bottom:0; width:min(460px, 100%); box-shadow:-14px 0 40px rgba(0,0,0,.22); border-left:1px solid var(--line); animation:agSlide .22s cubic-bezier(.2,.9,.3,1);}
.ag-sh-head{display:flex; align-items:center; gap:6px; padding:8px 8px 8px 16px; min-height:56px; background:var(--head-bg); border-bottom:1px solid var(--line); flex-shrink:0;}
.ag-sh-head h2{margin:0; flex:1; font-size:16px; font-weight:800;}
.ag-sh-body{flex:1; overflow-y:auto; padding:6px 0 24px; overscroll-behavior:contain;}
.ag-title-row{display:flex; gap:12px; align-items:flex-start; padding:14px 16px 4px;}
.ag-title-row .ag-check{width:26px; height:26px; margin-top:3px;}
.ag-title-row .ag-check svg{width:14px; height:14px;}
.ag-title-in{flex:1; width:100%; border:1px solid transparent; background:transparent; font-size:20px; font-weight:800; line-height:1.3; color:var(--ink); resize:none; padding:3px 6px; margin:-3px -6px; border-radius:8px; font-family:inherit; outline:none; overflow:hidden;}
.ag-title-in:not([readonly]):hover{border-color:var(--line);}
.ag-title-in:focus{border-color:var(--accent); background:var(--surface);}
.ag-sub{padding:0 16px 8px 54px; font-size:13px; color:var(--ink-soft);}
.ag-block{padding:14px 16px; border-top:1px solid var(--line);}
.ag-block:first-of-type{border-top:0;}
.ag-lbl{display:flex; align-items:center; gap:8px; font-size:13px; font-weight:800; color:var(--ink-soft); margin-bottom:9px;}
.ag-lbl svg{width:16px; height:16px;}
.ag-lbl .ag-lbl-r{margin-left:auto; font-weight:700; font-size:12.5px;}
.ag-field, .ag-select, .ag-area{width:100%; border:1px solid var(--line); background:var(--input-bg); color:var(--ink); border-radius:10px; padding:10px 11px; font-size:14.5px; font-family:inherit; outline:none;}
.ag-field:focus, .ag-select:focus, .ag-area:focus{border-color:var(--accent); background:var(--surface);}
.ag-area{min-height:84px; resize:vertical; line-height:1.5;}
.ag-field[readonly], .ag-area[readonly], .ag-select:disabled, .ag-field:disabled{opacity:.8; cursor:default;}
.ag-roww{display:flex; gap:8px; align-items:center;}
.ag-prog{height:6px; background:var(--surface-2); border-radius:3px; overflow:hidden; margin:0 0 10px; border:1px solid var(--line);}
.ag-prog i{display:block; height:100%; background:var(--ok); transition:width .25s;}
.ag-ci{display:flex; align-items:flex-start; gap:10px; padding:6px 2px;}
.ag-ci .ag-check{width:20px; height:20px; border-width:2px; border-radius:6px; margin-top:1px;}
.ag-ci .ag-check svg{width:11px; height:11px;}
.ag-ci span{flex:1; font-size:14.5px; line-height:1.4; word-break:break-word;}
.ag-ci.on span{color:var(--ink-soft); text-decoration:line-through;}
.ag-x{border:0; background:transparent; color:var(--ink-soft); cursor:pointer; padding:4px; border-radius:6px; display:inline-flex;}
.ag-x:hover{color:var(--danger); background:var(--row-hover);}
.ag-x svg{width:16px; height:16px;}
.ag-ppl{display:flex; flex-wrap:wrap; gap:8px;}
.ag-p{display:inline-flex; align-items:center; gap:7px; padding:4px 12px 4px 4px; border-radius:999px; border:1px solid var(--line); background:var(--surface); font-size:13px; font-weight:700; cursor:pointer; color:var(--ink); font-family:inherit;}
.ag-p .avatar{width:26px !important; height:26px !important; font-size:10px !important;}
.ag-p.on{background:var(--accent-soft); border-color:var(--accent); color:var(--accent-strong);}
.ag-p:disabled{cursor:default; opacity:.85;}
.ag-cm{display:flex; gap:10px; margin-bottom:13px;}
.ag-cm .avatar{width:30px !important; height:30px !important; font-size:11px !important;}
.ag-cm-b{flex:1; min-width:0;}
.ag-cm-h{font-size:12.5px; color:var(--ink-soft);}
.ag-cm-h b{color:var(--ink); font-weight:800;}
.ag-cm-t{margin-top:3px; background:var(--surface); border:1px solid var(--line); border-radius:4px 12px 12px 12px; padding:8px 11px; font-size:14px; line-height:1.45; white-space:pre-wrap; word-break:break-word;}
.ag-cm-in{position:sticky; bottom:0; display:flex; gap:8px; align-items:flex-end; padding:10px 12px calc(10px + env(safe-area-inset-bottom)); background:var(--head-bg); border-top:1px solid var(--line); flex-shrink:0;}
.ag-cm-in textarea{flex:1; min-height:42px; max-height:120px; resize:none; border:1px solid var(--line); border-radius:21px; background:var(--field); color:var(--ink); padding:11px 15px; font-size:14.5px; font-family:inherit; outline:none; line-height:1.3;}
.ag-cm-in textarea:focus{border-color:var(--accent);}
.ag-cm-in button{width:42px; height:42px; border-radius:50%; border:0; background:var(--accent); color:var(--accent-ink); display:flex; align-items:center; justify-content:center; cursor:pointer; flex:none; padding:0;}
.ag-cm-in button svg{width:19px; height:19px;}
.ag-cm-lock{padding:12px 16px calc(12px + env(safe-area-inset-bottom)); background:var(--head-bg); border-top:1px solid var(--line); font-size:13px; color:var(--ink-soft); text-align:center; flex-shrink:0;}
.ag-mrow{display:flex; align-items:center; gap:12px; padding:10px 16px; border-bottom:1px solid var(--line);}
.ag-mrow .avatar{width:38px !important; height:38px !important;}
.ag-mrow-main{flex:1; min-width:0;}
.ag-mrow-n{font-size:14.5px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.ag-mrow-s{font-size:12.5px; color:var(--ink-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.ag-mrow .ag-select{width:128px; padding:7px 4px 7px 9px; font-size:13px; text-overflow:clip;}
.ag-info{margin:14px 16px 0; font-size:12.5px; line-height:1.55; color:var(--ink-soft); padding:10px 12px; border-radius:10px; background:var(--surface-2); border:1px solid var(--line);}
.ag-hint{font-size:12.5px; color:var(--ink-soft); margin-top:6px; line-height:1.5;}
.ag-seg{display:flex; flex-direction:column; gap:8px;}
.ag-seg label{display:flex; align-items:center; gap:10px; padding:11px 12px; border:1px solid var(--line); border-radius:11px; cursor:pointer; font-size:14px; font-weight:700; background:var(--surface);}
.ag-seg label:has(input:checked){border-color:var(--accent); background:var(--accent-soft); color:var(--accent-strong);}
.ag-seg input{width:auto !important; margin:0 !important; accent-color:var(--accent);}
@keyframes agFade{from{opacity:0}to{opacity:1}}
@keyframes agSlide{from{transform:translateX(24px); opacity:0}to{transform:none; opacity:1}}
@keyframes agUp{from{transform:translateY(40px); opacity:.4}to{transform:none; opacity:1}}
@media (prefers-reduced-motion:reduce){ .ag-sheet, .ag-scrim{animation:none;} .ag-card, .ag-check{transition:none;} }
@media (max-width:768px), (pointer:coarse) and (max-height:520px){
  .ag-board{padding:12px 0 10px; gap:10px; scroll-padding:0 22px;}
  .ag-board::before, .ag-board::after{content:''; flex:0 0 12px;}
  .ag-col, .ag-newcol{flex:0 0 min(calc(100vw - 52px), 340px); scroll-snap-align:center;}
  .ag-dots{display:flex;}
  .ag-sheet{width:100%; border-left:0; animation:agUp .24s cubic-bezier(.2,.9,.3,1);}
  .ag-scrim{display:none;}
}
`;
function injectCss(){
  if(document.getElementById('agStyle')) return;
  const s = document.createElement('style'); s.id = 'agStyle'; s.textContent = CSS;
  document.head.appendChild(s);
}

// ---------- ouvintes ----------
function start(){
  stop();
  injectCss();
  const col = db.collection('boards');
  const q = isAdmin ? col : col.where('memberUids', 'array-contains', myUid);
  unsubBoards = q.onSnapshot(snap => {
    boards = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
    if(view && !boards.some(b => b.id === view.id)){ closeData(); view = null; sheet = null; if(section === 'agendas'){ renderMain(); } }
    first.b = false;
    refresh();
  }, err => { reportListenError('agendas', err); });
}
function stop(){
  if(unsubBoards){ unsubBoards(); unsubBoards = null; }
  closeData();
  boards = []; view = null; sheet = null; composing = null; mainSig = '';
  closeFan(true);
}
function closeData(){
  if(unsubLists){ unsubLists(); unsubLists = null; }
  if(unsubCards){ unsubCards(); unsubCards = null; }
  closeComments();
  lists = []; cards = [];
}
function closeComments(){ if(unsubComments){ unsubComments(); unsubComments = null; } comments = []; }
function leave(){ cancelDrag(); closeData(); view = null; sheet = null; composing = null; mainSig = ''; }

function openBoard(id){
  if(view && view.id === id && unsubCards){ openMain(); renderList(); renderMain(true); return; }
  closeData();
  view = { id }; sheet = null; composing = null; mainSig = ''; wk = curWeek(); moY = new Date().getFullYear(); moM = new Date().getMonth();
  const ref = bRef(id);
  unsubLists = ref.collection('lists').orderBy('order').onSnapshot(snap => {
    lists = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMain();
  }, err => reportListenError('agendas (listas)', err));
  unsubCards = ref.collection('cards').onSnapshot(snap => {
    cards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMain();
  }, err => reportListenError('agendas (cartões)', err));
  openMain();
  renderList();
  renderMain(true);
}

function refresh(){
  if(section !== 'agendas') return;
  renderList();
  if(view) renderMain();
}

// ---------- coluna esquerda ----------
function buildSidebar(head, tools, setFab){
  head.innerHTML = sideHeadHtml('Agendas', [{ id: 'agNewBtn', icon: plusSvg, title: 'Nova agenda', primary: true }]);
  tools.innerHTML = searchBoxHtml('agSearch', 'Buscar agenda…', search);
  byId('agNewBtn').onclick = showNewBoardModal;
  byId('agSearch').oninput = e => { search = e.target.value.trim().toLowerCase(); renderList(); };
  setFab(plusSvg, 'Nova agenda', showNewBoardModal);
}

function rowHtml(b, active){
  const n = (b.memberUids || []).length;
  const k = roleKey(b);
  const pill = k === 'dono' ? '<span class="ag-role dono">Dono</span>'
    : k === 'admin' ? `<span class="ag-role admin">${shieldSvg}Admin</span>`
    : k === 'editor' ? '<span class="ag-role editor">Editor</span>'
    : k === 'leitor' ? `<span class="ag-role">${lockSvg}Leitor</span>`
    : `<span class="ag-role">${esc(ROLES[k] || '')}</span>`;
  const who = b.ownerUid === myUid ? '' : ' · de ' + esc(firstName(b.ownerName) || userName(b.ownerUid));
  return `<div class="ag-row${active ? ' active' : ''}" tabindex="0" role="button" data-ag-open="${attr(b.id)}" aria-label="Abrir agenda ${attr(b.name)}">
    <div class="ag-ico" style="--av:${boardColor(b.id)}">${esc(initials(b.name).slice(0, 1))}</div>
    <div class="ag-row-main"><div class="ag-row-name">${esc(b.name)}</div><div class="ag-row-sub">${n} membro${n === 1 ? '' : 's'}${who}</div></div>
    ${pill}</div>`;
}

function renderList(){
  if(section !== 'agendas') return;
  const list = byId('sideList'); if(!list) return;
  const prev = list.scrollTop;
  const q = search;
  const f = b => !q || String(b.name || '').toLowerCase().includes(q);
  const mine = boards.filter(b => b.ownerUid === myUid && f(b));
  const shared = boards.filter(b => b.ownerUid !== myUid && (b.memberUids || []).includes(myUid) && f(b));
  const others = isAdmin ? boards.filter(b => b.ownerUid !== myUid && !(b.memberUids || []).includes(myUid) && f(b)) : [];
  const act = view && (!isMobile() || mainOpen) ? view.id : null;
  let html = '';
  if(mine.length) html += `<div class="ag-sec">Minhas agendas</div>` + mine.map(b => rowHtml(b, b.id === act)).join('');
  if(shared.length) html += `<div class="ag-sec">Compartilhadas comigo</div>` + shared.map(b => rowHtml(b, b.id === act)).join('');
  if(others.length) html += `<div class="ag-sec">Das outras pessoas (visível por ser admin)</div>` + others.map(b => rowHtml(b, b.id === act)).join('');
  if(!html){
    html = first.b
      ? '<div class="list-empty">Carregando…</div>'
      : (q
        ? `<div class="ag-empty"><b>Nenhuma agenda encontrada</b>Tente outro nome.</div>`
        : `<div class="ag-empty"><b>Comece sua primeira agenda</b>Organize tarefas em listas e cartões, e convide quem vai ajudar.<br><button class="ag-btn pri" id="agEmptyNew">${plusSvg}Nova agenda</button></div>`);
  }
  list.innerHTML = html;
  list.querySelectorAll('[data-ag-open]').forEach(r => onActivate(r, () => openBoard(r.getAttribute('data-ag-open'))));
  const en = byId('agEmptyNew'); if(en) en.onclick = showNewBoardModal;
  list.scrollTop = prev;
}

// ---------- painel principal ----------
function renderMain(force){
  if(section !== 'agendas') return;
  if(drag && drag.active){ dragPendingRender = true; return; }
  const main = byId('mainPane'); if(!main) return;
  const b = curBoard();
  if(!view || !b){ mainSig = ''; if(typeof renderEmptyMain === 'function') renderEmptyMain(); return; }
  const sig = JSON.stringify([b, lists, cards, sheet, comments, composing, confirmDelete, wk, moY, moM, mode, selDay, pickerOpen, pkY, pkM, customN, fit, filter, filterOpen, trayTab, Math.floor(Date.now() / 3600000), isAdmin, allUsers.length, myChatName]);
  if(!force && sig === mainSig) return;
  mainSig = sig;
  mainKey = 'ag:' + b.id;

  // guarda o que a pessoa estava fazendo para não perder ao atualizar
  const board = main.querySelector('.ag-board');
  const keepX = board ? board.scrollLeft : 0;
  const keepY = {};
  main.querySelectorAll('.ag-cards').forEach(el => { keepY[el.getAttribute('data-list')] = el.scrollTop; });
  const viewEl = main.querySelector('.ag-view'); const keepViewY = viewEl ? viewEl.scrollTop : 0;
  const gEl = main.querySelector('.ag-gscroll'); const keepG = gEl ? [gEl.scrollTop, gEl.scrollLeft] : null;
  const sheetBody = main.querySelector('.ag-sh-body');
  const keepSheetY = sheetBody ? sheetBody.scrollTop : 0;
  // título e descrição só são preservados enquanto a pessoa está digitando neles
  const typing = document.activeElement && ['agDesc', 'agTitle'].includes(document.activeElement.id) ? [document.activeElement.id] : [];
  const st = captureInputs(['agCompose', 'agNewList', 'agCmIn', 'agChkIn', 'agQ', 'agInbIn'].concat(typing));

  const can = canEditAll(b);
  const note = myPermNote(b);
  const n = (b.memberUids || []).length;
  main.innerHTML = `
    <div class="pane-head">
      <button class="head-btn back-btn" id="agBack" title="Voltar" aria-label="Voltar">${backSvg}</button>
      <div class="ag-ico" style="--av:${boardColor(b.id)}; width:38px; height:38px; font-size:16px;">${esc(initials(b.name).slice(0, 1))}</div>
      <div class="pane-titles"><div class="pane-title">${esc(b.name)}</div><div class="pane-sub">${n} membro${n === 1 ? '' : 's'} · ${esc(roleLabel(b))}</div></div>
      <button class="head-btn" id="agMembersBtn" title="Membros e permissões" aria-label="Membros e permissões">${usersSvg}</button>
      ${canManage(b) ? `<button class="head-btn" id="agMoreBtn" title="Mais opções" aria-label="Mais opções">${moreSvg}</button>` : ''}
    </div>
    <div class="ag-wrap">
      ${note ? `<div class="ag-note">${canAdd(b) ? I.check : lockSvg}${esc(note)}</div>` : ''}
      ${periodHtml(b)}
      <div class="pane-body wallpaper" style="display:flex; flex-direction:column; overflow:hidden;">
        ${mode === 'quadro' ? boardHtml(b, can) : viewHtml(b)}
        ${mode === 'quadro' ? `<div class="ag-dots" id="agDots" aria-hidden="true">${lists.map((l, i) => `<i${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div>` : ''}
      </div>
    </div>
    ${sheet ? sheetHtml(b) : ''}`;

  bindMain(main, b);
  restoreInputs(st);
  const nb = main.querySelector('.ag-board'); if(nb) nb.scrollLeft = keepX;
  main.querySelectorAll('.ag-cards').forEach(el => { const y = keepY[el.getAttribute('data-list')]; if(y) el.scrollTop = y; });
  const sb = main.querySelector('.ag-sh-body'); if(sb) sb.scrollTop = keepSheetY;
  const nv = main.querySelector('.ag-view'); if(nv) nv.scrollTop = keepViewY;
  const ng = main.querySelector('.ag-gscroll'); if(ng){ if(keepG){ ng.scrollTop = keepG[0]; ng.scrollLeft = keepG[1]; } else if(!fit) ng.scrollTop = 54; }
  updateDots();
  if(typeof applyShell === 'function') applyShell();
}

const MODES = [['quadro', 'Quadro'], ['dia', 'Dia'], ['semana', 'Semana'], ['custom', 'Personalizar'], ['mes', 'Mês'], ['agenda', 'Agenda'], ['caixa', 'Caixa de entrada']];
function modeLabel(){ const m = MODES.find(x => x[0] === mode); return mode === 'custom' ? customN + ' dias' : (m ? m[1] : ''); }
function rangeTitle(){
  const ab = x => new Date(x).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const d = daysShown(), f = d[0], l = d[d.length - 1];
  return new Date(f).getMonth() === new Date(l).getMonth() ? `${new Date(f).getDate()}–${new Date(l).getDate()} ${ab(l)} ${new Date(l).getFullYear()}` : `${new Date(f).getDate()} ${ab(f)} – ${new Date(l).getDate()} ${ab(l)}`;
}
function periodHtml(b){
  const c = curWeek(), ws = weeksOfMonth(moY, moM), today = sod(Date.now());
  const chips = mode !== 'quadro' ? '' : `<div class="ag-wks">${ws.map(w => {
    const n = cards.filter(x => cardWeek(x) === w).length;
    const tag = w === c ? 'Esta semana' : (w === addDays(c, 7) ? 'Próxima' : '');
    return `<button class="ag-wk${w === wk ? ' on' : ''}${w < c ? ' past' : ''}" data-ag-wk="${w}" aria-pressed="${w === wk ? 'true' : 'false'}"><b>${esc(weekLabel(w))}</b><span>${tag ? esc(tag) : (n ? n + ' cartão' + (n === 1 ? '' : 's') : '&nbsp;')}</span></button>`;
  }).join('')}</div>`;
  const dayBased = ['dia', 'semana', 'custom'].includes(mode);
  const isNow = dayBased ? daysShown().includes(today) && (mode !== 'dia' || selDay === today) : (moY === new Date().getFullYear() && moM === new Date().getMonth() && (mode !== 'quadro' || wk === c));
  const title = mode === 'dia' ? esc(dayTitle(selDay)) : (mode === 'semana' || mode === 'custom') ? esc(rangeTitle()) : `${cap(MESES[moM])} <i>${moY}</i>`;
  const nav = mode === 'caixa' ? '' : `<div class="ag-mo"><button class="head-btn sm" data-ag-step="-1" aria-label="Anterior">${I.left}</button>
      <button class="ag-mo-t" data-ag-picker aria-haspopup="dialog" aria-expanded="${pickerOpen}">${title}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
      <button class="head-btn sm" data-ag-step="1" aria-label="Próximo">${I.right}</button>
      <button class="ag-btn sm" data-ag-mo="0"${isNow ? ' disabled' : ''}>Hoje</button></div>`;
  const active = !!(filter.q || filter.who || filter.st);
  const filt = filterOpen ? `<div class="ag-filter">
      <input id="agQ" class="ag-field" type="search" placeholder="Buscar cartão…" value="${attr(filter.q)}" aria-label="Buscar cartão">
      <select class="ag-select" id="agFWho" aria-label="Responsável"><option value="">Todos os responsáveis</option>${(b.memberUids || []).map(u => `<option value="${attr(u)}"${filter.who === u ? ' selected' : ''}>${esc(userName(u))}</option>`).join('')}</select>
      <select class="ag-select" id="agFSt" aria-label="Situação">${[['', 'Todas as situações'], ['open', 'Pendentes'], ['late', 'Atrasados'], ['done', 'Concluídos']].map(([v, l]) => `<option value="${v}"${filter.st === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      ${active ? `<button class="ag-btn sm" id="agFClear">Limpar</button>` : ''}</div>` : '';
  return `<div class="ag-period" role="group" aria-label="Período">
    <div class="ag-bar"><button class="ag-view-btn" data-ag-viewmenu aria-haspopup="menu">${esc(modeLabel())}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
      <span class="ag-spacer"></span>
      <button class="head-btn${active ? ' on' : ''}" data-ag-filter aria-label="Buscar e filtrar" aria-pressed="${filterOpen}" title="Buscar e filtrar">${searchIconSvg}</button>
      ${canAdd(b) ? `<button class="ag-btn pri sm" data-ag-create>${plusSvg}Criar</button>` : ''}</div>
    ${filt}${nav}${chips}${pickerOpen ? `<div class="ag-pk-bg" data-ag-pkclose></div><div class="ag-pk" role="dialog" aria-label="Escolher data">${miniCal()}</div>` : ''}</div>`;
}

function miniCal(){
  const first = new Date(pkY, pkM, 1), start = weekStart(first.getTime()), today = sod(Date.now());
  const has = new Set(cards.filter(c => vis(c) && !isInbox(c)).map(cardDate));
  const inRange = mode === 'quadro' ? null : new Set(mode === 'mes' || mode === 'agenda' ? [] : daysShown());
  let cells = '';
  for(let i = 0; i < 42; i++){
    const d = addDays(start, i), dt = new Date(d), out = dt.getMonth() !== pkM;
    if(i % 7 === 0 && i >= 35 && out) break;
    cells += `<button class="ag-pk-d${out ? ' out' : ''}${d === today ? ' today' : ''}${d === selDay ? ' sel' : ''}${inRange && inRange.has(d) && d !== selDay ? ' rng' : ''}${has.has(d) ? ' has' : ''}" data-ag-pkday="${d}" aria-label="${esc(dayTitle(d))}">${dt.getDate()}</button>`;
  }
  return `<div class="ag-pk-h"><button class="head-btn sm" data-ag-pkmo="-1" aria-label="Mês anterior">${I.left}</button><b>${cap(MESES[pkM])} ${pkY}</b><button class="head-btn sm" data-ag-pkmo="1" aria-label="Próximo mês">${I.right}</button></div>
    <div class="ag-pk-w">${['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map(x => `<i>${x}</i>`).join('')}</div>
    <div class="ag-pk-g">${cells}</div>
    <button class="ag-btn sm" data-ag-pkday="${today}" style="margin-top:8px; width:100%">Ir para hoje</button>`;
}

// ---------- visões de calendário ----------
function viewHtml(b){
  if(mode === 'caixa') return `<div class="ag-view">${inboxHtml(b, true)}</div>`;
  const side = `<aside class="ag-side" aria-label="Calendário e caixa de entrada"><div class="ag-side-cal" id="agSideCal">${miniCal()}</div>${inboxHtml(b, false)}</aside>`;
  let core;
  if(mode === 'mes') core = `<div class="ag-view">${mesHtml()}</div>`;
  else if(mode === 'agenda') core = `<div class="ag-view">${agendaHtml(b)}</div>`;
  else core = gridHtml(b);
  return `<div class="ag-split">${core}${side}</div>`;
}
function evChip(c, extra){
  const late = !c.done && c.due && c.due < Date.now();
  return `<div class="ag-ev${c.done ? ' done' : ''}${late ? ' late' : ''}${extra || ''}" tabindex="0" role="button" data-card="${attr(c.id)}" data-evdrag="1" title="${attr(c.title)}">${hasTime(c) ? `<b>${fmtT(c.due)}</b> ` : ''}${esc(c.title)}</div>`;
}
function mesHtml(){
  const start = weekStart(new Date(moY, moM, 1).getTime()), today = sod(Date.now());
  const heads = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map(x => `<i>${x}</i>`).join('');
  let cells = '';
  for(let i = 0; i < 42; i++){
    const d = addDays(start, i), dt = new Date(d), out = dt.getMonth() !== moM;
    if(i % 7 === 0 && i >= 35 && out) break;
    const cs = cardsOnDay(d), shown = cs.slice(0, 3);
    cells += `<div class="ag-mc${out ? ' out' : ''}${d === today ? ' today' : ''}${d === selDay ? ' sel' : ''}" role="button" tabindex="0" data-ag-day="${d}" data-drop-day="${d}" aria-label="${esc(dayTitle(d))}, ${cs.length} cartão(ões)">
      <span class="ag-mc-n">${dt.getDate()}</span>
      ${shown.map(c => evChip(c, cardStartDay(c) < cardDate(c) ? ' span' : '')).join('')}
      ${cs.length > 3 ? `<span class="ag-more">+${cs.length - 3}</span>` : ''}
      ${cs.length ? `<span class="ag-dotn">${cs.length > 3 ? '3+' : '•'.repeat(cs.length)}</span>` : ''}</div>`;
  }
  const b = curBoard(), dayCs = cardsOnDay(selDay), inbN = cards.filter(c => vis(c) && isInbox(c)).length;
  const openDay = canAdd(b) && weekOpen(weekStart(selDay));
  const tray = `<div class="ag-tray"><div class="ag-tray-t" role="tablist">
      <button role="tab" class="${trayTab === 'dia' ? 'on' : ''}" data-ag-tray="dia" aria-selected="${trayTab === 'dia'}">${esc(cap(new Date(selDay).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')))} <span class="ag-count">${dayCs.length}</span></button>
      <button role="tab" class="${trayTab === 'caixa' ? 'on' : ''}" data-ag-tray="caixa" aria-selected="${trayTab === 'caixa'}">Caixa de entrada <span class="ag-count">${inbN}</span></button></div>
    <div class="ag-tray-b">${trayTab === 'caixa' ? inboxHtml(b, true, true)
      : `<div class="ag-tray-l" data-drop-day="${selDay}">${dayCs.length ? dayCs.map(c => miniCard(b, c)).join('') : '<div class="ag-nothing">Nada planejado para este dia.</div>'}</div>${openDay ? `<button class="ag-add" data-ag-create="${selDay}">${plusSvg}Adicionar cartão neste dia</button>` : ''}`}</div></div>`;
  return `<div class="ag-mgrid"><div class="ag-mh">${heads}</div><div class="ag-mb">${cells}</div></div>${tray}`;
}
function agendaHtml(b){
  const days = [], last = new Date(moY, moM + 1, 0).getDate();
  for(let i = 1; i <= last; i++){ const d = new Date(moY, moM, i).getTime(); const cs = cardsOnDay(d); if(cs.length) days.push([d, cs]); }
  if(!days.length) return `<div class="ag-empty-board" style="margin:40px auto"><b>Nada planejado em ${MESES[moM]}</b>Use Quadro, Dia ou Semana para incluir cartões na semana atual ou na próxima.</div>`;
  const today = sod(Date.now());
  return days.map(([d, cs]) => `<section class="ag-ag-day" data-drop-day="${d}"><h3${d === today ? ' class="today"' : ''}>${esc(dayTitle(d))}${d === today ? '<em>Hoje</em>' : ''}</h3>${cs.map(c => miniCard(b, c)).join('')}</section>`).join('');
}
function miniCard(b, c){
  const l = lists.find(x => x.id === c.listId);
  const tag = l && !isDayList(l) ? `<span class="ag-chip">${esc(l.name)}</span>` : '';
  return cardHtml(b, c, tag);
}
function gridHtml(b){
  const days = daysShown(), today = sod(Date.now());
  let h0 = 6, h1 = 22;
  days.forEach(d => cardsOnDay(d).forEach(c => { if(hasTime(c) && cardDate(c) === d){ const h = Math.floor(minsOf(c.due) / 60); h0 = Math.min(h0, h); h1 = Math.max(h1, h + 2); } }));
  h1 = Math.min(h1, 24);
  const n = h1 - h0, canNew = canAdd(b);
  const head = days.map(d => {
    const dt = new Date(d);
    return `<div class="ag-gh${d === today ? ' today' : ''}"><span>${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][dt.getDay()]}</span><b>${dt.getDate()}</b></div>`;
  }).join('');
  const allday = days.map(d => {
    const cs = cardsOnDay(d).filter(c => !(hasTime(c) && cardDate(c) === d));
    const open = canNew && weekOpen(weekStart(d));
    return `<div class="ag-gad" data-drop-day="${d}">${cs.map(c => evChip(c, cardStartDay(c) < cardDate(c) ? ' span' : '')).join('')}${open ? `<button class="ag-gadd" data-ag-create="${d}" aria-label="Incluir cartão em ${esc(dayTitle(d))}">${plusSvg}</button>` : ''}</div>`;
  }).join('');
  const gutter = Array.from({ length: n }, (_, i) => `<div class="ag-hr"><span>${pad2(h0 + i)}:00</span></div>`).join('');
  const nowM = minsOf(Date.now());
  const cols = days.map(d => {
    const evs = cardsOnDay(d).filter(c => hasTime(c) && cardDate(c) === d).sort((a, z) => a.due - z.due);
    const laneEnd = []; const placed = evs.map(c => {
      const st = minsOf(c.due); let lane = laneEnd.findIndex(e => e <= st); if(lane < 0){ lane = laneEnd.length; laneEnd.push(0); }
      laneEnd[lane] = st + 50; return { c, st, lane };
    });
    // largura por grupo de sobreposição
    placed.forEach(p => { p.lanes = placed.filter(q => q.st < p.st + 50 && p.st < q.st + 50).reduce((m, q) => Math.max(m, q.lane + 1), p.lane + 1); });
    const html = placed.map(({ c, st, lane, lanes }) => {
      const top = (st - h0 * 60) / (n * 60) * 100, hgt = 50 / (n * 60) * 100;
      const late = !c.done && c.due < Date.now();
      return `<div class="ag-gev${c.done ? ' done' : ''}${late ? ' late' : ''}" style="top:${top}%; height:${hgt}%; left:calc(${lane} * 100% / ${lanes}); width:calc(100% / ${lanes} - 3px)" tabindex="0" role="button" data-card="${attr(c.id)}" data-evdrag="1" title="${attr(c.title)}"><b>${fmtT(c.due)}</b> ${esc(c.title)}</div>`;
    }).join('');
    const now = d === today && nowM >= h0 * 60 && nowM <= h1 * 60 ? `<i class="ag-now" style="top:${(nowM - h0 * 60) / (n * 60) * 100}%"></i>` : '';
    return `<div class="ag-gcol${d === today ? ' today' : ''}" data-day="${d}" data-drop-day="${d}" data-h0="${h0}" data-n="${n}">${html}${now}</div>`;
  }).join('');
  const cw = days.length === 1 ? 240 : (days.length <= 3 ? 150 : (days.length <= 5 ? 112 : 96));
  return `<div class="ag-view grid"><div class="ag-gscroll${fit ? ' fit' : ''}" style="--cols:${days.length}; --cw:${cw}px; --n:${n}">
    <div class="ag-ghead"><div class="ag-gcorner"></div>${head}</div>
    <div class="ag-gall"><div class="ag-gcorner"><span>dia todo</span></div>${allday}</div>
    <div class="ag-grid"><div class="ag-gutter">${gutter}</div>${cols}</div></div></div>`;
}
function inboxHtml(b, full, noAdd){
  const list = cards.filter(c => vis(c) && isInbox(c)).sort((a, z) => (a.order || 0) - (z.order || 0));
  const canNew = canAdd(b);
  return `<section class="ag-inbox${full ? ' full' : ''}" data-drop-inbox="1" aria-label="Caixa de entrada">
    <div class="ag-inb-h"><h3>Caixa de entrada</h3><span class="ag-count">${list.length}</span></div>
    <div class="ag-inb-hint">Cartões sem data. ${full ? 'Segure e arraste para um dia do calendário, ou toque para abrir.' : 'Arraste para o calendário para agendar.'}</div>
    ${canNew && !noAdd ? `<div class="ag-inb-add"><input id="agInbIn" class="ag-field" maxlength="300" placeholder="Adicionar um cartão" aria-label="Novo cartão na caixa de entrada"><button class="ag-btn pri sm" id="agInbBtn" aria-label="Adicionar">${plusSvg}</button></div>` : ''}
    <div class="ag-inb-l">${list.length ? list.map(c => `<div class="ag-inb${c.done ? ' done' : ''}" tabindex="0" role="button" data-card="${attr(c.id)}" data-evdrag="1">${esc(c.title)}</div>`).join('') : '<div class="ag-nothing">Nada por aqui. Cartões sem data aparecem nesta caixa.</div>'}</div></section>`;
}

function boardHtml(b, can){
  if(!lists.length && !can){
    return `<div class="ag-empty-board"><b>Esta agenda ainda não tem listas</b>Quem edita a agenda cria as listas. Quando existirem, elas aparecem aqui.</div>`;
  }
  const cols = lists.map((l, i) => {
    const cs = sortedCards(l.id);
    const cardsHtml = cs.map(c => cardHtml(b, c)).join('');
    const foot = composing === l.id
      ? `<div class="ag-compose"><textarea id="agCompose" rows="2" maxlength="300" placeholder="Título do cartão" aria-label="Título do novo cartão"></textarea>
          <div class="ag-compose-act"><button class="ag-btn pri sm" data-ag-addcard="${attr(l.id)}">Adicionar cartão</button><button class="ag-btn sm" data-ag-cancelcompose aria-label="Cancelar">${xSvg}</button></div></div>`
      : (canAdd(b) && !weekOpen(wk)
        ? `<div class="ag-add lock">${lockSvg}${wk < curWeek() ? 'Semana encerrada' : 'Ainda não liberada'}</div>`
        : canAdd(b)
        ? `<button class="ag-add" data-ag-compose="${attr(l.id)}">${plusSvg}Adicionar cartão</button>`
        : `<div class="ag-add lock">${lockSvg}Somente leitura</div>`);
    return `<section class="ag-col" data-list="${attr(l.id)}" aria-label="Lista ${attr(l.name)}">
      <header class="ag-col-h"><h3>${esc(l.name)}${dayTag(l.name)}</h3><span class="ag-count">${cs.length}</span>
        ${can ? `<button class="head-btn sm" data-ag-listmenu="${attr(l.id)}" aria-label="Opções da lista ${attr(l.name)}" title="Opções da lista">${moreSvg}</button>` : ''}</header>
      <div class="ag-cards" data-list="${attr(l.id)}">${cardsHtml}</div>
      <div class="ag-foot">${foot}</div></section>`;
  }).join('');
  const newCol = can
    ? `<div class="ag-newcol">${composing === '__list'
        ? `<input id="agNewList" maxlength="40" placeholder="Nome da lista" aria-label="Nome da nova lista"><div class="ag-compose-act"><button class="ag-btn pri sm" data-ag-addlist>Adicionar lista</button><button class="ag-btn sm" data-ag-cancelcompose aria-label="Cancelar">${xSvg}</button></div>`
        : `<button class="ag-add" data-ag-newlist>${plusSvg}Adicionar lista</button>`}</div>`
    : '';
  if(!lists.length && can) return `<div class="ag-board">${newCol.replace('ag-newcol', 'ag-newcol" style="margin:auto')}</div>`;
  return `<div class="ag-board" id="agBoard">${cols}${newCol}</div>`;
}

function dayTag(name){
  const i = WDAYS[String(name).trim().toLowerCase()]; if(i === undefined) return '';
  const d = addDays(wk, i), t = new Date(); t.setHours(0, 0, 0, 0);
  return ` <em class="ag-day${d === t.getTime() ? ' today' : ''}">${esc(shortDay(d))}</em>`;
}

function cardHtml(b, c, extra){
  const d = dueInfo(c);
  const can = canEditCard(b, c);
  const cl = c.checklist || [];
  const done = cl.filter(x => x.done).length;
  const late = !c.done && c.due && c.due < Date.now();
  const by = c.createdBy && c.createdBy !== myUid && c.createdBy !== b.ownerUid ? `<span class="ag-by">de ${esc(firstName(c.createdByName) || userName(c.createdBy))}</span>` : '';
  const avs = (c.assignees || []).slice(0, 3).map(u => avatarHtml(userName(u), u)).join('');
  return `<article class="ag-card${c.done ? ' done' : ''}${late ? ' late' : ''}" tabindex="0" role="button" data-card="${attr(c.id)}"${can && mode === 'quadro' ? ' data-drag="1"' : (can ? ' data-evdrag="1"' : '')} aria-label="Cartão ${attr(c.title)}">
    ${can ? `<button class="ag-check${c.done ? ' on' : ''}" data-ag-done="${attr(c.id)}" aria-pressed="${c.done ? 'true' : 'false'}" aria-label="${c.done ? 'Marcar como não concluído' : 'Marcar como concluído'}">${I.check}</button>`
          : `<span class="ag-check static${c.done ? ' on' : ''}" aria-hidden="true">${I.check}</span>`}
    <div class="ag-cbody"><div class="ag-ct">${esc(c.title)}</div>
      ${(d || cl.length || by || avs || extra) ? `<div class="ag-meta">
        ${d ? `<span class="ag-chip ${d.tone}">${I.cal}${esc(d.label)}</span>` : ''}
        ${cl.length ? `<span class="ag-chip${done === cl.length ? ' ok' : ''}">${I.list}${done}/${cl.length}</span>` : ''}
        ${extra || ''}${by}${avs ? `<span class="ag-avs">${avs}</span>` : ''}</div>` : (extra ? `<div class="ag-meta">${extra}</div>` : '')}
    </div></article>`;
}

// ---------- folhas (cartão e membros) ----------
function sheetHtml(b){
  if(sheet.kind === 'members') return membersSheetHtml(b);
  const c = cardById(sheet.id);
  if(!c) return '';
  return cardSheetHtml(b, c);
}

function cardSheetHtml(b, c){
  const can = canEditCard(b, c);
  const canCmt = canAdd(b);
  const cl = c.checklist || [];
  const done = cl.filter(x => x.done).length;
  const people = (b.memberUids || []).slice();
  (c.assignees || []).forEach(u => { if(!people.includes(u)) people.push(u); });
  const lockMsg = can ? '' : (memberRole(b) === 'colab' || canAdd(b)
    ? `Este cartão é de ${esc(firstName(c.createdByName) || userName(c.createdBy))}. Você pode comentar, mas só ele ou um editor altera.`
    : 'Somente leitura.');
  return `<div class="ag-scrim" id="agScrim"></div>
  <aside class="ag-sheet" role="dialog" aria-modal="true" aria-label="Cartão ${attr(c.title)}">
    <div class="ag-sh-head"><button class="head-btn" id="agSheetClose" aria-label="Fechar" title="Fechar">${xSvg}</button><h2>Cartão</h2></div>
    <div class="ag-sh-body">
      <div class="ag-title-row">
        ${can ? `<button class="ag-check${c.done ? ' on' : ''}" data-ag-done="${attr(c.id)}" aria-pressed="${c.done ? 'true' : 'false'}" aria-label="${c.done ? 'Marcar como não concluído' : 'Marcar como concluído'}">${I.check}</button>`
              : `<span class="ag-check static${c.done ? ' on' : ''}" aria-hidden="true">${I.check}</span>`}
        <textarea class="ag-title-in" id="agTitle" rows="1" maxlength="300" aria-label="Título do cartão"${can ? '' : ' readonly'}>${esc(c.title)}</textarea>
      </div>
      <div class="ag-sub">Na lista <b>${esc(listName(c.listId))}</b> · criado por ${esc(c.createdByName || userName(c.createdBy))}</div>
      ${lockMsg ? `<div class="ag-info" style="margin-top:4px">${lockMsg}</div>` : ''}

      <div class="ag-block"><div class="ag-lbl">${I.move}Lista</div>
        <select class="ag-select" id="agMove" aria-label="Mover para a lista"${can ? '' : ' disabled'}>${lists.map(l => `<option value="${attr(l.id)}"${l.id === c.listId ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>

      <div class="ag-block"><div class="ag-lbl">${I.cal}Entrega</div>
        <div class="ag-roww"><input class="ag-field" type="${c.allDay ? 'date' : 'datetime-local'}" id="agDue" value="${attr(c.allDay ? toLocalInput(c.due).slice(0, 10) : toLocalInput(c.due))}" aria-label="Data e hora de entrega"${can ? '' : ' disabled'}>
          ${can && c.due ? `<button class="ag-btn sm" id="agDueClear">Limpar</button>` : ''}</div>
        ${can ? `<label class="ag-allday"><input type="checkbox" id="agAllDay"${c.allDay ? ' checked' : ''}> Dia inteiro (sem horário)</label>` : (c.allDay ? '<div class="ag-hint">Dia inteiro</div>' : '')}</div>
      <div class="ag-block"><div class="ag-lbl">${I.cal}Início <span class="ag-opt">(opcional, para tarefas de vários dias)</span></div>
        <div class="ag-roww"><input class="ag-field" type="date" id="agStart" value="${attr(c.start ? toLocalInput(c.start).slice(0, 10) : '')}" aria-label="Data de início"${can ? '' : ' disabled'}>
          ${can && c.start ? `<button class="ag-btn sm" id="agStartClear">Limpar</button>` : ''}</div></div>

      <div class="ag-block"><div class="ag-lbl">${usersSvg}Responsáveis</div>
        <div class="ag-ppl">${people.length ? people.map(u => `<button class="ag-p${(c.assignees || []).includes(u) ? ' on' : ''}" data-ag-assign="${attr(u)}" aria-pressed="${(c.assignees || []).includes(u) ? 'true' : 'false'}"${can ? '' : ' disabled'}>${avatarHtml(userName(u), u)}${esc(firstName(userName(u)))}</button>`).join('') : '<span class="ag-hint">Convide pessoas para a agenda para atribuir cartões.</span>'}</div></div>

      <div class="ag-block"><div class="ag-lbl">${I.text}Descrição</div>
        <textarea class="ag-area" id="agDesc" placeholder="${can ? 'Escreva detalhes, combinados ou links' : 'Sem descrição'}" aria-label="Descrição"${can ? '' : ' readonly'}>${esc(c.desc || '')}</textarea></div>

      <div class="ag-block"><div class="ag-lbl">${I.list}Checklist${cl.length ? `<span class="ag-lbl-r">${done}/${cl.length}</span>` : ''}</div>
        ${cl.length ? `<div class="ag-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${cl.length}" aria-valuenow="${done}"><i style="width:${Math.round(done / cl.length * 100)}%"></i></div>` : ''}
        ${cl.map(it => `<div class="ag-ci${it.done ? ' on' : ''}">
            ${can ? `<button class="ag-check${it.done ? ' on' : ''}" data-ag-chk="${attr(it.id)}" aria-pressed="${it.done ? 'true' : 'false'}" aria-label="${attr(it.text)}">${I.check}</button>` : `<span class="ag-check static${it.done ? ' on' : ''}" aria-hidden="true">${I.check}</span>`}
            <span>${esc(it.text)}</span>
            ${can ? `<button class="ag-x" data-ag-chkdel="${attr(it.id)}" aria-label="Remover item" title="Remover item">${xSvg}</button>` : ''}</div>`).join('')}
        ${can ? `<div class="ag-roww" style="margin-top:8px"><input class="ag-field" id="agChkIn" maxlength="200" placeholder="Novo item" aria-label="Novo item do checklist"><button class="ag-btn sm" id="agChkAdd">Adicionar</button></div>` : ''}</div>

      <div class="ag-block"><div class="ag-lbl">${I.chat}Comentários</div>
        ${comments.length ? comments.map(m => `<div class="ag-cm">${avatarHtml(m.authorName, m.authorUid)}<div class="ag-cm-b"><div class="ag-cm-h"><b>${esc(firstName(m.authorName))}</b> · ${esc(ago(tsMs(m.createdAt)))}</div><div class="ag-cm-t">${linkify(esc(m.text))}</div></div></div>`).join('') : `<div class="ag-hint">Nenhum comentário ainda.</div>`}</div>

      ${can ? `<div class="ag-block"><button class="ag-btn danger${confirmDelete ? ' armed' : ''}" id="agDelCard">${trashSvg}${confirmDelete ? 'Toque de novo para excluir' : 'Excluir cartão'}</button></div>` : ''}
    </div>
    ${canCmt ? `<div class="ag-cm-in"><textarea id="agCmIn" rows="1" maxlength="1000" placeholder="Comentar…" aria-label="Escrever comentário"></textarea><button id="agCmSend" aria-label="Enviar comentário">${I.send}</button></div>`
             : `<div class="ag-cm-lock">${lockSvg} Somente leitura: comentários bloqueados.</div>`}
  </aside>`;
}

function membersSheetHtml(b){
  const manage = canManage(b);
  const uids = (b.memberUids || []).slice();
  if(!uids.includes(b.ownerUid)) uids.unshift(b.ownerUid);
  uids.sort((a, z) => (a === b.ownerUid ? -1 : z === b.ownerUid ? 1 : userName(a).localeCompare(userName(z), 'pt-BR')));
  const rows = uids.map(u => {
    const isOwner = u === b.ownerUid;
    const role = isOwner ? 'dono' : ((b.members || {})[u] || 'leitor');
    const usr = userObj(u);
    let ctl;
    if(isOwner) ctl = '<span class="ag-role dono">Dono</span>';
    else if(manage) ctl = `<select class="ag-select" data-ag-role="${attr(u)}" aria-label="Papel de ${attr(userName(u))}">${['editor', 'colab', 'leitor'].map(r => `<option value="${r}"${r === role ? ' selected' : ''}>${ROLES[r]}</option>`).join('')}</select><button class="ag-x" data-ag-rm="${attr(u)}" aria-label="Remover ${attr(userName(u))}" title="Remover">${xSvg}</button>`;
    else ctl = `<span class="ag-role${role === 'editor' ? ' editor' : ''}">${esc(ROLES[role])}</span>`;
    return `<div class="ag-mrow">${avatarHtml(userName(u), u)}<div class="ag-mrow-main"><div class="ag-mrow-n">${esc(userName(u))}${u === myUid ? ' (você)' : ''}</div><div class="ag-mrow-s">${esc(usr ? usr.email : '')}</div></div>${ctl}</div>`;
  }).join('');
  const candidates = allUsers.filter(u => !uids.includes(u.uid) && !u.blocked).sort((a, z) => displayNameFor(a).localeCompare(displayNameFor(z), 'pt-BR'));
  return `<div class="ag-scrim" id="agScrim"></div>
  <aside class="ag-sheet" role="dialog" aria-modal="true" aria-label="Membros da agenda">
    <div class="ag-sh-head"><button class="head-btn" id="agSheetClose" aria-label="Fechar" title="Fechar">${xSvg}</button><h2>Membros e permissões</h2></div>
    <div class="ag-sh-body">
      ${rows}
      ${manage ? `<div class="ag-block"><div class="ag-lbl">Responsável pela agenda</div>
        <select class="ag-select" id="agResp" aria-label="Responsável pela agenda"><option value="">Ninguém (escolher em cada cartão)</option>${uids.map(u => `<option value="${attr(u)}"${b.responsible === u ? ' selected' : ''}>${esc(userName(u))}${u === myUid ? ' (você)' : ''}</option>`).join('')}</select>
        <div class="ag-hint">Os cartões novos já vêm com essa pessoa como responsável e ela recebe o aviso no celular.</div></div>` : (b.responsible ? `<div class="ag-info"><b>Responsável pela agenda:</b> ${esc(userName(b.responsible))}</div>` : '')}
      ${manage ? `<div class="ag-block"><div class="ag-lbl">${userPlusSvg}Adicionar pessoa</div>
        ${candidates.length ? `<div class="ag-roww"><select class="ag-select" id="agAddWho" aria-label="Pessoa">${candidates.map(u => `<option value="${attr(u.uid)}">${esc(displayNameFor(u))}</option>`).join('')}</select>
          <select class="ag-select" id="agAddRole" style="width:140px" aria-label="Papel">${['colab', 'editor', 'leitor'].map(r => `<option value="${r}">${ROLES[r]}</option>`).join('')}</select></div>
          <div class="ag-hint" id="agRoleHint">${esc(ROLE_HELP.colab)}</div>
          <button class="ag-btn pri" id="agAddMember" style="margin-top:12px">Adicionar à agenda</button>`
          : '<div class="ag-hint">Todas as pessoas do painel já estão nesta agenda.</div>'}</div>` : ''}
      <div class="ag-info"><b>Quem pode o quê.</b> Dono e editor mexem em tudo. Colaborador inclui cartões e edita só os seus. Leitor só visualiza. Administradores do painel veem e editam todas as agendas.</div>
    </div>
  </aside>`;
}

// ---------- ligações da tela ----------
function bindMain(main, b){
  const q = (s, fn) => { const el = main.querySelector(s); if(el) fn(el); };
  q('#agBack', el => el.onclick = goBack);
  q('#agMembersBtn', el => el.onclick = () => openSheet({ kind: 'members' }));
  q('#agMoreBtn', el => el.onclick = () => openMenu(el, [
    { label: 'Renomear agenda', icon: editSvg, action: () => promptModal('Renomear agenda', b.name, 40, name => bRef().update({ name, updatedAt: FV().serverTimestamp() }).catch(fail)) },
    { label: 'Excluir agenda', icon: trashSvg, danger: true, action: () => showDeleteBoardModal(b) }
  ]));

  main.querySelectorAll('[data-ag-mo]').forEach(el => el.onclick = () => goMonth(+el.getAttribute('data-ag-mo')));
  main.querySelectorAll('[data-ag-step]').forEach(el => el.onclick = () => stepPeriod(+el.getAttribute('data-ag-step')));
  q('[data-ag-viewmenu]', el => el.onclick = () => openMenu(el, MODES.map(([k, l]) => ({
    label: k === 'custom' ? 'Personalizar…' : l, icon: mode === k ? I.check : '',
    action: () => { if(k === 'custom') customModal(); else setMode(k); }
  })).concat([['dia', 'semana', 'custom'].includes(mode) ? { label: fit ? 'Altura fixa das horas' : 'Ajustar ao tamanho da tela', icon: fit ? I.check : '', action: () => { fit = !fit; savePref(); mainSig = ''; renderMain(true); } } : null])));
  q('[data-ag-filter]', el => el.onclick = () => { filterOpen = !filterOpen; mainSig = ''; renderMain(true); const t = byId('agQ'); if(t) t.focus(); });
  q('#agQ', el => { let tm; el.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { filter.q = el.value.trim(); mainSig = ''; renderMain(true); }, 220); }; });
  q('#agFWho', el => el.onchange = () => { filter.who = el.value; mainSig = ''; renderMain(true); });
  q('#agFSt', el => el.onchange = () => { filter.st = el.value; mainSig = ''; renderMain(true); });
  q('#agFClear', el => el.onclick = () => { filter = { q: '', who: '', st: '' }; mainSig = ''; renderMain(true); });
  main.querySelectorAll('[data-ag-create]').forEach(el => el.onclick = () => { const v = el.getAttribute('data-ag-create'); createModal(v ? { day: +v } : null); });
  q('[data-ag-picker]', el => el.onclick = () => { pickerOpen = !pickerOpen; const d = new Date(['dia', 'semana', 'custom'].includes(mode) ? selDay : new Date(moY, moM, 1).getTime()); pkY = d.getFullYear(); pkM = d.getMonth(); mainSig = ''; renderMain(true); });
  main.querySelectorAll('[data-ag-pkclose]').forEach(el => el.onclick = () => { pickerOpen = false; mainSig = ''; renderMain(true); });
  main.querySelectorAll('[data-ag-pkmo]').forEach(el => el.onclick = () => { const d = new Date(pkY, pkM + +el.getAttribute('data-ag-pkmo'), 1); pkY = d.getFullYear(); pkM = d.getMonth(); mainSig = ''; renderMain(true); });
  main.querySelectorAll('[data-ag-pkday]').forEach(el => el.onclick = () => pickDay(+el.getAttribute('data-ag-pkday')));
  main.querySelectorAll('[data-ag-day]').forEach(el => el.onclick = e => { if(e.target.closest('[data-card]') || Date.now() - lastDragEnd < 450) return; const dd = +el.getAttribute('data-ag-day'); if(mobileLayout()){ selDay = dd; trayTab = 'dia'; mainSig = ''; renderMain(true); return; } mode = 'dia'; savePref(); pickDay(dd); });
  main.querySelectorAll('[data-ag-tray]').forEach(el => el.onclick = () => { trayTab = el.getAttribute('data-ag-tray'); mainSig = ''; renderMain(true); });
  main.querySelectorAll('.ag-gcol').forEach(el => el.onclick = e => {
    if(e.target.closest('[data-card]') || Date.now() - lastDragEnd < 450) return;
    const b2 = curBoard(); if(!canAdd(b2)) return;
    const r = el.getBoundingClientRect(), h0 = +el.getAttribute('data-h0'), n = +el.getAttribute('data-n');
    const mins = Math.max(0, Math.min(23 * 60 + 45, Math.floor((h0 * 60 + (e.clientY - r.top) / r.height * n * 60) / 30) * 30));
    createModal({ day: +el.getAttribute('data-day'), mins });
  });
  q('#agInbBtn', el => el.onclick = addInbox);
  q('#agInbIn', el => { el.onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); addInbox(); } }; });
  main.querySelectorAll('[data-ag-compose]').forEach(el => el.onclick = () => { composing = el.getAttribute('data-ag-compose'); mainSig = ''; renderMain(true); const t = byId('agCompose'); if(t) t.focus(); });
  main.querySelectorAll('[data-ag-cancelcompose]').forEach(el => el.onclick = () => { composing = null; mainSig = ''; renderMain(true); });
  main.querySelectorAll('[data-ag-addcard]').forEach(el => el.onclick = () => submitCard(el.getAttribute('data-ag-addcard')));
  const ci = byId('agCompose');
  if(ci){
    ci.onkeydown = e => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); submitCard(composing); } else if(e.key === 'Escape'){ composing = null; mainSig = ''; renderMain(true); } };
    if(!ci.value) ci.focus();
  }
  q('[data-ag-newlist]', el => el.onclick = () => { composing = '__list'; mainSig = ''; renderMain(true); const t = byId('agNewList'); if(t) t.focus(); });
  q('[data-ag-addlist]', el => el.onclick = submitList);
  const nl = byId('agNewList');
  if(nl){ nl.onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); submitList(); } else if(e.key === 'Escape'){ composing = null; mainSig = ''; renderMain(true); } }; if(!nl.value) nl.focus(); }
  main.querySelectorAll('[data-ag-listmenu]').forEach(el => el.onclick = () => listMenu(el, el.getAttribute('data-ag-listmenu')));

  main.querySelectorAll('.ag-ev[data-card], .ag-gev[data-card], .ag-inb[data-card], .ag-card[data-evdrag]').forEach(el => {
    onActivate(el, () => { if(Date.now() - lastDragEnd < 450) return; openSheet({ kind: 'card', id: el.getAttribute('data-card') }); });
    if(canEditCard(b, cardById(el.getAttribute('data-card')))){
      el.addEventListener('touchstart', e => calDragStart(e, el), { passive: true });
      el.addEventListener('mousedown', e => calDragStart(e, el));
    }
  });
  main.querySelectorAll('.ag-card:not([data-evdrag])').forEach(el => {
    onActivate(el, () => { if(Date.now() - lastDragEnd < 450) return; openSheet({ kind: 'card', id: el.getAttribute('data-card') }); });
    if(el.hasAttribute('data-drag')){
      el.addEventListener('touchstart', e => dragStart(e, el, 'touch'), { passive: true });
      el.addEventListener('mousedown', e => { if(e.button === 0) dragStart(e, el, 'mouse'); });
    }
  });
  main.querySelectorAll('[data-ag-done]').forEach(el => el.onclick = e => { e.stopPropagation(); toggleDone(el.getAttribute('data-ag-done')); });

  const nb = main.querySelector('.ag-board');
  if(nb) nb.addEventListener('scroll', updateDots, { passive: true });

  if(sheet) bindSheet(main, b);
}

function updateDots(){
  const nb = document.querySelector('#mainPane .ag-board'); const dots = document.getElementById('agDots');
  if(!nb || !dots) return;
  const cols = nb.querySelectorAll('.ag-col'); if(!cols.length) return;
  const step = cols.length > 1 ? (cols[1].offsetLeft - cols[0].offsetLeft) : cols[0].offsetWidth;
  const idx = Math.max(0, Math.min(cols.length - 1, Math.round(nb.scrollLeft / (step || 1))));
  dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i === idx));
}

function bindSheet(main, b){
  const q = (s, fn) => { const el = main.querySelector(s); if(el) fn(el); };
  q('#agSheetClose', el => el.onclick = () => closeSheet());
  q('#agScrim', el => el.onclick = () => closeSheet());
  if(sheet.kind === 'members'){
    main.querySelectorAll('[data-ag-role]').forEach(el => el.onchange = () => setMemberRole(el.getAttribute('data-ag-role'), el.value));
    main.querySelectorAll('[data-ag-rm]').forEach(el => el.onclick = () => removeMember(el.getAttribute('data-ag-rm')));
    q('#agResp', el => el.onchange = () => bRef().update({ responsible: el.value || null, updatedAt: FV().serverTimestamp() }).then(() => toast(el.value ? userName(el.value) + ' é o responsável pela agenda' : 'Sem responsável geral')).catch(fail));
    q('#agAddRole', el => el.onchange = () => { const h = byId('agRoleHint'); if(h) h.textContent = ROLE_HELP[el.value] || ''; });
    q('#agAddMember', el => el.onclick = () => addMember(byId('agAddWho').value, byId('agAddRole').value));
    return;
  }
  const c = cardById(sheet.id); if(!c) return;
  const can = canEditCard(b, c);
  const ta = byId('agTitle'); if(ta){ autoGrow(ta); ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  if(can){
    if(ta){
      ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
      ta.onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); ta.blur(); } };
      ta.onblur = () => { const v = ta.value.trim().replace(/\s+/g, ' '); if(v && v !== c.title) patchCard(c.id, { title: v }); else ta.value = c.title; };
    }
    q('#agDesc', el => el.onblur = () => { const v = el.value.trim(); if(v !== (c.desc || '').trim()) patchCard(c.id, { desc: v }); });
    q('#agMove', el => el.onchange = () => moveToList(c, el.value));
    q('#agDue', el => el.onchange = () => {
      if(!el.value){ patchCard(c.id, { due: null, allDay: false }); return; }
      const t = c.allDay ? new Date(el.value + 'T00:00').getTime() + 86399000 : new Date(el.value).getTime();
      patchCard(c.id, { due: t, week: weekStart(t) });
    });
    q('#agDueClear', el => el.onclick = () => patchCard(c.id, { due: null, allDay: false }));
    q('#agAllDay', el => el.onchange = () => {
      const base = c.due || (cardDate(c));
      patchCard(c.id, el.checked ? { allDay: true, due: sod(base) + 86399000 } : { allDay: false, due: sod(base) + 9 * 3600000 });
    });
    q('#agStart', el => el.onchange = () => patchCard(c.id, { start: el.value ? new Date(el.value + 'T00:00').getTime() : null }));
    q('#agStartClear', el => el.onclick = () => patchCard(c.id, { start: null }));
    main.querySelectorAll('[data-ag-assign]').forEach(el => el.onclick = () => toggleAssignee(c, el.getAttribute('data-ag-assign')));
    main.querySelectorAll('[data-ag-chk]').forEach(el => el.onclick = () => toggleChk(c, el.getAttribute('data-ag-chk')));
    main.querySelectorAll('[data-ag-chkdel]').forEach(el => el.onclick = () => delChk(c, el.getAttribute('data-ag-chkdel')));
    q('#agChkAdd', el => el.onclick = () => addChk(c));
    q('#agChkIn', el => el.onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); addChk(c); } });
    q('#agDelCard', el => el.onclick = () => {
      if(!confirmDelete){ confirmDelete = true; mainSig = ''; renderMain(true); setTimeout(() => { if(confirmDelete){ confirmDelete = false; mainSig = ''; renderMain(true); } }, 4000); return; }
      deleteCard(c);
    });
  }
  q('#agCmSend', el => el.onclick = () => sendComment(c));
  q('#agCmIn', el => {
    el.oninput = () => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; };
    el.onkeydown = e => { if(e.key === 'Enter' && !e.shiftKey && !isTouchDevice()){ e.preventDefault(); sendComment(c); } };
  });
}
function isTouchDevice(){ try{ return window.matchMedia('(pointer:coarse)').matches; }catch(e){ return false; } }

// abrir e fechar a folha (no celular o botão "voltar" do aparelho fecha só a folha)
function openSheet(s){
  sheet = s; confirmDelete = false; mainSig = '';
  closeComments();
  if(s.kind === 'card'){
    unsubComments = bRef().collection('cards').doc(s.id).collection('comments').orderBy('createdAt').onSnapshot(snap => {
      comments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderMain();
    }, err => reportListenError('comentários', err));
  }
  if(isMobile() && !sheetHistory){ try{ history.pushState({ dcMain: true, agSheet: true }, ''); sheetHistory = true; }catch(e){} }
  renderMain(true);
}
function closeSheet(fromPop){
  if(!sheet) return;
  sheet = null; confirmDelete = false; mainSig = '';
  closeComments();
  if(sheetHistory && !fromPop){ sheetBackPending = true; sheetHistory = false; try{ history.back(); }catch(e){ sheetBackPending = false; } }
  else if(fromPop){ sheetHistory = false; }
  renderMain(true);
}
// chamado pelo "popstate" do painel: devolve true quando o "voltar" foi usado para fechar a folha
function onBack(){
  if(sheetBackPending){ sheetBackPending = false; return true; }
  if(sheet){ closeSheet(true); return true; }
  return false;
}
function isSheetOpen(){ return !!sheet; }

// ---------- ações ----------
function patchCard(id, data){
  const c = cardById(id); if(c) Object.assign(c, data);
  return bRef().collection('cards').doc(id).update({ ...data, updatedAt: FV().serverTimestamp() }).catch(fail);
}
function toggleDone(id){
  const c = cardById(id); if(!c) return;
  patchCard(id, { done: !c.done, doneAt: !c.done ? Date.now() : null });
}
function moveToList(c, listId){
  if(!listId || listId === c.listId) return;
  const last = sortedCards(listId).slice(-1)[0];
  patchCard(c.id, { listId, order: (last ? last.order : 0) + 1024 });
}
// avisa no celular de quem foi escolhido como responsável (servidor de push)
function defAssignees(){
  const b = curBoard(); const r = b && b.responsible;
  return r && (b.memberUids || []).includes(r) ? [r] : [];
}
function notifyAssign(cardId, uids){
  const list = (uids || []).filter(u => u && u !== myUid);
  if(!list.length) return;
  try{
    if(typeof pushConfigured === 'function' && pushConfigured() && typeof pushCall === 'function')
      pushCall({ action: 'cartao', boardId: view && view.id, cardId, uids: list }).catch(() => {});
  }catch(e){}
}
function toggleAssignee(c, uid){
  const cur = c.assignees || [];
  const add = !cur.includes(uid);
  const next = add ? cur.concat(uid) : cur.filter(x => x !== uid);
  patchCard(c.id, { assignees: next }).then(() => { if(add) notifyAssign(c.id, [uid]); });
}
function newId(){ return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function addChk(c){
  const inp = byId('agChkIn'); if(!inp) return;
  const text = inp.value.trim(); if(!text) return;
  const latest = cardById(c.id) || c;
  inp.value = '';
  patchCard(c.id, { checklist: (latest.checklist || []).concat({ id: newId(), text, done: false }) });
  setTimeout(() => { const i = byId('agChkIn'); if(i) i.focus(); }, 30);
}
function toggleChk(c, itemId){
  const latest = cardById(c.id) || c;
  patchCard(c.id, { checklist: (latest.checklist || []).map(i => i.id === itemId ? { ...i, done: !i.done } : i) });
}
function delChk(c, itemId){
  const latest = cardById(c.id) || c;
  patchCard(c.id, { checklist: (latest.checklist || []).filter(i => i.id !== itemId) });
}
function sendComment(c){
  const inp = byId('agCmIn'); if(!inp) return;
  const text = inp.value.trim(); if(!text) return;
  inp.value = ''; inp.style.height = 'auto';
  bRef().collection('cards').doc(c.id).collection('comments').add({
    text, authorUid: myUid, authorName: myName(), createdAt: FV().serverTimestamp()
  }).catch(fail);
}
function deleteCard(c){
  confirmDelete = false;
  closeSheet();
  bRef().collection('cards').doc(c.id).delete().then(() => toast('Cartão excluído')).catch(fail);
}
function submitCard(listId){
  const t = byId('agCompose'); if(!t) return;
  const title = t.value.trim().replace(/\s+/g, ' ');
  if(!title){ t.focus(); return; }
  let extra = {}, w = wk;
  if(listId === '__day'){
    w = weekStart(selDay);
    const target = lists.find(l => WDAYS[String(l.name).trim().toLowerCase()] === (new Date(selDay).getDay() + 6) % 7) || lists.find(l => !/conclu/i.test(l.name)) || lists[0];
    if(!target){ toast('Crie uma lista antes de incluir cartões'); return; }
    listId = target.id;
    if(WDAYS[String(target.name).trim().toLowerCase()] === undefined) extra.due = selDay + 9 * 3600000;
  }
  const last = cards.filter(c => c.listId === listId && cardWeek(c) === w).sort((a, z) => (a.order || 0) - (z.order || 0)).slice(-1)[0];
  t.value = '';
  bRef().collection('cards').add({
    listId, title, desc: '', week: w, order: (last ? last.order : 0) + 1024, due: extra.due || null, done: false, assignees: defAssignees(), checklist: [],
    createdBy: myUid, createdByName: myName(), createdAt: FV().serverTimestamp(), updatedAt: FV().serverTimestamp()
  }).then(ref => notifyAssign(ref.id, defAssignees())).catch(fail);
  t.focus();
}
function addInbox(){
  const t = byId('agInbIn'); if(!t) return;
  const title = t.value.trim().replace(/\s+/g, ' '); if(!title){ t.focus(); return; }
  const target = lists.find(l => !isDayList(l) && !/conclu/i.test(l.name));
  if(!target){ toast('Crie uma lista (por exemplo, “A fazer”) para usar a caixa de entrada'); return; }
  const last = cards.filter(c => c.listId === target.id).sort((a, z) => (a.order || 0) - (z.order || 0)).slice(-1)[0];
  t.value = '';
  bRef().collection('cards').add({
    listId: target.id, title, desc: '', week: curWeek(), order: (last ? last.order : 0) + 1024, due: null, done: false, assignees: defAssignees(), checklist: [],
    createdBy: myUid, createdByName: myName(), createdAt: FV().serverTimestamp(), updatedAt: FV().serverTimestamp()
  }).then(ref => notifyAssign(ref.id, defAssignees())).catch(fail);
  t.focus();
}
function createModal(pre){
  const b = curBoard(); if(!b || !canAdd(b)){ toast('Você não pode incluir cartões nesta agenda'); return; }
  pre = pre || {};
  const day = pre.day != null ? pre.day : (['dia', 'semana', 'custom'].includes(mode) ? selDay : sod(Date.now()));
  const dstr = toLocalInput(day).slice(0, 10);
  const tm = pre.mins != null ? pad2(Math.floor(pre.mins / 60)) + ':' + pad2(pre.mins % 60) : '';
  const def = dayListFor(day) || lists.find(l => !isDayList(l) && !/conclu/i.test(l.name)) || lists[0];
  const root = byId('modalRoot');
  root.innerHTML = `<div class="modal-bg" id="agCBg"><div class="modal" style="max-width:400px;" role="dialog" aria-modal="true" aria-label="Novo cartão">
    <h3>Novo cartão</h3>
    <div class="ag-lbl">Título</div><input class="ag-field" id="agCTitle" maxlength="300" placeholder="O que precisa ser feito?" autocomplete="off">
    <div class="ag-roww" style="margin-top:10px"><div style="flex:1"><div class="ag-lbl">Data</div><input class="ag-field" type="date" id="agCDate" value="${attr(dstr)}"></div>
      <div style="width:122px"><div class="ag-lbl">Hora (opcional)</div><input class="ag-field" type="time" id="agCTime" value="${attr(tm)}"></div></div>
    <div class="ag-lbl" style="margin-top:10px">Lista</div>
    <select class="ag-select" id="agCList">${lists.map(l => `<option value="${attr(l.id)}"${def && l.id === def.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
    <div class="ag-lbl" style="margin-top:10px">Responsável (recebe aviso no celular)</div>
    <div class="ag-ppl" id="agCPpl">${(b.memberUids || []).map(u => `<button type="button" class="ag-p${defAssignees().includes(u) ? ' on' : ''}" data-u="${attr(u)}" aria-pressed="${defAssignees().includes(u) ? 'true' : 'false'}">${avatarHtml(userName(u), u)}${esc(u === myUid ? 'Eu' : firstName(userName(u)))}</button>`).join('')}</div>
    <div class="ag-hint" id="agCErr" style="color:var(--danger); min-height:18px; margin-top:6px"></div>
    <div class="actions"><button class="cancel" id="agCNo">Cancelar</button><button class="confirm" id="agCYes">Criar cartão</button></div></div></div>`;
  const close = () => { root.innerHTML = ''; };
  byId('agCNo').onclick = close;
  byId('agCBg').onclick = e => { if(e.target.id === 'agCBg') close(); };
  const dEl = byId('agCDate'), lEl = byId('agCList'), err = byId('agCErr');
  const picked = new Set(defAssignees());
  byId('agCPpl').onclick = e => { const bt = e.target.closest('[data-u]'); if(!bt) return; const u = bt.dataset.u;
    if(picked.has(u)){ picked.delete(u); bt.classList.remove('on'); bt.setAttribute('aria-pressed', 'false'); } else { picked.add(u); bt.classList.add('on'); bt.setAttribute('aria-pressed', 'true'); } };
  dEl.onchange = () => { const d = dEl.value ? new Date(dEl.value + 'T00:00').getTime() : null; const l = d && dayListFor(d); if(l && isDayList(lists.find(x => x.id === lEl.value))) lEl.value = l.id; };
  const go = () => {
    const title = byId('agCTitle').value.trim().replace(/\s+/g, ' ');
    if(!title){ err.textContent = 'Escreva um título.'; byId('agCTitle').focus(); return; }
    if(!lists.length){ err.textContent = 'Crie uma lista antes de incluir cartões.'; return; }
    const date = dEl.value ? new Date(dEl.value + 'T00:00').getTime() : sod(Date.now());
    if(!canManage(b) && !weekOpen(weekStart(date))){ err.textContent = 'Só a semana atual e a próxima aceitam cartões novos.'; return; }
    const tv = byId('agCTime').value; const mins = tv ? (+tv.slice(0, 2)) * 60 + (+tv.slice(3, 5)) : null;
    let list = lists.find(l => l.id === lEl.value); let extra = {};
    if(isDayList(list)){ list = dayListFor(date) || list; if(mins !== null) extra = { due: date + mins * 60000, allDay: false }; }
    else if(mins !== null) extra = { due: date + mins * 60000, allDay: false };
    else extra = { due: date + 86399000, allDay: true };
    const w = weekStart(date);
    const last = cards.filter(c => c.listId === list.id && cardWeek(c) === w).sort((a, z) => (a.order || 0) - (z.order || 0)).slice(-1)[0];
    bRef().collection('cards').add(Object.assign({
      listId: list.id, title, desc: '', week: w, order: (last ? last.order : 0) + 1024, due: null, done: false, assignees: Array.from(picked), checklist: [],
      createdBy: myUid, createdByName: myName(), createdAt: FV().serverTimestamp(), updatedAt: FV().serverTimestamp()
    }, extra)).then(ref => { toast(picked.size ? 'Cartão criado · responsável avisado' : 'Cartão criado'); notifyAssign(ref.id, Array.from(picked)); }).catch(fail);
    close();
  };
  byId('agCYes').onclick = go;
  byId('agCTitle').onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); go(); } else if(e.key === 'Escape') close(); };
  byId('agCTitle').focus();
}
function customModal(){
  const root = byId('modalRoot');
  root.innerHTML = `<div class="modal-bg" id="agPBg"><div class="modal" style="max-width:340px;" role="dialog" aria-modal="true" aria-label="Personalizar dias">
    <h3>Quantos dias mostrar?</h3>
    <select class="ag-select" id="agPN" aria-label="Número de dias">${[2, 3, 4, 5, 6, 7].map(n => `<option value="${n}"${n === customN ? ' selected' : ''}>${n} dias a partir do dia escolhido</option>`).join('')}</select>
    <div class="actions" style="margin-top:14px"><button class="cancel" id="agPNo">Cancelar</button><button class="confirm" id="agPYes">Aplicar</button></div></div></div>`;
  const close = () => { root.innerHTML = ''; };
  byId('agPNo').onclick = close; byId('agPBg').onclick = e => { if(e.target.id === 'agPBg') close(); };
  byId('agPYes').onclick = () => { customN = +byId('agPN').value; close(); setMode('custom'); };
}
function rescheduleCard(c, day, mins){
  const b = curBoard(); if(!b || !c) return;
  if(!canEditCard(b, c)){ toast('Você não pode alterar este cartão'); return; }
  if(!canManage(b) && !weekOpen(weekStart(day))){ toast('Só a semana atual e a próxima aceitam cartões'); return; }
  const patch = { week: weekStart(day) };
  const t = mins != null ? mins : (hasTime(c) ? minsOf(c.due) : null);
  if(t == null){ patch.allDay = true; patch.due = day + 86399000; } else { patch.allDay = false; patch.due = day + t * 60000; }
  if(c.start) patch.start = c.start + (day - cardDate(c));
  const cur = lists.find(l => l.id === c.listId);
  if(isDayList(cur)){ const tg = dayListFor(day); if(tg && tg.id !== c.listId){ patch.listId = tg.id; const last = cards.filter(x => x.listId === tg.id && cardWeek(x) === patch.week).sort((a, z) => (a.order || 0) - (z.order || 0)).slice(-1)[0]; patch.order = (last ? last.order : 0) + 1024; } }
  patchCard(c.id, patch);
}
function unschedule(c){
  const b = curBoard(); if(!b || !c || !canEditCard(b, c)) return;
  const cur = lists.find(l => l.id === c.listId);
  const patch = { due: null, allDay: false, start: null };
  if(isDayList(cur)){ const tg = lists.find(l => !isDayList(l) && !/conclu/i.test(l.name)); if(!tg){ toast('Crie uma lista (por exemplo, “A fazer”) para usar a caixa de entrada'); return; } patch.listId = tg.id; }
  patchCard(c.id, patch);
}

// arrastar cartões entre dias e horários (Dia, Semana, Mês, Agenda e Caixa de entrada)
function calDragStart(e, el){
  if(cdrag) return;
  if(e.type === 'mousedown' && e.button !== 0) return;
  const touch = e.type === 'touchstart', pt = touch ? e.touches[0] : e;
  const st = { el, id: el.getAttribute('data-card'), sx: pt.clientX, sy: pt.clientY, x: pt.clientX, y: pt.clientY, touch, active: false, timer: null, ghost: null, over: null };
  cdrag = st;
  if(touch) st.timer = setTimeout(() => { if(cdrag === st) calBegin(st); }, 340);
  document.addEventListener(touch ? 'touchmove' : 'mousemove', calMove, { passive: false });
  document.addEventListener(touch ? 'touchend' : 'mouseup', calEnd);
  if(touch) document.addEventListener('touchcancel', calCancel);
}
function calBegin(st){
  st.active = true;
  const r = st.el.getBoundingClientRect();
  const g = st.el.cloneNode(true); g.classList.add('ag-cghost'); g.removeAttribute('data-card'); g.removeAttribute('tabindex');
  g.style.width = Math.min(Math.max(r.width, 140), 240) + 'px'; g.style.left = '0'; g.style.top = '0'; g.style.height = 'auto';
  document.body.appendChild(g); st.ghost = g; st.el.classList.add('ghosted');
  document.body.classList.add('ag-dragging');
  if(navigator.vibrate) try{ navigator.vibrate(12); }catch(e){}
  calPlace(st);
}
function calPlace(st){
  st.ghost.style.transform = `translate(${st.x - 24}px, ${st.y - 16}px) rotate(2deg)`;
  st.ghost.style.visibility = 'hidden';
  const hit = document.elementFromPoint(st.x, st.y);
  st.ghost.style.visibility = '';
  const tg = hit && hit.closest('[data-drop-day], [data-drop-inbox]');
  if(st.over !== tg){ if(st.over) st.over.classList.remove('drop'); if(tg) tg.classList.add('drop'); st.over = tg; }
}
function calMove(e){
  const st = cdrag; if(!st) return;
  const pt = e.touches ? e.touches[0] : e; st.x = pt.clientX; st.y = pt.clientY;
  if(!st.active){
    if(Math.hypot(st.x - st.sx, st.y - st.sy) > (st.touch ? 10 : 5)){ if(st.touch){ calCancel(); return; } calBegin(st); } else return;
  }
  if(e.cancelable) e.preventDefault();
  calPlace(st);
}
function calCleanup(){
  const st = cdrag; if(!st) return;
  clearTimeout(st.timer);
  document.removeEventListener('mousemove', calMove); document.removeEventListener('touchmove', calMove);
  document.removeEventListener('mouseup', calEnd); document.removeEventListener('touchend', calEnd); document.removeEventListener('touchcancel', calCancel);
  if(st.ghost) st.ghost.remove(); if(st.over) st.over.classList.remove('drop');
  st.el.classList.remove('ghosted'); document.body.classList.remove('ag-dragging');
  cdrag = null;
}
function calCancel(){ calCleanup(); }
function calEnd(){
  const st = cdrag; if(!st) return;
  const was = st.active, over = st.over, y = st.y, id = st.id;
  calCleanup();
  if(!was) return;
  lastDragEnd = Date.now();
  const c = cardById(id); if(!c || !over) return;
  if(over.hasAttribute('data-drop-inbox')){ unschedule(c); return; }
  const day = +over.getAttribute('data-drop-day');
  let mins = null;
  if(over.classList.contains('ag-gcol')){
    const r = over.getBoundingClientRect(), h0 = +over.getAttribute('data-h0'), n = +over.getAttribute('data-n');
    mins = Math.max(0, Math.min(23 * 60 + 45, Math.round((h0 * 60 + (y - r.top) / r.height * n * 60) / 15) * 15));
  }
  rescheduleCard(c, day, mins);
}

function submitList(){
  const t = byId('agNewList'); if(!t) return;
  const name = t.value.trim().replace(/\s+/g, ' ');
  if(!name){ t.focus(); return; }
  const last = lists.slice(-1)[0];
  t.value = '';
  bRef().collection('lists').add({ name, order: (last ? last.order : 0) + 1024, createdAt: FV().serverTimestamp() }).catch(fail);
  t.focus();
  setTimeout(() => { const nb = document.querySelector('#mainPane .ag-board'); if(nb) nb.scrollTo({ left: nb.scrollWidth, behavior: 'smooth' }); }, 250);
}
function listMenu(anchor, listId){
  const l = lists.find(x => x.id === listId); if(!l) return;
  const i = lists.indexOf(l);
  openMenu(anchor, [
    { label: 'Renomear lista', icon: editSvg, action: () => promptModal('Renomear lista', l.name, 40, name => bRef().collection('lists').doc(listId).update({ name }).catch(fail)) },
    i > 0 ? { label: 'Mover para a esquerda', icon: I.left, action: () => swapLists(l, lists[i - 1]) } : null,
    i < lists.length - 1 ? { label: 'Mover para a direita', icon: I.right, action: () => swapLists(l, lists[i + 1]) } : null,
    { label: 'Excluir lista', icon: trashSvg, danger: true, action: () => deleteList(l) }
  ]);
}
function swapLists(a, b){
  const batch = db.batch();
  batch.update(bRef().collection('lists').doc(a.id), { order: b.order });
  batch.update(bRef().collection('lists').doc(b.id), { order: a.order });
  batch.commit().catch(fail);
}
function deleteList(l){
  const n = sortedCards(l.id, true).length;
  const root = byId('modalRoot');
  root.innerHTML = `<div class="modal-bg" id="agMBg"><div class="modal" style="max-width:360px;" role="alertdialog" aria-modal="true">
    <h3>Excluir a lista “${esc(l.name)}”?</h3>
    <div style="font-size:14px;color:var(--ink-soft);margin-bottom:14px;line-height:1.5;">${n ? `Os ${n} cartão${n === 1 ? '' : 's'} desta lista também ${n === 1 ? 'será excluído' : 'serão excluídos'}. Essa ação não pode ser desfeita.` : 'A lista está vazia. Essa ação não pode ser desfeita.'}</div>
    <div class="actions"><button class="cancel" id="agMNo">Cancelar</button><button class="confirm" id="agMYes" style="background:var(--danger);color:#fff;">Excluir lista</button></div></div></div>`;
  const close = () => { root.innerHTML = ''; };
  byId('agMNo').onclick = close;
  byId('agMBg').onclick = e => { if(e.target.id === 'agMBg') close(); };
  byId('agMYes').onclick = async () => {
    byId('agMYes').disabled = true;
    try{
      const batch = db.batch();
      sortedCards(l.id, true).forEach(c => batch.delete(bRef().collection('cards').doc(c.id)));
      batch.delete(bRef().collection('lists').doc(l.id));
      await batch.commit();
      close();
    }catch(err){ close(); fail(err); }
  };
}

// membros
function setMemberRole(uid, role){
  if(!['editor', 'colab', 'leitor'].includes(role)) return;
  bRef().update({ ['members.' + uid]: role, updatedAt: FV().serverTimestamp() }).catch(fail);
}
function removeMember(uid){
  bRef().update({ ['members.' + uid]: FV().delete(), memberUids: FV().arrayRemove(uid), ...(((curBoard() || {}).responsible) === uid ? { responsible: null } : {}), updatedAt: FV().serverTimestamp() }).catch(fail);
}
function addMember(uid, role){
  if(!uid) return;
  bRef().update({ ['members.' + uid]: role, memberUids: FV().arrayUnion(uid), updatedAt: FV().serverTimestamp() })
    .then(() => toast(userName(uid) + ' entrou na agenda'))
    .catch(fail);
}

// ---------- janelas simples ----------
function promptModal(title, value, max, onSave){
  const root = byId('modalRoot');
  root.innerHTML = `<div class="modal-bg" id="agMBg"><div class="modal" style="max-width:360px;" role="dialog" aria-modal="true" aria-label="${attr(title)}">
    <h3>${esc(title)}</h3>
    <input id="agMIn" type="text" maxlength="${max}" value="${attr(value || '')}" aria-label="${attr(title)}">
    <div class="login-error" id="agMErr"></div>
    <div class="actions"><button class="cancel" id="agMNo">Cancelar</button><button class="confirm" id="agMYes">Salvar</button></div></div></div>`;
  const close = () => { root.innerHTML = ''; };
  const inp = byId('agMIn'); inp.focus(); inp.select();
  const save = () => {
    const v = inp.value.trim().replace(/\s+/g, ' ');
    if(!v){ byId('agMErr').textContent = 'Digite um nome.'; return; }
    close(); onSave(v);
  };
  byId('agMNo').onclick = close;
  byId('agMYes').onclick = save;
  byId('agMBg').onclick = e => { if(e.target.id === 'agMBg') close(); };
  inp.onkeydown = e => { if(e.key === 'Enter') save(); else if(e.key === 'Escape') close(); };
}

function showNewBoardModal(){
  const root = byId('modalRoot');
  root.innerHTML = `<div class="modal-bg" id="agMBg"><div class="modal" style="max-width:400px;" role="dialog" aria-modal="true" aria-label="Nova agenda">
    <h3>Nova agenda</h3>
    <input id="agMIn" type="text" maxlength="40" placeholder="Ex.: Agenda do João, Expedição" aria-label="Nome da agenda">
    <div style="font-size:13px;font-weight:800;color:var(--ink-soft);margin:2px 0 8px;">Listas iniciais</div>
    <div class="ag-seg" style="margin-bottom:12px;">${TEMPLATES.map((t, i) => `<label><input type="radio" name="agTpl" value="${t.id}"${i === 0 ? ' checked' : ''}>${esc(t.label)}</label>`).join('')}</div>
    <div class="login-error" id="agMErr"></div>
    <div class="actions"><button class="cancel" id="agMNo">Cancelar</button><button class="confirm" id="agMYes">Criar agenda</button></div></div></div>`;
  const close = () => { root.innerHTML = ''; };
  const inp = byId('agMIn'); inp.focus();
  byId('agMNo').onclick = close;
  byId('agMBg').onclick = e => { if(e.target.id === 'agMBg') close(); };
  const go = async () => {
    const name = inp.value.trim().replace(/\s+/g, ' ');
    if(!name){ byId('agMErr').textContent = 'Digite o nome da agenda.'; inp.focus(); return; }
    const tpl = TEMPLATES.find(t => t.id === (document.querySelector('input[name="agTpl"]:checked') || {}).value) || TEMPLATES[0];
    byId('agMYes').disabled = true;
    try{
      const ref = db.collection('boards').doc();
      await ref.set({
        name, ownerUid: myUid, ownerName: myName(),
        members: { [myUid]: 'dono' }, memberUids: [myUid],
        createdAt: FV().serverTimestamp(), updatedAt: FV().serverTimestamp()
      });
      if(tpl.lists.length){
        const batch = db.batch();
        tpl.lists.forEach((n, i) => batch.set(ref.collection('lists').doc(), { name: n, order: (i + 1) * 1024, createdAt: FV().serverTimestamp() }));
        await batch.commit();
      }
      close();
      if(section !== 'agendas') goSection('agendas');
      openBoard(ref.id);
    }catch(err){ byId('agMYes').disabled = false; byId('agMErr').textContent = errMsg(err); }
  };
  byId('agMYes').onclick = go;
  inp.onkeydown = e => { if(e.key === 'Enter') go(); else if(e.key === 'Escape') close(); };
}

function showDeleteBoardModal(b){
  const root = byId('modalRoot');
  root.innerHTML = `<div class="modal-bg" id="agMBg"><div class="modal" style="max-width:380px;" role="alertdialog" aria-modal="true">
    <h3>Excluir a agenda “${esc(b.name)}”?</h3>
    <div style="font-size:14px;color:var(--ink-soft);margin-bottom:14px;line-height:1.5;">Todas as listas, cartões e comentários somem para todos os membros. Essa ação não pode ser desfeita.</div>
    <div class="login-error" id="agMErr"></div>
    <div class="actions"><button class="cancel" id="agMNo">Cancelar</button><button class="confirm" id="agMYes" style="background:var(--danger);color:#fff;">Excluir agenda</button></div></div></div>`;
  const close = () => { root.innerHTML = ''; };
  byId('agMNo').onclick = close;
  byId('agMBg').onclick = e => { if(e.target.id === 'agMBg') close(); };
  byId('agMYes').onclick = async () => {
    byId('agMYes').disabled = true;
    try{
      const ref = bRef(b.id);
      const chunks = async (col) => {
        const snap = await ref.collection(col).get();
        for(let i = 0; i < snap.docs.length; i += 400){
          const batch = db.batch();
          snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      };
      // comentários ficam dentro dos cartões: apaga primeiro
      const cs = await ref.collection('cards').get();
      for(const d of cs.docs){
        const cm = await d.ref.collection('comments').get();
        if(cm.size){ const batch = db.batch(); cm.docs.forEach(x => batch.delete(x.ref)); await batch.commit(); }
      }
      await chunks('cards'); await chunks('lists');
      await ref.delete();
      close();
      toast('Agenda excluída');
    }catch(err){ byId('agMYes').disabled = false; byId('agMErr').textContent = errMsg(err); }
  };
}

// ---------- arrastar cartões (mouse e toque) ----------
function dragStart(e, el, kind){
  if(drag) return;
  if(e.target.closest('button, a, input, textarea, select')) return;
  if(kind === 'touch' && e.touches.length !== 1) return;
  const pt = kind === 'touch' ? e.touches[0] : e;
  const st = { el, kind, id: el.getAttribute('data-card'), sx: pt.clientX, sy: pt.clientY, x: pt.clientX, y: pt.clientY, active: false, timer: null, ghost: null, ph: null, raf: 0, ox: 0, oy: 0 };
  drag = st;
  if(kind === 'touch'){
    st.timer = setTimeout(() => { if(drag === st) beginDrag(st); }, 340);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onUp);
    document.addEventListener('touchcancel', onUp);
  } else {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onUp);
  }
}
function onTouchMove(e){
  const st = drag; if(!st) return;
  const t = e.touches[0]; st.x = t.clientX; st.y = t.clientY;
  if(!st.active){ if(Math.hypot(st.x - st.sx, st.y - st.sy) > 9){ cancelDrag(); } return; }
  e.preventDefault();
  moveDrag(st);
}
function onMouseMove(e){
  const st = drag; if(!st) return;
  st.x = e.clientX; st.y = e.clientY;
  if(!st.active){ if(Math.hypot(st.x - st.sx, st.y - st.sy) < 6) return; beginDrag(st); }
  moveDrag(st);
}
function onUp(){
  const st = drag; if(!st) return;
  if(st.active) finishDrag(st); else cancelDrag();
}
function removeDragListeners(){
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onUp);
  document.removeEventListener('touchcancel', onUp);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onUp);
}
function cancelDrag(){
  const st = drag; if(!st) return;
  clearTimeout(st.timer); cancelAnimationFrame(st.raf);
  removeDragListeners();
  if(st.ghost) st.ghost.remove();
  if(st.ph) st.ph.remove();
  if(st.el) st.el.classList.remove('ghosted');
  document.body.classList.remove('ag-dragging');
  drag = null;
  if(dragPendingRender){ dragPendingRender = false; mainSig = ''; renderMain(true); }
}
function beginDrag(st){
  st.active = true;
  try{ if(navigator.vibrate) navigator.vibrate(14); }catch(_){}
  const r = st.el.getBoundingClientRect();
  st.ox = st.sx - r.left; st.oy = st.sy - r.top;
  const g = st.el.cloneNode(true);
  g.classList.add('ag-ghost'); g.removeAttribute('data-card'); g.removeAttribute('tabindex');
  g.style.width = r.width + 'px';
  document.body.appendChild(g);
  st.ghost = g;
  const ph = document.createElement('div');
  ph.className = 'ag-drop'; ph.style.height = r.height + 'px';
  st.el.parentNode.insertBefore(ph, st.el);
  st.el.classList.add('ghosted');
  st.ph = ph;
  document.body.classList.add('ag-dragging');
  moveDrag(st);
  const loop = () => { if(drag !== st || !st.active) return; autoScroll(st); placePlaceholder(st); st.raf = requestAnimationFrame(loop); };
  st.raf = requestAnimationFrame(loop);
}
function moveDrag(st){
  st.ghost.style.transform = `translate(${st.x - st.ox}px, ${st.y - st.oy}px) rotate(2.4deg)`;
  placePlaceholder(st);
}
function colAt(x){
  const cols = Array.from(document.querySelectorAll('#mainPane .ag-col'));
  let best = null, dist = Infinity;
  cols.forEach(c => {
    const r = c.getBoundingClientRect();
    const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if(d < dist){ dist = d; best = c; }
  });
  return best;
}
function placePlaceholder(st){
  const col = colAt(st.x); if(!col) return;
  const wrap = col.querySelector('.ag-cards');
  const sibs = Array.from(wrap.querySelectorAll('.ag-card:not(.ghosted)'));
  let before = null;
  for(const s of sibs){
    const r = s.getBoundingClientRect();
    if(st.y < r.top + r.height / 2){ before = s; break; }
  }
  if(before){ if(st.ph.nextSibling !== before || st.ph.parentNode !== wrap) wrap.insertBefore(st.ph, before); }
  else if(wrap.lastElementChild !== st.ph) wrap.appendChild(st.ph);
}
function autoScroll(st){
  const board = document.querySelector('#mainPane .ag-board'); if(!board) return;
  const br = board.getBoundingClientRect();
  const edge = 56;
  if(st.x < br.left + edge) board.scrollLeft -= 16;
  else if(st.x > br.right - edge) board.scrollLeft += 16;
  const col = colAt(st.x);
  if(col){
    const w = col.querySelector('.ag-cards'), wr = w.getBoundingClientRect();
    if(st.y < wr.top + 44) w.scrollTop -= 12; else if(st.y > wr.bottom - 44) w.scrollTop += 12;
  }
}
function finishDrag(st){
  const wrap = st.ph.parentNode;
  const listId = wrap ? wrap.getAttribute('data-list') : null;
  const idx = wrap ? Array.from(wrap.children).filter(n => n.classList.contains('ag-card') && !n.classList.contains('ghosted') || n === st.ph).indexOf(st.ph) : -1;
  lastDragEnd = Date.now();
  const card = cardById(st.id);
  // limpa a interface do arraste
  clearTimeout(st.timer); cancelAnimationFrame(st.raf); removeDragListeners();
  st.ghost.remove(); st.ph.remove(); st.el.classList.remove('ghosted');
  document.body.classList.remove('ag-dragging');
  drag = null;
  if(card && listId){
    const sibs = sortedCards(listId).filter(c => c.id !== card.id);
    const prev = sibs[idx - 1], next = sibs[idx];
    let order;
    if(prev && next) order = (prev.order + next.order) / 2;
    else if(prev) order = prev.order + 1024;
    else if(next) order = next.order - 1024;
    else order = 1024;
    if(listId !== card.listId || order !== card.order){
      const moved = listId !== card.listId;
      card.listId = listId; card.order = order;       // aparece já no lugar novo
      bRef().collection('cards').doc(card.id).update({ listId, order, updatedAt: FV().serverTimestamp() })
        .then(() => { if(moved) toast('Movido para ' + listName(listId)); })
        .catch(err => { fail(err); });
    }
  }
  dragPendingRender = false; mainSig = ''; renderMain(true);
}

// ---------- menu circular do celular ----------
function fanBadgeCount(id){
  const el = byId(id); if(!el || el.style.display === 'none') return 0;
  return parseInt(el.textContent, 10) || 0;
}
function syncFabBadge(){
  const me = byId('railMeBtn'); if(!me) return;
  const ico = me.querySelector('.rail-ico'); if(!ico) return;
  let b = byId('railFabBadge');
  const total = fanBadgeCount('demandBadge') + fanBadgeCount('reqBadge');
  if(!total){ if(b) b.remove(); return; }
  if(!b){ b = document.createElement('span'); b.id = 'railFabBadge'; ico.appendChild(b); }
  b.textContent = total > 99 ? '99+' : String(total);
}
function toggleFan(){ if(fanOpen) closeFan(); else openFan(); }
function openFan(){
  if(fanOpen) return;
  const me = byId('railMeBtn'); if(!me) return;
  injectCss();
  const ico = me.querySelector('.rail-ico') || me;
  const r = ico.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const items = [
    { go: 'agendas', label: 'Agendas', icon: I.kanban, n: 0 },
    { go: 'requisicao', label: 'Requisições', icon: I.box, n: fanBadgeCount('reqBadge') },
    { go: 'demands', label: 'Demandas', icon: I.clip, n: fanBadgeCount('demandBadge') }
  ];
  const radius = Math.min(118, Math.max(96, window.innerWidth * 0.3));
  const angles = [152, 90, 28];
  const el = document.createElement('div');
  el.className = 'ag-fan'; el.id = 'agFan'; el.setAttribute('role', 'menu'); el.setAttribute('aria-label', 'Atalhos');
  el.innerHTML = '<div class="ag-fan-scrim" id="agFanScrim"></div>' + items.map((it, i) => {
    const a = angles[i] * Math.PI / 180;
    let tx = Math.cos(a) * radius, ty = -Math.sin(a) * radius;
    // não deixa a bolinha sair da tela
    tx = Math.max(38 - cx, Math.min(window.innerWidth - 38 - cx, tx));
    const left = cx, top = cy;
    return `<button class="ag-fan-item" role="menuitem" data-fan="${it.go}" style="left:${left}px; top:${top}px; --sx:0px; --sy:0px; --tx:${tx.toFixed(1)}px; --ty:${ty.toFixed(1)}px; --d:${(i * 45)}ms;" aria-label="${it.label}${it.n ? ', ' + it.n + ' novas' : ''}">${it.icon}${it.n ? `<span class="ag-fan-badge">${it.n > 99 ? '99+' : it.n}</span>` : ''}<span class="ag-fan-lbl">${it.label}</span></button>`;
  }).join('');
  document.body.appendChild(el);
  fanOpen = true;
  byId('rail').classList.add('fan-open');
  me.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  byId('agFanScrim').onclick = () => closeFan();
  el.querySelectorAll('[data-fan]').forEach(b => b.onclick = () => { const go = b.getAttribute('data-fan'); closeFan(); goSection(go); });
  const f = el.querySelector('[data-fan]'); if(f) setTimeout(() => f.focus({ preventScroll: true }), 60);
  document.addEventListener('keydown', fanKey);
}
function fanKey(e){
  if(e.key === 'Escape'){ closeFan(); const me = byId('railMeBtn'); if(me) me.focus(); }
  else if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
    const its = Array.from(document.querySelectorAll('#agFan [data-fan]')); const i = its.indexOf(document.activeElement);
    if(i < 0) return;
    e.preventDefault();
    its[(i + (e.key === 'ArrowRight' ? -1 : 1) + its.length) % its.length].focus();
  }
}
function closeFan(instant){
  const el = byId('agFan');
  document.removeEventListener('keydown', fanKey);
  fanOpen = false;
  const rail = byId('rail'); if(rail) rail.classList.remove('fan-open');
  const me = byId('railMeBtn'); if(me) me.setAttribute('aria-expanded', 'false');
  if(!el) return;
  if(instant){ el.remove(); return; }
  el.classList.remove('in');
  setTimeout(() => el.remove(), 220);
}

// botão do papel (Admin ou Ajustes) e distintivo do botão central
function syncRail(){
  const adm = byId('railAdminBtn'), set = byId('railSetBtn');
  if(adm) adm.classList.toggle('hidden', !isAdmin);
  if(set) set.classList.toggle('hidden', !!isAdmin);
  syncFabBadge();
}
function initRail(){
  injectCss();
  const me = byId('railMeBtn');
  if(me){ me.setAttribute('aria-haspopup', 'menu'); me.setAttribute('aria-expanded', 'false'); }
  ['demandBadge', 'reqBadge'].forEach(id => {
    const el = byId(id); if(!el || el._agObs) return;
    el._agObs = new MutationObserver(syncFabBadge);
    el._agObs.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  });
  window.addEventListener('resize', () => { if(fanOpen) closeFan(true); });
  syncFabBadge();
}

window.AG = {
  start, stop, leave, buildSidebar, renderList, renderMain, onBack, isSheetOpen,
  toggleFan, closeFan, isFanOpen: () => fanOpen, syncRail, initRail, openBoard,
  isViewOpen: () => !!view, closeBoard: () => { cancelDrag(); closeData(); view = null; sheet = null; composing = null; mainSig = ''; sheetHistory = false; sheetBackPending = false; }
};
if(document.getElementById('rail')) initRail();
})();
