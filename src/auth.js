// src/auth.js — Autenticação e gerenciamento de usuários do dashboard.
// Sem dependências externas: usa apenas o módulo nativo `crypto` do Node.
// Toda mensagem de UI/erro em pt-BR.

import crypto from 'crypto';
import {
  getUsers,
  setUsers,
  getAuthConfig,
  setAuthConfig,
  getAuthSessions,
  setAuthSessions,
} from './store.js';

// ---------------------------------------------------------------------------
// Catálogo de páginas liberáveis por usuário.
// 'configuracoes.html' é SÓ admin e por isso NÃO entra aqui.
// ---------------------------------------------------------------------------
export const PAGES = [
  { file: 'index.html', label: 'Revenue' },
  { file: 'segmentos.html', label: 'Segmentos' },
  { file: 'geografia.html', label: 'Geografia (BR)' },
  { file: 'geografia-us.html', label: 'Geografia (EUA)' },
  { file: 'produtos.html', label: 'Produtos' },
  { file: 'estoque.html', label: 'Estoque' },
  { file: 'campanhas.html', label: 'Campanhas' },
];
export const PAGE_FILES = PAGES.map((p) => p.file);

// Nome do cookie de sessão (HttpOnly).
export const SESSION_COOKIE_NAME = 'coco_session';

// Validade da sessão: 30 dias em milissegundos.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Segurança de senha
// ---------------------------------------------------------------------------

// Gera { salt, hash } a partir de uma senha usando scrypt (KDF resistente a
// força bruta). O salt aleatório evita rainbow tables; hash de 64 bytes em hex.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

// Verifica a senha recalculando o scrypt com o salt salvo e comparando em
// tempo constante (timingSafeEqual) para não vazar informação por timing.
// Buffers de tamanhos diferentes retornam false sem chamar timingSafeEqual
// (que lança exceção quando os tamanhos divergem).
function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(password), salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

// Garante que o login comece LIGADO e que exista um admin semente.
// É crítico que o admin exista sempre que enabled=true, senão trava o acesso.
export function initAuth() {
  if (getAuthConfig() == null) {
    setAuthConfig({ enabled: true }); // login começa ligado por decisão do dono
  }
  const users = getUsers();
  if (!users || users.length === 0) {
    const { salt, hash } = hashPassword('123456');
    const admin = {
      id: genId(),
      username: 'admin',
      name: 'Admin',
      role: 'admin',
      salt,
      hash,
      pages: [...PAGE_FILES],
      createdAt: new Date().toISOString(),
    };
    setUsers([admin]);
    console.log(
      '[auth] Admin semente criado (usuário "admin", senha "123456") — troque a senha em Configurações.'
    );
  }
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

// Lê req.headers.cookie e devolve { nome: valor } com valores decodificados.
export function parseCookies(req) {
  const out = {};
  const header = req && req.headers && req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

// Monta o Set-Cookie da sessão. HttpOnly impede leitura por JS (mitiga XSS);
// SameSite=Lax mitiga CSRF; Secure só sob HTTPS (produção).
export function buildSessionCookie(token, { secure } = {}) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  let c = `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
  if (secure) c += '; Secure';
  return c;
}

// Cookie de limpeza (logout): valor vazio e Max-Age=0.
export function buildClearCookie({ secure } = {}) {
  let c = `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
  if (secure) c += '; Secure';
  return c;
}

// ---------------------------------------------------------------------------
// Usuário público (sem salt/hash)
// ---------------------------------------------------------------------------

// Remove os campos sensíveis. Admin sempre enxerga todas as páginas.
export function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    pages: u.role === 'admin' ? [...PAGE_FILES] : u.pages || [],
  };
}

// ---------------------------------------------------------------------------
// Sessões
// ---------------------------------------------------------------------------

// Remove sessões já expiradas do objeto (mutando-o) e devolve o mesmo objeto.
function pruneSessions(sessions) {
  const now = Date.now();
  for (const [token, s] of Object.entries(sessions)) {
    if (!s || !(s.expiresAt > now)) delete sessions[token];
  }
  return sessions;
}

// Autentica: match de username case-insensitive (com trim) e senha correta.
// Cria uma sessão nova e devolve { token, user: publicUser }; senão null.
export function login(username, password) {
  const uname = String(username || '').trim().toLowerCase();
  if (!uname) return null;
  const user = getUsers().find(
    (u) => String(u.username || '').trim().toLowerCase() === uname
  );
  if (!user) return null;
  if (!verifyPassword(password, user.salt, user.hash)) return null;

  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const sessions = pruneSessions(getAuthSessions() || {}); // poda antes de gravar
  sessions[token] = {
    userId: user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + SESSION_TTL_MS,
  };
  setAuthSessions(sessions);
  return { token, user: publicUser(user) };
}

// Confere usuário+senha SEM criar sessão (usado na troca da própria senha,
// para não acumular tokens órfãos no store a cada verificação).
export function verifyCredentials(username, password) {
  const uname = String(username || '').trim().toLowerCase();
  if (!uname) return false;
  const user = getUsers().find(
    (u) => String(u.username || '').trim().toLowerCase() === uname
  );
  if (!user) return false;
  return verifyPassword(password, user.salt, user.hash);
}

// Encerra a sessão do token informado (se existir) e persiste.
export function logout(token) {
  if (!token) return;
  const sessions = getAuthSessions() || {};
  if (sessions[token]) {
    delete sessions[token];
    setAuthSessions(sessions);
  }
}

