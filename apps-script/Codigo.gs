// =====================================================================
// SERVIDOR DE NOTIFICAÇÕES (push) — Painel D Coração Home
// Apps Script publicado como Aplicativo da Web. O painel chama este endereço
// quando alguém manda mensagem ou cria uma demanda; aqui o aviso é enviado
// pelo Firebase Cloud Messaging (FCM v1) para os aparelhos de quem deve receber,
// mesmo com o app fechado.
//
// Configuração (veja CONFIGURAR-NOTIFICACOES.txt):
//   Configurações do projeto > Propriedades do script > SA_JSON =
//   conteúdo inteiro do arquivo .json da conta de serviço do Firebase (d-coracao).
// =====================================================================
const PROJECT_ID = 'd-coracao';
const WEB_API_KEY = 'AIzaSyCQAtYX8k8d_WPevHNlHkzyn2vn9cbRfs0';   // mesma chave pública do index.html
const MAX_TOKENS_POR_PESSOA = 8;

// ---------------------------------------------------------------------
// Entrada: o painel envia POST (texto/plain com JSON). A resposta não é lida pelo painel.
// ---------------------------------------------------------------------
function doPost(e){
  let out = { ok: false };
  try{
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const uid = uidDoToken_(body.idToken);
    if(!uid) return json_({ ok: false, erro: 'login inválido' });
    switch(body.action){
      case 'registrar':   registrar_(uid, body.fcmToken); out = { ok: true }; break;
      case 'desregistrar': desregistrar_(uid, body.fcmToken); out = { ok: true }; break;
      case 'msg':         out = { ok: true, enviados: avisarMensagem_(uid, body.convId) }; break;
      case 'demanda':     out = { ok: true, enviados: avisarDemanda_(uid, body.demandId) }; break;
      default:            out = { ok: false, erro: 'ação desconhecida' };
    }
  }catch(err){
    out = { ok: false, erro: String(err && err.message || err) };
    console.error(out.erro);
  }
  return json_(out);
}

function doGet(){ return json_({ ok: true, servico: 'push painel D Coração' }); }
function json_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------------------------------------------------------------------
// Quem está chamando: valida o token de login do Firebase
// ---------------------------------------------------------------------
function uidDoToken_(idToken){
  if(!idToken) return null;
  const r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + WEB_API_KEY, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ idToken: idToken })
  });
  if(r.getResponseCode() !== 200) return null;
  const u = (JSON.parse(r.getContentText()).users || [])[0];
  return u && !u.disabled ? u.localId : null;
}

