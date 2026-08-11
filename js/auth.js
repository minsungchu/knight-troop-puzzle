/* 로그인 · 가입 · 계정 메뉴 */
import { $, esc, veil, hideVeil, toast } from "./ui.js";
import { ONLINE, RESERVED_IDS } from "./config.js";
import { client, me, myName, onAuth, refresh, signOut, claimSession, toEmail, readableError, onKicked } from "./supabase.js";

/* ══════════════ 입력 검증 ══════════════ */

export function checkId(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "아이디를 입력해 주세요.";
  if (s.length < 3 || s.length > 16) return "아이디는 3~16자여야 합니다.";
  if (!/^[a-z0-9_]+$/.test(s)) return "아이디에는 영문 소문자·숫자·밑줄(_)만 쓸 수 있습니다.";
  if (!/[a-z]/.test(s)) return "아이디에 영문자를 하나 이상 넣어 주세요.";
  if (RESERVED_IDS.includes(s)) return "쓸 수 없는 아이디입니다.";
  return null;
}

export function checkPw(v, id) {
  const s = String(v || "");
  if (!s) return "비밀번호를 입력해 주세요.";
  if (s.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  if (s.length > 64) return "비밀번호는 64자를 넘을 수 없습니다.";
  if (!/[A-Za-z]/.test(s)) return "비밀번호에 영문자를 넣어 주세요.";
  if (!/[0-9]/.test(s)) return "비밀번호에 숫자를 넣어 주세요.";
  if (/\s/.test(s)) return "비밀번호에 공백은 쓸 수 없습니다.";
  if (id && s.toLowerCase() === String(id).toLowerCase()) return "아이디와 다른 비밀번호를 쓰세요.";
  return null;
}

/* ══════════════ 계정 표시줄 ══════════════ */

export function init() {
  onAuth(render);
  onKicked(() => {
    veil(`<h2>다른 기기에서 로그인했습니다</h2>
      <p>한 계정은 한 곳에서만 접속할 수 있습니다.<br>이 화면은 로그아웃되었습니다.</p>
      <div class="card-actions"><button class="btn primary" id="okBtn">확인</button></div>`);
    $("#okBtn").onclick = () => { hideVeil(); openLogin(); };
  });
  if (ONLINE) refresh();
}

function render() {
  const box = $("#account");
  if (!box) return;

  if (!ONLINE) {
    box.innerHTML = `<button class="btn" id="offlineBtn">오프라인</button>`;
    $("#offlineBtn").onclick = showSetupGuide;
    return;
  }

  if (myName()) {
    box.innerHTML = `<span class="who">${esc(myName())}</span>
      <button class="btn" id="acctBtn">계정</button>`;
    $("#acctBtn").onclick = openAccount;
  } else {
    box.innerHTML = `<button class="btn" id="loginBtn">로그인</button>`;
    $("#loginBtn").onclick = openLogin;
  }
}

function showSetupGuide() {
  veil(`<h2>온라인 기능이 꺼져 있습니다</h2>
    <p>혼자 플레이는 그대로 되지만, 로그인·랭킹·대전을 쓰려면 설정이 필요합니다.</p>
    <div class="form-note">
      <b>js/config.js</b> 를 열어 Supabase 프로젝트의 <b>URL</b>과 <b>anon 키</b>를 채운 뒤 다시 배포하세요.
      절차는 저장소의 <b>README.md</b> 에 있습니다.
    </div>
    <div class="card-actions"><button class="btn primary" id="okBtn">알겠습니다</button></div>`, { wide: true });
  $("#okBtn").onclick = hideVeil;
}

/* ══════════════ 로그인 / 가입 ══════════════ */

export function openLogin() { openForm("login"); }
export function openSignup() { openForm("signup"); }

/** 로그인이 필요할 때 이유를 알려 주며 창을 연다. */
export function requireLogin(reason) {
  if (!ONLINE) { showSetupGuide(); return false; }
  if (myName()) return true;
  openForm("login", reason);
  return false;
}

function openForm(mode, reason) {
  const signup = mode === "signup";
  const card = veil(`
    <h2>${signup ? "계정 만들기" : "로그인"}</h2>
    ${reason ? `<p>${esc(reason)}</p>` : `<p>아이디와 비밀번호만 있으면 됩니다. 이메일은 받지 않습니다.</p>`}
    <form class="form" id="authForm" autocomplete="on" novalidate>
      <div class="field">
        <label for="fId">아이디</label>
        <input type="text" id="fId" name="username" autocomplete="username"
               placeholder="영문 소문자·숫자·밑줄, 3~16자" maxlength="16" spellcheck="false">
      </div>
      <div class="field">
        <label for="fPw">비밀번호</label>
        <input type="password" id="fPw" name="password"
               autocomplete="${signup ? "new-password" : "current-password"}"
               placeholder="${signup ? "8자 이상, 영문과 숫자 포함" : "비밀번호"}" maxlength="64">
      </div>
      ${signup ? `
      <div class="field">
        <label for="fPw2">비밀번호 확인</label>
        <input type="password" id="fPw2" name="password2" autocomplete="new-password" placeholder="한 번 더" maxlength="64">
      </div>
      <div class="form-note">
        이메일을 받지 않으므로 <b>비밀번호를 잊으면 복구할 수 없습니다.</b>
        잊었을 때는 새 계정을 만들어야 하고, 이전 기록은 되찾을 수 없습니다.
      </div>` : ""}
      <p class="err" id="fErr" role="alert"></p>
      <div class="card-actions">
        <button class="btn primary" type="submit" id="fGo">${signup ? "가입하고 시작" : "로그인"}</button>
        <button class="btn" type="button" id="fCancel">닫기</button>
      </div>
    </form>
    <div class="switch-line">
      ${signup ? "이미 계정이 있나요?" : "계정이 없나요?"}
      <button class="link" id="fSwap">${signup ? "로그인" : "계정 만들기"}</button>
    </div>`, { wide: true });

  const err = (m) => { $("#fErr").textContent = m || ""; };
  $("#fCancel").onclick = hideVeil;
  $("#fSwap").onclick = () => openForm(signup ? "login" : "signup");

  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#fId").value.trim().toLowerCase();
    const pw = $("#fPw").value;

    let bad = checkId(id) || checkPw(pw, signup ? id : null);
    if (signup && !bad && pw !== $("#fPw2").value) bad = "비밀번호가 서로 다릅니다.";
    if (bad) { err(bad); return; }

    const go = $("#fGo");
    go.disabled = true;
    go.textContent = signup ? "만드는 중…" : "확인 중…";
    err("");

    try {
      const sb = await client();
      if (!sb) throw new Error("서버에 연결하지 못했습니다.");

      if (signup) {
        const { error } = await sb.auth.signUp({
          email: toEmail(id), password: pw,
          options: { data: { username: id } },
        });
        if (error) throw error;
        // 이메일 확인이 꺼져 있으면 곧바로 세션이 생긴다. 아니면 한 번 더 로그인.
        const { data } = await sb.auth.getSession();
        if (!data?.session) {
          const r = await sb.auth.signInWithPassword({ email: toEmail(id), password: pw });
          if (r.error) throw new Error("가입은 됐지만 자동 로그인에 실패했습니다. 직접 로그인해 주세요.");
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: toEmail(id), password: pw });
        if (error) throw error;
      }

      await refresh();
      await claimSession();
      hideVeil();
      toast(signup ? `${id} 계정을 만들었습니다.` : `${id} 님, 어서 오세요.`);
    } catch (e2) {
      err(readableError(e2));
      go.disabled = false;
      go.textContent = signup ? "가입하고 시작" : "로그인";
    }
  });
}

/* ══════════════ 계정 메뉴 ══════════════ */

function openAccount() {
  veil(`<h2>${esc(myName())}</h2>
    <p>기록은 계정에 남습니다. 한 계정은 한 곳에서만 접속할 수 있습니다.</p>
    <div class="card-actions">
      <button class="btn" id="myRecBtn">내 기록</button>
      <button class="btn" id="outBtn">로그아웃</button>
      <button class="btn" id="closeBtn">닫기</button>
    </div>`);
  $("#closeBtn").onclick = hideVeil;
  $("#myRecBtn").onclick = async () => {
    hideVeil();
    const { openMyRecords } = await import("./rank.js");
    openMyRecords();
  };
  $("#outBtn").onclick = async () => {
    await signOut(true);
    hideVeil();
    toast("로그아웃했습니다.");
  };
}