// Resolve o usuário ARMAZENADO a partir do token de sessão válido e não
// expirado. Não persiste nada em leitura.
export function userFromToken(token) {
  if (!token) return null;
  const sessions = getAuthSessions() || {};
  const s = sessions[token];
  if (!s) return null;
  if (!(s.expiresAt > Date.now())) return null;
  return getUsers().find((u) => u.id === s.userId) || null;
}

// ---------------------------------------------------------------------------
// Configuração (liga/desliga login)
// ---------------------------------------------------------------------------

export function isEnabled() {
  return Boolean((getAuthConfig() || {}).enabled);
}

export function setEnabled(v) {
  const cfg = getAuthConfig() || {};
  cfg.enabled = Boolean(v);
  setAuthConfig(cfg);
}

// ---------------------------------------------------------------------------
// Controle de acesso a páginas
// ---------------------------------------------------------------------------

export function canAccessPage(user, file) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return (user.pages || []).includes(file);
}

export function isManagedPage(file) {
  return PAGE_FILES.includes(file);
}

// Primeira página que o usuário pode abrir (destino do redirect pós-login).
export function firstAllowedPage(user) {
  if (!user) return null;
  if (user.role === 'admin') return 'index.html';
  const first = (user.pages || []).find((f) => PAGE_FILES.includes(f));
  return first || null;
}

// ---------------------------------------------------------------------------
// CRUD de usuários
// ---------------------------------------------------------------------------

export function listUsers() {
  return getUsers().map(publicUser);
}

// Cria um usuário validando obrigatoriedade/unicidade do username e a senha.
export function createUser({ username, name, password, role, pages }) {
  const uname = String(username || '').trim();
  if (!uname) throw new Error('Nome de usuário obrigatório.');
  if (usernameTaken(uname, null)) throw new Error('Usuário já existe.');
  if (!password) throw new Error('Senha obrigatória.');

  const finalRole = role === 'admin' ? 'admin' : 'padrao';
  const finalPages =
    finalRole === 'admin' ? [...PAGE_FILES] : filterPages(pages);
  const { salt, hash } = hashPassword(password);

  const user = {
    id: genId(),
    username: uname,
    name: String(name || uname),
    role: finalRole,
    salt,
    hash,
    pages: finalPages,
    createdAt: new Date().toISOString(),
  };
  const users = getUsers();
  users.push(user);
  setUsers(users);
  return publicUser(user);
}

// Atualiza um usuário existente. Só redefine senha se patch.password vier
// preenchido. Reajusta pages conforme o role final.
export function updateUser(id, patch = {}) {
  const users = getUsers();
  const user = users.find((u) => u.id === id);
  if (!user) throw new Error('Usuário não encontrado.');

  if (patch.username != null) {
    const uname = String(patch.username).trim();
    if (!uname) throw new Error('Nome de usuário obrigatório.');
    if (uname.toLowerCase() !== String(user.username).toLowerCase() &&
        usernameTaken(uname, user.id)) {
      throw new Error('Usuário já existe.');
    }
    user.username = uname;
  }
  if (patch.name != null) user.name = String(patch.name);
  if (patch.role != null) user.role = patch.role === 'admin' ? 'admin' : 'padrao';

  // pages depende do role final: admin => todas; padrao => filtra o catálogo.
  if (user.role === 'admin') {
    user.pages = [...PAGE_FILES];
  } else if (patch.pages != null) {
    user.pages = filterPages(patch.pages);
  } else {
    user.pages = filterPages(user.pages);
  }

  if (patch.password) {
    const { salt, hash } = hashPassword(patch.password);
    user.salt = salt;
    user.hash = hash;
  }

  setUsers(users);
  return publicUser(user);
}

// Remove um usuário. Protege o último administrador e invalida as sessões dele.
export function deleteUser(id) {
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error('Usuário não encontrado.');

  const target = users[idx];
  if (target.role === 'admin') {
    const admins = users.filter((u) => u.role === 'admin');
    if (admins.length <= 1) {
      throw new Error('Não é possível remover o último administrador.');
    }
  }

  users.splice(idx, 1);
  setUsers(users);

  // Invalida qualquer sessão pendente do usuário removido.
  const sessions = getAuthSessions() || {};
  let changed = false;
  for (const [token, s] of Object.entries(sessions)) {
    if (s && s.userId === id) {
      delete sessions[token];
      changed = true;
    }
  }
  if (changed) setAuthSessions(sessions);
  return true;
}

// Redefine a senha de um usuário (sem exigir a senha atual).
export function changePassword(id, newPassword) {
  if (!newPassword) throw new Error('Senha obrigatória.');
  const users = getUsers();
  const user = users.find((u) => u.id === id);
  if (!user) throw new Error('Usuário não encontrado.');
  const { salt, hash } = hashPassword(newPassword);
  user.salt = salt;
  user.hash = hash;
  setUsers(users);
  return true;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

// Verifica se o username já existe (case-insensitive), ignorando o próprio id.
function usernameTaken(uname, ignoreId) {
  const target = String(uname).trim().toLowerCase();
  return getUsers().some(
    (u) =>
      u.id !== ignoreId &&
      String(u.username || '').trim().toLowerCase() === target
  );
}

// Mantém só páginas que existem no catálogo (evita liberar página inválida).
function filterPages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.filter((f) => PAGE_FILES.includes(f));
}

// Gera um id curto e único o suficiente para usuários.
function genId() {
  return 'u' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}