// ---------------------------------------------------------------------
// Tokens dos aparelhos (guardados nas propriedades do script: uma por pessoa)
// ---------------------------------------------------------------------
function lerTokens_(uid){
  try{ return JSON.parse(PropertiesService.getScriptProperties().getProperty('T_' + uid) || '[]'); }catch(e){ return []; }
}
function gravarTokens_(uid, lista){
  const p = PropertiesService.getScriptProperties();
  if(lista.length) p.setProperty('T_' + uid, JSON.stringify(lista)); else p.deleteProperty('T_' + uid);
}
function registrar_(uid, token){
  if(!token || typeof token !== 'string' || token.length > 1024) return;
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try{
    // o mesmo aparelho só pode pertencer a uma pessoa (celular compartilhado)
    const props = PropertiesService.getScriptProperties().getProperties();
    Object.keys(props).forEach(k => {
      if(k.indexOf('T_') !== 0 || k === 'T_' + uid) return;
      let l = []; try{ l = JSON.parse(props[k]); }catch(e){}
      if(l.indexOf(token) !== -1) gravarTokens_(k.slice(2), l.filter(t => t !== token));
    });
    const l = lerTokens_(uid).filter(t => t !== token);
    l.push(token);
    gravarTokens_(uid, l.slice(-MAX_TOKENS_POR_PESSOA));
  } finally { lock.releaseLock(); }
}
function desregistrar_(uid, token){
  if(!token) return;
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try{ gravarTokens_(uid, lerTokens_(uid).filter(t => t !== token)); } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------------
// Mensagem nova numa conversa
// ---------------------------------------------------------------------
function avisarMensagem_(uid, convId){
  if(!convId) return 0;
  const c = lerDoc_('conversations/' + convId);
  if(!c) return 0;
  const parts = c.participants || [];
  if(parts.indexOf(uid) === -1 || c.lastSenderUid !== uid) return 0;   // só quem enviou dispara
  const nome = nomeDe_(uid);
  const texto = String(c.lastMessage || 'Nova mensagem');
  let n = 0;
  parts.filter(p => p !== uid).forEach(dest => {
    n += enviar_(dest, { title: nome, body: texto.length > 140 ? texto.slice(0, 137) + '…' : texto, convId: convId });
  });
  return n;
}

// ---------------------------------------------------------------------
// Demanda nova: avisa quem foi marcado
// ---------------------------------------------------------------------
function avisarDemanda_(uid, demandId){
  if(!demandId) return 0;
  const d = lerDoc_('demands/' + demandId);
  if(!d || d.createdBy !== uid) return 0;                              // só quem criou dispara
  const nome = d.createdByName || nomeDe_(uid);
  const titulo = String(d.title || 'Nova demanda');
  const prazo = d.deadline ? ' · prazo ' + String(d.deadline).split('-').reverse().join('/') : '';
  let n = 0;
  (d.assignedTo || []).filter(p => p !== uid).forEach(dest => {
    n += enviar_(dest, { title: 'Nova demanda de ' + nome, body: titulo + prazo, section: 'demands' });
  });
  return n;
}

function nomeDe_(uid){
  const u = lerDoc_('users/' + uid) || {};
  return u.chatName || String(u.email || 'Alguém').split('@')[0];
}

// ---------------------------------------------------------------------
// Envio pelo FCM v1 (só "data": quem monta o aviso é o service worker)
// ---------------------------------------------------------------------
function enviar_(uidDestino, dados){
  const tokens = lerTokens_(uidDestino);
  if(!tokens.length) return 0;
  const data = {};
  Object.keys(dados).forEach(k => { if(dados[k] != null) data[k] = String(dados[k]); });
  const acesso = tokenAcesso_();
  const invalidos = [];
  let ok = 0;
  tokens.forEach(t => {
    const r = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + PROJECT_ID + '/messages:send', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + acesso },
      payload: JSON.stringify({ message: {
        token: t, data: data,
        webpush: { headers: { Urgency: 'high', TTL: '86400' } },
        android: { priority: 'HIGH' }
      } })
    });
    const code = r.getResponseCode();
    if(code === 200) ok++;
    else if(code === 404 || code === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(r.getContentText())) invalidos.push(t);
    else console.error('FCM ' + code + ': ' + r.getContentText().slice(0, 300));
  });
  if(invalidos.length){
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try{ gravarTokens_(uidDestino, lerTokens_(uidDestino).filter(t => invalidos.indexOf(t) === -1)); } finally { lock.releaseLock(); }
  }
  return ok;
}

// ---------------------------------------------------------------------
// Conta de serviço: token OAuth (guardado em cache por ~50 min)
// ---------------------------------------------------------------------
function tokenAcesso_(){
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('oauth');
  if(guardado) return guardado;
  const sa = JSON.parse(PropertiesService.getScriptProperties().getProperty('SA_JSON') || 'null');
  if(!sa || !sa.private_key) throw new Error('SA_JSON não configurado nas propriedades do script');
  const agora = Math.floor(Date.now() / 1000);
  const b64 = s => Utilities.base64EncodeWebSafe(s).replace(/=+$/, '');
  const cab = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600
  }));
  const assinatura = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(cab + '.' + corpo, sa.private_key)).replace(/=+$/, '');
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: cab + '.' + corpo + '.' + assinatura }
  });
  if(r.getResponseCode() !== 200) throw new Error('OAuth ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  const tk = JSON.parse(r.getContentText()).access_token;
  cache.put('oauth', tk, 3000);
  return tk;
}

// ---------------------------------------------------------------------
// Firestore (REST, como conta de serviço — ignora as regras de segurança)
// ---------------------------------------------------------------------
function lerDoc_(caminho){
  const r = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents/' + caminho, {
    muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + tokenAcesso_() }
  });
  if(r.getResponseCode() !== 200) return null;
  return valor_({ mapValue: { fields: JSON.parse(r.getContentText()).fields || {} } });
}
function valor_(v){
  if('stringValue' in v) return v.stringValue;
  if('integerValue' in v) return Number(v.integerValue);
  if('doubleValue' in v) return v.doubleValue;
  if('booleanValue' in v) return v.booleanValue;
  if('timestampValue' in v) return v.timestampValue;
  if('arrayValue' in v) return (v.arrayValue.values || []).map(valor_);
  if('mapValue' in v){ const o = {}, f = v.mapValue.fields || {}; Object.keys(f).forEach(k => { o[k] = valor_(f[k]); }); return o; }
  return null;
}

// Teste manual no editor: Executar > testarConfiguracao (autoriza e confere a conta de serviço)
function testarConfiguracao(){
  console.log('Token OAuth ok: ' + (tokenAcesso_().length > 20));
}
