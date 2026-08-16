/* 첫 화면 — 게임을 고른다.
 *
 * 계정 표시줄만 있으면 되므로 게임 모듈은 하나도 싣지 않는다.
 * 로그인 상태는 Supabase 세션이 들고 있어서, 어느 게임으로 들어가도 그대로 이어진다. */
import * as Auth from "./auth.js";
import * as Sfx from "./sound.js";

Sfx.listenForGesture();
Auth.init();
