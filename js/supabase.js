/* Supabase 연동 계층
 *
 * config.js 가 비어 있으면 client() 는 항상 null 을 돌려주고,
 * 앱은 '혼자 플레이' 모드로만 동작한다. 온라인 코드는 전부 이 파일을 거친다.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, ONLINE, SESSION_KEY, EMAIL_DOMAIN } from "./config.js";
import { Store } from "./ui.js";

export { ONLINE };

/* ── 클라이언트 (최초 필요 시점에만 내려받는다) ── */
let _client = null, _loading = null;

export function client() {
  if (!ONLINE) return Promise.resolve(null);
  if (_client) return Promise.resolve(_client);
  if (!_loading) {
    _loading = import("https://esm.sh/@supabase/supabase-js@2")
      .then(({ createClient }) => {
        _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
          realtime: { params: { eventsPerSecond: 5 } },
        });
        return _client;
      })
      .catch((e) => {
        console.error("[supabase] 라이브러리를 불러오지 못했습니다", e);
        _loading = null;
        return null;
      });
  }
  return _loading;
}

export const toEmail = (username) => `${String(username).toLowerCase()}@${EMAIL_DOMAIN}`;

/* ── 현재 로그인 상태 ── */
export const me = { user: null, profile: null };
export const uid = () => (me.user ? me.user.id : null);
export const myName = () => (me.profile ? me.profile.username : null);

const authListeners = [];
/** 로그인/로그아웃 때마다 호출된다. 등록 즉시 현재 상태로 한 번 불린다. */
export function onAuth(fn) { authListeners.push(fn); fn(me); }
const fireAuth = () => authListeners.forEach((fn) => { try { fn(me); } catch (e) { console.error(e); } });

/** 세션에서 사용자와 프로필을 다시 읽는다. */
export async function refresh() {
  const sb = await client();
  if (!sb) { me.user = null; me.profile = null; fireAuth(); return me; }

  const { data } = await sb.auth.getSession();
  me.user = data?.session?.user || null;

  if (!me.user) { me.profile = null; fireAuth(); return me; }

  const { data: p, error } = await sb
    .from("profiles").select("id, username, session_token").eq("id", me.user.id).single();

  if (error) {
    // 가입 트리거가 프로필을 만들기 전일 수 있다 — 잠깐 뒤 한 번 더
    await new Promise((r) => setTimeout(r, 700));
    const retry = await sb.from("profiles").select("id, username, session_token").eq("id", me.user.id).single();
    me.profile = retry.data || null;
  } else {
    me.profile = p;
  }

  fireAuth();
  if (me.profile) watchSession();
  return me;
}

export async function signOut(quiet) {
  const sb = await client();
  if (sb) await sb.auth.signOut();
  Store.del(SESSION_KEY);
  unwatchSession();
  me.user = null; me.profile = null;
  fireAuth();
  if (!quiet) location.hash = "";
}

/* ══════════════ 동시접속 1곳 제한 ══════════════
   로그인할 때마다 새 토큰을 발급해 DB와 이 기기에 저장하고,
   같은 계정의 다른 탭에 '내가 자리를 가져간다'고 알린다.
   실시간 알림을 놓쳤을 때를 대비해 중요한 동작 직전에 DB 값을 한 번 더 대조한다. */

let sessionChannel = null;
const kickListeners = [];
/** 다른 기기에 밀려났을 때 호출된다. */
export function onKicked(fn) { kickListeners.push(fn); }

/** 로그인 직후 이 기기를 '현재 자리'로 등록한다. */
export async function claimSession() {
  const sb = await client();
  if (!sb || !uid()) return;
  const token = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2) + Date.now();
  Store.set(SESSION_KEY, token);
  await sb.from("profiles").update({ session_token: token }).eq("id", uid());
  await watchSession();
  if (sessionChannel) {
    sessionChannel.send({ type: "broadcast", event: "claim", payload: { token } });
  }
}

async function watchSession() {
  const sb = await client();
  if (!sb || !uid() || sessionChannel) return;
  sessionChannel = sb.channel(`user:${uid()}`, { config: { broadcast: { self: false } } });
  sessionChannel.on("broadcast", { event: "claim" }, ({ payload }) => {
    if (payload && payload.token !== Store.get(SESSION_KEY)) kicked();
  });
  await sessionChannel.subscribe();
}

function unwatchSession() {
  if (sessionChannel) { sessionChannel.unsubscribe(); sessionChannel = null; }
}

function kicked() {
  kickListeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  signOut(true);
}

/** 중요한 쓰기 직전에 이 기기가 아직 유효한 자리인지 확인한다. */
export async function sessionValid() {
  const sb = await client();
  if (!sb || !uid()) return false;
  const { data } = await sb.from("profiles").select("session_token").eq("id", uid()).single();
  if (!data) return false;
  if (data.session_token && data.session_token !== Store.get(SESSION_KEY)) { kicked(); return false; }
  return true;
}

/* ── 오류 메시지 다듬기 ── */
export function readableError(e) {
  const m = (e && (e.message || e.error_description)) || String(e || "");
  if (/Invalid login credentials/i.test(m)) return "아이디 또는 비밀번호가 맞지 않습니다.";
  if (/User already registered|duplicate key.*users/i.test(m)) return "이미 있는 아이디입니다.";
  if (/profiles_username_key|duplicate key/i.test(m)) return "이미 있는 아이디입니다.";
  if (/username_format/i.test(m)) return "아이디는 3~16자의 영문 소문자·숫자·밑줄만 쓸 수 있습니다.";
  if (/Password should be at least/i.test(m)) return "비밀번호는 8자 이상이어야 합니다.";
  if (/Email .*invalid|Unable to validate email/i.test(m)) return "아이디를 처리하지 못했습니다. 다른 아이디를 써 보세요.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
  if (/rate limit|too many/i.test(m)) return "요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.";
  return m || "알 수 없는 오류가 생겼습니다.";
}
