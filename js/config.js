/* 설정
 *
 * 온라인 기능(로그인 · 랭킹 · 대전)을 켜려면 아래 두 값을 채우세요.
 * Supabase 대시보드 → Project Settings → API 에서 가져옵니다.
 *
 *   SUPABASE_URL      : https://xxxxxxxx.supabase.co
 *   SUPABASE_ANON_KEY : anon / public 키
 *
 * anon 키는 공개용이라 저장소에 커밋해도 됩니다. 실제 권한은 DB의 RLS 정책이 정합니다.
 * service_role 키는 절대 여기에 넣지 마세요.
 *
 * 비워 두면 앱은 '혼자 플레이' 모드로만 동작합니다.
 */
export const SUPABASE_URL = "https://bguxryrmwpkcnsayluhm.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJndXhyeXJtd3BrY25zYXlsdWhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTEyNDAsImV4cCI6MjEwMjAyNzI0MH0.gbsydorybuPf7PFY-qmG0j1npb4hCtRma76tbOgbV9k";

/** 온라인 기능 사용 가능 여부 */
export const ONLINE = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

/** 한 판에 쓸 수 있는 힌트 횟수 */
export const HINT_MAX = 5;

/** 랭킹 보드가 있는 규격 (정사각만) */
export const PRESET_SIZES = [6, 8, 10, 12];

/** 난이도 이름 */
export const LEVELS = { 1: "쉬움", 2: "보통", 3: "어려움" };

/** 부대 이름 */
export const TROOPS = [null, { n: "창병" }, { n: "궁병" }, { n: "기병" }, { n: "방패병" }];

/** 아이디 → Supabase Auth 내부 이메일. 사용자에게 노출되지 않습니다. */
export const EMAIL_DOMAIN = "users.knight-puzzle.app";

/** 가입을 막을 아이디 */
export const RESERVED_IDS = ["admin", "administrator", "root", "guest", "system", "null", "undefined", "knight"];

/** 대전 방 정원 상한 */
export const ROOM_MAX_PLAYERS = 4;

/** 진행률 브로드캐스트 최소 간격(ms) */
export const PROGRESS_INTERVAL = 900;

/** 로컬 저장 키 */
export const STORE_KEY = "knight-troop-puzzle:v2";
export const SESSION_KEY = "knight-troop-puzzle:session";
