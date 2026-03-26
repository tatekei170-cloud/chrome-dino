(function () {
  "use strict";

  /**
   * 画像は Image/ フォルダ（現在のファイル構成）を参照します。
   * 地面: Image/stage 01.png → stage 02.png のみ SPRITE に登録（存在しないパスは置かないと file:// で 404 が増える）
   * 走り: Player 01–02、衝突: Player 03、サボテン: sabo 01（3種は同画像を伸縮）、雲: kumo
   * タイトル: Start + Space 案内 → Space でキャンバスへ。本家同様「小ジャンプが終わってから」走行開始
   * ゲームオーバー・案内は Image/ の PNG（スコア表示のみキャンバス描画）
   * しゃがみ: Player 04、翼竜は図形描画のまま
   *
   * 速度は下記の定数のみで決まる（本家との一致は狙わない。遅さはここを変える）。
   */

  function assetURL(rel) {
    return rel.split("/").map(encodeURIComponent).join("/");
  }

  var SPRITE_PATHS = {
    rexRun0: "Image/Player 01.png",
    rexRun1: "Image/Player 02.png",
    rexCrash: "Image/Player 03.png",
    rexDuck0: "Image/Player 04.png",
    rexDuck1: "Image/Player 05.png",
    rexWait: "Image/Player 06.png",
    cactusSmall: "Image/sabo 01.png",
    cactusTall: "Image/sabo 01.png",
    cactusWide: "Image/sabo 01.png",
    cloud: "Image/kumo.png",
    enemy01: "Image/Enemy 01.png",
    enemy02: "Image/Enemy 02.png",
    gameOver: "Image/Gameover.png",
    restartChrome: "Image/Over chorme.png",
    restartRetry: "Image/Over retry.png",
    /* 地面タイル（実在ファイルだけ。増やすときだけキーと STAGE_SLOT_CANDIDATES に追加） */
    stageSeg0: "Image/stage 01.png",
    stageSeg1: "Image/stage 02.png",
  };

  var spriteImg = {};

  function bootSprites() {
    Object.keys(SPRITE_PATHS).forEach(function (key) {
      var im = new Image();
      spriteImg[key] = im;
      im.src = assetURL(SPRITE_PATHS[key]);
    });
  }

  /** 効果音（Web Audio）。ファイル不要。false で無音 */
  var SE_ENABLED = true;
  var audioCtx = null;
  /** 最後に鳴らした「100 点区切り」の段（本家の milestone SE 相当） */
  var lastScoreHundredMark = 0;
  function resumeAudioIfNeeded() {
    if (!SE_ENABLED) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }
    } catch (e) {}
  }

  function seBeep(freq, durSec, vol, waveType) {
    if (!SE_ENABLED) return;
    try {
      resumeAudioIfNeeded();
      if (!audioCtx) return;
      var t0 = audioCtx.currentTime;
      var osc = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      osc.type = waveType || "square";
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.1, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + durSec + 0.04);
    } catch (e) {}
  }

  function playJumpSe() {
    seBeep(320, 0.07, 0.11, "square");
  }

  function playCrashSe() {
    seBeep(140, 0.14, 0.13, "sawtooth");
    seBeep(70, 0.18, 0.12, "square");
  }

  function playMilestoneSe() {
    seBeep(523.25, 0.05, 0.09, "square");
    window.setTimeout(function () {
      seBeep(783.99, 0.07, 0.07, "square");
    }, 45);
  }

  function imgOk(key) {
    var im = spriteImg[key];
    return im && im.complete && im.naturalWidth > 0;
  }

  // PNG の透明余白（縦）を調べて、描画Yを補正するためのキャッシュ
  // 目的: ground 線と「見えている足元」のズレ（浮き）をなくす
  var spriteVTrimCache = {};

  function computeSpriteVerticalTrim(key) {
    if (key in spriteVTrimCache) return spriteVTrimCache[key];
    if (!imgOk(key)) return null;

    try {
      var im = spriteImg[key];
      var w = im.naturalWidth;
      var h = im.naturalHeight;
      var off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      var offCtx = off.getContext("2d");
      if (!offCtx) {
        spriteVTrimCache[key] = null;
        return null;
      }
      offCtx.clearRect(0, 0, w, h);
      offCtx.drawImage(im, 0, 0);
      var data = offCtx.getImageData(0, 0, w, h).data;

      var top = -1;
      var bottom = -1;
      var alphaThr = 5; // アンチエイリアスの薄い透明を除外

      for (var y = 0; y < h; y++) {
        var rowHas = false;
        for (var x = 0; x < w; x++) {
          var a = data[(y * w + x) * 4 + 3];
          if (a > alphaThr) {
            rowHas = true;
            break;
          }
        }
        if (rowHas) {
          top = y;
          break;
        }
      }

      if (top === -1) {
        // 全透明の画像は補正なしで扱う
        top = 0;
        bottom = h - 1;
      } else {
        for (y = h - 1; y >= 0; y--) {
          rowHas = false;
          for (x = 0; x < w; x++) {
            var a2 = data[(y * w + x) * 4 + 3];
            if (a2 > alphaThr) {
              rowHas = true;
              break;
            }
          }
          if (rowHas) {
            bottom = y;
            break;
          }
        }
      }

      var bottomTrim = h - 1 - bottom;
      var topTrim = top;
      var visibleHeight = bottom - top + 1;

      var out = {
        topTrim: topTrim,
        bottomTrim: bottomTrim,
        visibleHeight: visibleHeight,
      };
      spriteVTrimCache[key] = out;
      return out;
    } catch (e) {
      // getImageData 周りで例外が出ると描画が止まるので、補正は諦めて null にする
      spriteVTrimCache[key] = null;
      return null;
    }
  }

  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var stageEl = document.querySelector(".stage");
  var spaceHintEl = document.getElementById("space-hint");

  var gameOverShownAt = 0;
  /** 先に Chrome マーク、一度だけリトライ矢印へ（渡された PNG を切り替え） */
  var GO_CHROME_ICON_MS = 800;

  function wireSpaceHintImg() {
    if (spaceHintEl) {
      spaceHintEl.src = assetURL("Image/Space 押せ.png");
    }
  }

  function wireStartImg() {
    var el = document.getElementById("start-screen");
    if (el) {
      el.src = assetURL("Image/Start.png");
    }
  }

  function syncStageLayers() {
    if (!stageEl) return;
    var titleActive =
      showTitleScreen && !state.playing && !state.crashed;
    stageEl.classList.toggle("stage--title", titleActive);
    stageEl.classList.toggle("stage--game", !titleActive);
    stageEl.classList.toggle("stage--night", night && !titleActive);
  }

  function drawGameOverUI() {
    if (!state.crashed) return;

    var elapsed =
      gameOverShownAt > 0 ? performance.now() - gameOverShownAt : 0;
    var top = 2;
    var btnY;

    if (imgOk("gameOver")) {
      var gim = spriteImg.gameOver;
      var maxTitleH = 38;
      var gh = Math.min(maxTitleH, gim.naturalHeight);
      var gw = (gim.naturalWidth * gh) / gim.naturalHeight;
      if (gw > W - 20) {
        gw = W - 20;
        gh = (gim.naturalHeight * gw) / gim.naturalWidth;
      }
      ctx.drawImage(gim, (W - gw) / 2, top, gw, gh);
      btnY = top + gh + 6;
    } else {
      btnY = top + 4;
    }

    var wantChrome = elapsed < GO_CHROME_ICON_MS;
    var btnKey = wantChrome ? "restartChrome" : "restartRetry";
    if (!imgOk(btnKey)) {
      btnKey = wantChrome ? "restartRetry" : "restartChrome";
    }
    if (!imgOk(btnKey)) return;

    var bim = spriteImg[btnKey];
    var btnH = 40;
    var btnW = (bim.naturalWidth * btnH) / bim.naturalHeight;
    if (btnW > W - 20) {
      btnW = W - 20;
      btnH = (bim.naturalHeight * btnW) / bim.naturalWidth;
    }
    if (btnY + btnH > H - 4) {
      btnY = Math.max(8, H - btnH - 4);
    }
    ctx.drawImage(bim, (W - btnW) / 2, btnY, btnW, btnH);
  }

  var W = 800;
  /* ジャンプ頂点でスプライトが上端からはみ出さないよう空域を確保（約 +110px） */
  var H = 250;
  // 表示上の「足元」と当たりが一致していた基準（以前の H=150 では GROUND_Y=80）を H にスケールして共有する
  var GROUND_Y = Math.round(80 * (H / 150));
  var HORIZON_Y = Math.round(127 * (H / 150));
  var HORIZON_HEIGHT = Math.round(12 * (H / 150));
  var GRAVITY = 0.6;
  /** 本家 Trex.config 相当 */
  var INITIAL_JUMP_VELOCITY = -10;
  var MIN_JUMP_HEIGHT = 30;
  var DROP_VELOCITY = -5;
  var SPEED_DROP_COEFFICIENT = 3;
  /** イントロのホップ（本走ジャンプより弱く） */
  var INTRO_JUMP_V = -8.5;
  /**
   * 走行速度・加速など「1 秒間に 60 ステップあったときの 1 ステップ分」の量。
   * 実際のループでは tickPhysics(step) の step = 経過ms / (1000/60) を掛け、Hz に依存しにくくする。
   */
  /*
   * 本家 Runner.config は WIDTH=600 前提で SPEED=6, MAX_SPEED=13。
   * この実装は W=800 を 600px 前後に縮小表示しているため、見た目速度一致用に W/600 で補正する。
   */
  var SPEED_MATCH_SCALE = W / 600;
  var BASE_SPEED = 6 * SPEED_MATCH_SCALE;
  var MAX_SPEED = 13 * SPEED_MATCH_SCALE;
  /** 衝突していないプレイ中ループごとに speed に加算 */
  var ACCELERATION = 0.001 * SPEED_MATCH_SCALE;
  // 本家 Obstacle gap 系（再現用の固定係数）
  var GAP_COEFFICIENT = 0.6; // Runner.config.GAP_COEFFICIENT
  var MAX_GAP_COEFFICIENT = 1.5; // Obstacle.MAX_GAP_COEFFICIENT
  // 本家の minGap は WIDTH=600 前提の px。W=800 の論理座標では比率でスケールする。
  var CACTUS_MIN_GAP = 120 * SPEED_MATCH_SCALE; // Obstacle.types[*].minGap
  var PTERA_MIN_GAP = 150 * SPEED_MATCH_SCALE;
  /**
   * サボは本家の 17×35 / 25×50 に近い縦横比で、横幅を抑えてよけやすくする。
   */
  var CACTUS_SMALL_W = 22;
  var CACTUS_SMALL_H = 42;
  var CACTUS_TALL_W = 28;
  var CACTUS_TALL_H = 50;
  /** 地面ステージ画像の横スクロール量（state.distance に対する係数） */
  var STAGE_IMAGE_PARALLAX = 0.5;
  /** ステージ帯の表示高さ（GROUND_Y から上）。大きすぎるときは下げる */
  var STAGE_STRIP_MAX_H = 48;
  /** 各スロットで最初に読めた 1 キーだけ使う（現状 2 枚のみ） */
  var STAGE_SLOT_CANDIDATES = [["stageSeg0"], ["stageSeg1"]];
  /** 複数本サボの幹の隙間 */
  var CACTUS_CLUSTER_GAP = Math.max(2, Math.round(3 * SPEED_MATCH_SCALE));
  // 本家: 初期 SPEED=6、プテラは minSpeed 8.5。論理速度も同じ比率にする（最初から鳥は出ない）
  var PTERA_MIN_SPEED = BASE_SPEED * (8.5 / 6);
  // 本家 Runner.config.MAX_OBSTACLE_DUPLICATION = 2（同じタイプの連続を抑える）
  var MAX_OBSTACLE_DUPLICATION = 2;
  /** 雲の横移動 = state.speed × この値（障害物より遅く見せる） */
  var CLOUD_PARALLAX = 0.04;
  /** プレイ以外（タイトル待ち・ゲームオーバー待ち）の雲の漂流 px/ループ */
  var CLOUD_IDLE_PX = 0.12;
  /** スコア増分に掛ける係数（speed に比例） */
  var SCORE_RATE = 0.08;
  /** 画面に入ってからの経過 ms をこの間隔でコマ送り（本家は体感 0.3 秒おきに羽ばたき） */
  var PTERA_FLAP_MS = 300;
  // 本家 Runner.config.CLEAR_TIME（最初の数秒は障害物を出さない）
  var CLEAR_TIME_MS = 3000;

  // デバッグ: プテラが Enemy01/Enemy02 で切り替わった瞬間だけ console.log
  var DEBUG_PTERA_TOGGLE = false;
  /** true: キャンバス左上に障害物配列の番号・種類・プテラの表示画像キーを出す（Console 不要） */
  var DEBUG_OBSTACLE_OVERLAY = false;
  /**
   * プレイヤー走り・しゃがみ腿のコマ送り。tick の step に掛けて rexAnimT に蓄積（障害物の移動とは別）。
   * 本家（Chromium offline.js の Trex.animFrames.RUNNING: msPerFrame = 1000/12）に合わせるなら 1。
   * 走りは 2 コマで 1 コマあたり約 83.3ms。当ゲームは floor(rexAnimT)%10 で半周期 5 単位 ≒ 本家の半周期と一致するよう調整済み。
   */
  var REX_ANIM_RATE = 1;
  var HI_KEY = "dino-hiscore-demo";

  var night = false;
  var nightToggleAt = 700;
  var nextNightScore = nightToggleAt;

  function loadHi() {
    var v = parseInt(localStorage.getItem(HI_KEY) || "0", 10);
    return isNaN(v) ? 0 : v;
  }

  function saveHi(n) {
    localStorage.setItem(HI_KEY, String(n));
  }

  var hiScore = loadHi();

  function pad5(n) {
    var s = String(Math.floor(n));
    while (s.length < 5) s = "0" + s;
    return s;
  }

  function randBetween(min, max) {
    // float で返す（gap の丸めで等間隔に見えるのを防ぐ）
    if (max <= min) return min;
    return min + Math.random() * (max - min);
  }

  var state = {
    playing: false,
    crashed: false,
    speed: BASE_SPEED,
    distance: 0,
    score: 0,
    flashTimer: 0,
    runningMs: 0,
    /** 100 点刻み点滅用フレームカウンタ（render で減算） */
    scoreBlinkFrames: 0,
  };

  var showTitleScreen = true;
  /** Space 直後〜着地まで。道・障害物は動かさない */
  var introHop = false;
  var introLeftGround = false;
  /** 恐竜の走り／腿アニメ用（障害物スクロールと独立） */
  var rexAnimT = 0;

  var rex = {
    // 本家（Chromium Trex.config.START_X_POS = 50 / canvas width 600）に合わせて比率補正
    // 本実装は W=800 なので 50*(800/600)=66.66... → 67
    x: 67,
    y: GROUND_Y,
    vy: 0,
    w: 44,
    hRun: 47,
    hDuck: 25,
    duck: false,
    onGround: true,
    jumping: false,
    reachedMinHeight: false,
    speedDrop: false,
    anim: 0,
  };

  function rexCurrentImage() {
    if (state.crashed) {
      if (imgOk("rexCrash")) return spriteImg.rexCrash;
      if (imgOk("rexRun0")) return spriteImg.rexRun0;
    }
    if (rex.duck && rex.onGround) {
      if (imgOk("rexDuck0") && imgOk("rexDuck1")) {
        // しゃがみは 2 枚で交互（rexAnimT の進みでコマ送り）
        return Math.floor(rexAnimT) % 8 < 4
          ? spriteImg.rexDuck0
          : spriteImg.rexDuck1;
      }
      if (imgOk("rexDuck0")) return spriteImg.rexDuck0;
      return null;
    }
    if (imgOk("rexRun0") && imgOk("rexRun1")) {
      // WAITING: 本家の「待機」っぽい見た目（Player 05）
      if (!state.playing && !state.crashed && !introHop) {
        if (imgOk("rexWait")) return spriteImg.rexWait;
        return spriteImg.rexRun0;
      }
      return Math.floor(rexAnimT) % 10 < 5
        ? spriteImg.rexRun0
        : spriteImg.rexRun1;
    }
    if (imgOk("rexRun0")) return spriteImg.rexRun0;
    return null;
  }

  function rexHitbox() {
    var im = rexCurrentImage();
    var h = rex.duck && rex.onGround ? rex.hDuck : rex.hRun;
    var w = rex.w;
    var x0;
    var y0;
    var w0;
    var h0;
    if (im) {
      var dw = im.naturalWidth;
      var dh = im.naturalHeight;
      var keyForTrim = null;
      if (im === spriteImg.rexCrash) keyForTrim = "rexCrash";
      else if (im === spriteImg.rexDuck0) keyForTrim = "rexDuck0";
      else if (im === spriteImg.rexRun0) keyForTrim = "rexRun0";
      else if (im === spriteImg.rexRun1) keyForTrim = "rexRun1";
      else if (im === spriteImg.rexWait) keyForTrim = "rexWait";

      var vtrim = keyForTrim ? computeSpriteVerticalTrim(keyForTrim) : null;
      /* PNG 全体を矩形にすると透明余白で「離れてるのに当たる」。足元は描画と一致させ、周りを削る */
      var insetL = Math.floor(dw * 0.12);
      var insetR = Math.floor(dw * 0.34);
      var insetT = vtrim ? vtrim.topTrim : Math.floor(dh * 0.08);
      var insetB = vtrim ? vtrim.bottomTrim : 0;
      if (rex.duck && rex.onGround) {
        insetR = Math.floor(dw * 0.26);
        insetT = vtrim ? vtrim.topTrim : Math.floor(dh * 0.06);
      }
      // drawRex() と同じ前提: 画像は bottomTrim だけ下にずらして描画する
      // よって imageTop = rex.y - dh + insetB
      w0 = Math.max(12, dw - insetL - insetR);
      h0 = Math.max(12, dh - insetT - insetB);
      x0 = rex.x + insetL;
      y0 = rex.y - dh + insetB + insetT;
    } else {
      w0 = w;
      h0 = h;
      x0 = rex.x;
      y0 = rex.y - h;
    }
    var pad = 2;
    return {
      x: x0 + pad,
      y: y0 + pad,
      w: w0 - pad * 2,
      h: h0 - pad * 2,
    };
  }

  var obstacles = [];
  var obstacleHistory = [];

  function randomCactusStemVariant() {
    return Math.random() < 0.52 ? "small" : "tall";
  }

  function cactusStemDims(variant, jitter) {
    var j = jitter == null ? 1 : jitter;
    if (variant === "tall") {
      return {
        w: Math.max(10, Math.round(CACTUS_TALL_W * j)),
        h: Math.max(16, Math.round(CACTUS_TALL_H * j)),
      };
    }
    return {
      w: Math.max(8, Math.round(CACTUS_SMALL_W * j)),
      h: Math.max(12, Math.round(CACTUS_SMALL_H * j)),
    };
  }

  /**
   * 本家風: 1〜3 本・幹ごとに small/tall と微妙なスケール差
   */
  function buildCactusClusterObstacle() {
    var countRoll = Math.random();
    var count = countRoll < 0.48 ? 1 : countRoll < 0.86 ? 2 : 3;
    var stems = [];
    var xOff = 0;
    var maxH = 0;
    var si;
    for (si = 0; si < count; si++) {
      var vr = randomCactusStemVariant();
      var jit = 0.94 + Math.random() * 0.12;
      var d = cactusStemDims(vr, jit);
      stems.push({ variant: vr, w: d.w, h: d.h, xOff: xOff });
      maxH = Math.max(maxH, d.h);
      if (si < count - 1) {
        xOff += d.w + CACTUS_CLUSTER_GAP;
      } else {
        xOff += d.w;
      }
    }
    return {
      type: "cactus",
      stems: stems,
      variant: stems[0] ? stems[0].variant : "small",
      x: W - xOff,
      y: GROUND_Y,
      w: xOff,
      h: maxH,
      followingCreated: false,
    };
  }

  function cactusStemHitRect(sx, groundY, w, h, variant) {
    var cKey = cactusSpriteKey(variant || "small");
    var vtrim = computeSpriteVerticalTrim(cKey);
    if (vtrim && imgOk(cKey)) {
      var imc = spriteImg[cKey];
      var scale = h / imc.naturalHeight;
      var topTrimScaled = vtrim.topTrim * scale;
      var bottomTrimScaled = vtrim.bottomTrim * scale;
      var visibleH = Math.max(1, h - topTrimScaled - bottomTrimScaled);
      return {
        x: sx + 2,
        y: groundY - h + bottomTrimScaled + 2,
        w: w - 4,
        h: visibleH - 4,
      };
    }
    return {
      x: sx + 2,
      y: groundY - h + 2,
      w: w - 4,
      h: h - 4,
    };
  }

  function spawnObstacle() {
    var allowPtera = state.speed >= PTERA_MIN_SPEED;

    // 連続同一タイプは本家どおり抑える。選び方は「候補配列から一様抽選」（旧 if 連鎖だとプテラ不可時にサボ率が異常に偏る）
    function duplicationWouldExceed(nextType) {
      var dup = 0;
      for (var i = 0; i < obstacleHistory.length; i++) {
        dup = obstacleHistory[i] === nextType ? dup + 1 : 0;
      }
      return dup >= MAX_OBSTACLE_DUPLICATION;
    }

    var choices = [];
    if (allowPtera && !duplicationWouldExceed("ptera")) {
      choices.push({ type: "ptera", w: 46, h: 20 });
      choices.push({ type: "ptera", w: 46, h: 20 });
    }
    if (!duplicationWouldExceed("cactus")) {
      choices.push({ type: "cactus" });
      choices.push({ type: "cactus" });
    }

    var chosen;
    if (choices.length === 0) {
      chosen = { type: "cactus" };
    } else {
      chosen = choices[Math.floor(Math.random() * choices.length)];
    }

    var obstacle = null;
    if (chosen.type === "ptera") {
      // これまでの表現のまま（鳥の高さ2段）
      var alt = Math.random() < 0.09 ? 35 : 55;
      obstacle = {
        type: "ptera",
        // 右端の外から入る（x=W はまだ非表示）。羽ばたきは pteraAnimStartMs + state.runningMs で進行。
        x: W,
        y: GROUND_Y - alt,
        w: 46,
        h: 20,
        // 昔のプロパティ互換も残す（リロード漏れ時に備えて）
        frame: 0,
        wingFrame: 0,
        // 障害物生成時の state.runningMs。羽ばたきは「本家同様」経過ゲーム時間で進める（x<W 依存にしない）
        pteraAnimStartMs: state.runningMs,
        // 体ごとの羽ばたき位相（0→enemy01 から、PTERA_FLAP_MS ごとに交互）
        wingFlipParity: Math.random() < 0.5 ? 0 : 1,
        // 切り替えログ用
        _lastEnemyPK: null,
        followingCreated: false,
      };
    } else {
      obstacle = buildCactusClusterObstacle();
    }
    // gap = width*speed + minGap*GAP_COEFFICIENT（本家の式）
    // 本家では gap は「前の障害物の右端から次の障害物の左端まで」の距離。
    var minGap =
      obstacle.w * state.speed +
      (obstacle.type === "ptera" ? PTERA_MIN_GAP : CACTUS_MIN_GAP) *
        GAP_COEFFICIENT;
    var maxGap = minGap * MAX_GAP_COEFFICIENT;
    obstacle.gap = randBetween(minGap, maxGap);
    obstacleHistory.unshift(obstacle.type);
    if (obstacleHistory.length > 2) obstacleHistory.length = 2;
    return obstacle;
  }
  var clouds = [
    { x: Math.round(W * 0.1), y: 12, w: 46 },
    { x: Math.round(W * 0.52), y: 22, w: 46 },
    { x: Math.round(W * 0.78), y: 16, w: 46 },
  ];

  function rectsOverlap(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  function collectLoadedStageKeys() {
    var out = [];
    var si;
    for (si = 0; si < STAGE_SLOT_CANDIDATES.length; si++) {
      var slot = STAGE_SLOT_CANDIDATES[si];
      var j;
      for (j = 0; j < slot.length; j++) {
        if (imgOk(slot[j])) {
          out.push(slot[j]);
          break;
        }
      }
    }
    return out;
  }

  /**
   * stage 01 / 02 を順に横につなぎ、スクロールでループ。
   * 全パーツ同じ表示高さ（stripH）・横幅は縦横比のままパーツごとに可変でよい。
   */
  function drawGroundStageImages() {
    var keys = collectLoadedStageKeys();
    if (keys.length === 0) return false;

    var stripH = Math.round(
      Math.min(STAGE_STRIP_MAX_H, Math.max(24, GROUND_Y - 8))
    );
    var pieces = [];
    var period = 0;
    var ki;
    var maxDw = 0;
    for (ki = 0; ki < keys.length; ki++) {
      var im = spriteImg[keys[ki]];
      var dh = stripH;
      var dw = Math.round((im.naturalWidth * dh) / im.naturalHeight);
      if (dw < 1) dw = 1;
      pieces.push({ key: keys[ki], w: dw, h: dh });
      period += dw;
      if (dw > maxDw) maxDw = dw;
    }
    if (period < 1) return false;

    var dist = state.playing ? state.distance : 0;
    var scroll = dist * STAGE_IMAGE_PARALLAX;
    var sm = ((scroll % period) + period) % period;
    var x = -sm;
    var idx = 0;
    var safety = 0;
    while (x < W + maxDw + 2 && safety < 100) {
      var p = pieces[idx % pieces.length];
      var img = spriteImg[p.key];
      var dx = Math.round(x);
      // PNG 下端の透明余白を除き、「見えている地面の下端」を恐竜の足元 GROUND_Y に合わせる（サボと同じ考え方）
      var vtrimS = computeSpriteVerticalTrim(p.key);
      var bottomTrimScaled = 0;
      if (vtrimS) {
        bottomTrimScaled = vtrimS.bottomTrim * (p.h / img.naturalHeight);
      }
      var drawY = Math.round(GROUND_Y - p.h + bottomTrimScaled);
      ctx.drawImage(
        img,
        0,
        0,
        img.naturalWidth,
        img.naturalHeight,
        dx,
        drawY,
        p.w,
        p.h
      );
      x += p.w;
      idx++;
      safety++;
    }
    return true;
  }

  function drawGroundProcedural() {
    ctx.fillStyle = night ? "#2b2b2b" : "#535353";
    ctx.fillRect(0, GROUND_Y, W, 2);
    var dist = state.playing ? state.distance : 0;
    var offset = -(dist * STAGE_IMAGE_PARALLAX) % 20;
    ctx.fillStyle = night ? "#3a3a3a" : "#d0d0d0";
    for (var gx = offset; gx < W + 20; gx += 20) {
      ctx.fillRect(gx, GROUND_Y + 4, 12, 1);
    }
    ctx.fillStyle = night ? "#4a4a4a" : "#c8c8c8";
    for (var s = 0; s < 64; s++) {
      var px = ((s * 97) % (W - 4)) + 2;
      if (px % 23 === 0) ctx.fillRect(px, GROUND_Y + 1, 1, 1);
    }
  }

  function drawGround() {
    if (!drawGroundStageImages()) {
      drawGroundProcedural();
    } else {
      ctx.fillStyle = night ? "#2b2b2b" : "#535353";
      ctx.fillRect(0, GROUND_Y, W, 2);
    }
  }

  function drawScoreHud() {
    ctx.save();
    // 本家はキャンバス上でやや大きめのピクセル風数字（600 基準を 800 に合わせて拡大）
    ctx.font =
      'bold 19px "Courier New", Courier, ui-monospace, monospace';
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    var cur =
      state.playing || state.crashed ? Math.floor(state.score) : 0;
    var hiPart = "HI " + pad5(hiScore);
    var curPart = pad5(cur);
    var rightX = W - 8;
    var topY = 3;
    var colHi = night ? "#c8c8c8" : "#535353";
    var colCur = night ? "#eeeeee" : "#535353";
    var colCurBlink = night ? "#ffffff" : "#a5a5a5";

    var wCur = ctx.measureText(curPart).width;
    var gap = ctx.measureText("  ").width;
    ctx.fillStyle = colHi;
    ctx.fillText(hiPart, rightX - wCur - gap, topY);
    var blink =
      state.scoreBlinkFrames > 0 &&
      Math.floor(state.scoreBlinkFrames / 2) % 2 === 0;
    ctx.fillStyle = blink ? colCurBlink : colCur;
    ctx.fillText(curPart, rightX, topY);
    ctx.restore();
  }

  function syncChromeHint() {
    if (!spaceHintEl) return;
    spaceHintEl.classList.remove("hidden");
  }

  function drawCloudsProcedural() {
    ctx.fillStyle = night ? "#444" : "#d1d1d1";
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      ctx.fillRect(c.x, c.y, c.w * 0.45, 6);
      ctx.fillRect(c.x + 8, c.y - 6, c.w * 0.5, 8);
      ctx.fillRect(c.x + 22, c.y, c.w * 0.4, 5);
    }
  }

  function drawClouds() {
    if (!imgOk("cloud")) {
      drawCloudsProcedural();
      return;
    }
    var im = spriteImg.cloud;
    ctx.save();
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var ch = (c.w * im.naturalHeight) / im.naturalWidth;
      ctx.drawImage(im, c.x, c.y, c.w, ch);
    }
    ctx.restore();
  }

  function drawRexProcedural() {
    var freeze = state.crashed;
    var h = rex.duck && rex.onGround ? rex.hDuck : rex.hRun;
    var yTop = rex.y - h;
    ctx.fillStyle = night ? "#eee" : "#535353";

    if (rex.duck && rex.onGround) {
      ctx.fillRect(rex.x + 4, yTop + 8, 36, 12);
      ctx.fillRect(rex.x, yTop + 14, 8, 6);
      ctx.fillRect(rex.x + 36, yTop + 14, 8, 6);
      var leg = freeze ? 0 : Math.floor(rexAnimT) % 8 < 4 ? 0 : 1;
      ctx.fillRect(rex.x + 10 + leg * 6, yTop + 18, 6, 6);
      ctx.fillRect(rex.x + 24 - leg * 6, yTop + 18, 6, 6);
      return;
    }

    ctx.fillRect(rex.x + 18, yTop, 22, 10);
    ctx.fillRect(rex.x + 32, yTop + 6, 14, 8);
    ctx.fillRect(rex.x + 8, yTop + 10, 28, 22);
    ctx.fillRect(rex.x + 4, yTop + 24, 8, 12);
    var runPhase = freeze ? 0 : Math.floor(rexAnimT) % 10 < 5 ? 0 : 1;
    ctx.fillRect(rex.x + 14 + runPhase * 4, yTop + 32, 6, 14);
    ctx.fillRect(rex.x + 26 - runPhase * 4, yTop + 32, 6, 14);
  }

  function drawRex() {
    var im = rexCurrentImage();
    if (im) {
      var keyForTrim = null;
      if (im === spriteImg.rexCrash) keyForTrim = "rexCrash";
      else if (im === spriteImg.rexDuck0) keyForTrim = "rexDuck0";
      else if (im === spriteImg.rexDuck1) keyForTrim = "rexDuck1";
      else if (im === spriteImg.rexWait) keyForTrim = "rexWait";
      else if (im === spriteImg.rexRun0) keyForTrim = "rexRun0";
      else if (im === spriteImg.rexRun1) keyForTrim = "rexRun1";

      var vtrim = keyForTrim ? computeSpriteVerticalTrim(keyForTrim) : null;
      var bottomTrim = vtrim ? vtrim.bottomTrim : 0;
      // bottomTrim 分だけ画像を下にずらし、「見えている足元」が groundY に乗るようにする
      ctx.drawImage(im, rex.x, rex.y - im.naturalHeight + bottomTrim);
      return;
    }
    drawRexProcedural();
  }

  function cactusSpriteKey(variant) {
    if (variant === "tall") return "cactusTall";
    if (variant === "wide") return "cactusWide";
    return "cactusSmall";
  }

  function drawCactusStemWorld(sx, groundY, w, h, variant) {
    var key = cactusSpriteKey(variant || "small");
    if (imgOk(key)) {
      var im = spriteImg[key];
      var vtrim = computeSpriteVerticalTrim(key);
      var bottomTrimScaled = 0;
      if (vtrim) {
        bottomTrimScaled = vtrim.bottomTrim * (h / im.naturalHeight);
      }
      ctx.drawImage(im, sx, groundY - h + bottomTrimScaled, w, h);
      return;
    }
    ctx.fillStyle = night ? "#ccc" : "#535353";
    var bx = sx;
    var by = groundY - h;
    ctx.fillRect(bx + w * 0.4, by, w * 0.2, h);
    if (w > 30) {
      ctx.fillRect(bx, by + h * 0.35, w * 0.35, h * 0.25);
      ctx.fillRect(bx + w * 0.65, by + h * 0.45, w * 0.35, h * 0.2);
    } else if (h > 40) {
      ctx.fillRect(bx + 2, by + h * 0.25, 8, h * 0.5);
      ctx.fillRect(bx + w - 10, by + h * 0.35, 8, h * 0.45);
    }
  }

  function drawCactus(o) {
    if (o.stems && o.stems.length > 0) {
      var si;
      for (si = 0; si < o.stems.length; si++) {
        var st = o.stems[si];
        drawCactusStemWorld(o.x + st.xOff, o.y, st.w, st.h, st.variant);
      }
      return;
    }
    drawCactusStemWorld(o.x, o.y, o.w, o.h, o.variant || "small");
  }

  function pteraAnimElapsedMs(o) {
    if (typeof o.pteraAnimStartMs === "number") {
      return Math.max(0, state.runningMs - o.pteraAnimStartMs);
    }
    if (typeof o.pteraVisibleMs === "number") {
      return Math.max(0, o.pteraVisibleMs);
    }
    if (typeof o.wingTimerMs === "number") {
      return Math.max(0, o.wingTimerMs);
    }
    return 0;
  }

  function pteraSpriteKey(o) {
    var wms = pteraAnimElapsedMs(o);
    var parity = o.wingFlipParity | 0;
    var flap = Math.floor(wms / PTERA_FLAP_MS);
    var idx = (parity + flap) % 2;
    return idx === 0 ? "enemy01" : "enemy02";
  }

  function drawPtera(o) {
    var pk = pteraSpriteKey(o);
    if (DEBUG_PTERA_TOGGLE && o._lastEnemyPK !== pk) {
      o._lastEnemyPK = pk;
      console.log(
        "[ptera toggle]",
        "pk=" + pk,
        "animMs=" + pteraAnimElapsedMs(o).toFixed(1),
        "parity=" + (o.wingFlipParity | 0),
        "x=" + o.x.toFixed(1)
      );
    }
    if (imgOk(pk)) {
      ctx.drawImage(spriteImg[pk], o.x, o.y - o.h, o.w, o.h);
      return;
    }
    /*
     * 夜モードは CSS 側で #game を invert(1) している。
     * night でここを #ccc にすると、invert 後はかえって暗くなって鳥が埋もれるので、
     * フォールバックは固定色にする。
     */
    ctx.fillStyle = "#535353";
    var flap = pteraSpriteKey(o) === "enemy01" ? 0 : 1;
    var by = o.y - o.h;
    ctx.fillRect(o.x + 8, by + 4, 28, 10);
    ctx.fillRect(o.x + 28, by + 2, 14, 8);
    ctx.beginPath();
    ctx.moveTo(o.x, by + 10 + flap * 3);
    ctx.lineTo(o.x + 18, by + 14);
    ctx.lineTo(o.x + 4, by + 16 + flap * 2);
    ctx.fill();
  }

  function drawObstacle(o) {
    if (o.type === "ptera") drawPtera(o);
    else drawCactus(o);
  }

  function drawObstacleDebugOverlay() {
    if (!DEBUG_OBSTACLE_OVERLAY || !state.playing) return;
    ctx.save();
    var lines = ["obs[] len=" + obstacles.length];
    for (var di = 0; di < obstacles.length; di++) {
      var ob = obstacles[di];
      var part = "#" + di + " " + ob.type;
      if (ob.type === "cactus") part += " " + (ob.variant || "?");
      if (ob.type === "ptera") {
        var pk = pteraSpriteKey(ob);
        part +=
          " img=" +
          pk +
          " ok=" +
          (imgOk(pk) ? "1" : "0") +
          " animMs=" +
          pteraAnimElapsedMs(ob).toFixed(0) +
          " x=" +
          ob.x.toFixed(0);
      } else {
        part += " x=" + ob.x.toFixed(0);
      }
      lines.push(part);
    }
    var padX = 6;
    var padY = 36;
    var lh = 11;
    ctx.font = "10px Consolas, ui-monospace, monospace";
    var maxW = 0;
    for (var li = 0; li < lines.length; li++) {
      maxW = Math.max(maxW, ctx.measureText(lines[li]).width);
    }
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillRect(
      padX - 3,
      padY - 2,
      maxW + 8,
      lines.length * lh + 6
    );
    ctx.fillStyle = "#222";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (var lj = 0; lj < lines.length; lj++) {
      ctx.fillText(lines[lj], padX, padY + lj * lh);
    }
    ctx.restore();
  }

  function tickPhysics(step) {
    if (showTitleScreen && !introHop && !state.playing && !state.crashed) return;
    // 本家: 衝突後は恐竜も障害物も雲も進まない（落下し続けない）
    if (state.crashed) return;

    var dtMs = step * (1000 / 60);
    var vyStep = rex.vy;
    if (rex.speedDrop) vyStep *= SPEED_DROP_COEFFICIENT;
    rex.y += vyStep * step;
    rex.vy += GRAVITY * step;

    if (rex.jumping) {
      if (rex.y <= GROUND_Y - MIN_JUMP_HEIGHT || rex.speedDrop) {
        rex.reachedMinHeight = true;
      }
    }

    if (rex.y >= GROUND_Y) {
      rex.y = GROUND_Y;
      rex.vy = 0;
      rex.onGround = true;
      rex.jumping = false;
      rex.reachedMinHeight = false;
      rex.speedDrop = false;
    } else {
      rex.onGround = false;
    }

    if (introHop) {
      if (!rex.onGround) introLeftGround = true;
      else if (introLeftGround) {
        introHop = false;
        introLeftGround = false;
        state.playing = true;
      }
    }

    if (state.playing) {
      state.distance += state.speed * step;
      state.runningMs += dtMs;
    }

    if ((state.playing || introHop) && !state.crashed) {
      rexAnimT += step * REX_ANIM_RATE;
    }

    if (state.playing) {
      state.score += state.speed * SCORE_RATE * step;
      if (state.score > hiScore) {
        hiScore = Math.floor(state.score);
        saveHi(hiScore);
      }

      var hundred = Math.floor(state.score / 100);
      if (hundred > lastScoreHundredMark) {
        lastScoreHundredMark = hundred;
        playMilestoneSe();
        state.scoreBlinkFrames = 28;
      }

      if (state.score >= nextNightScore) {
        night = !night;
        nextNightScore += nightToggleAt;
      }

      if (state.speed < MAX_SPEED) {
        state.speed += ACCELERATION * step;
        if (state.speed > MAX_SPEED) state.speed = MAX_SPEED;
      }
    }

    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var drift = 0;
      if (state.playing) drift = state.speed * CLOUD_PARALLAX * step;
      else if (!introHop) drift = CLOUD_IDLE_PX * step;
      c.x -= drift;
      if (c.x + c.w < 0) {
        c.x = W + 30 + Math.random() * 60;
        c.y = 8 + Math.random() * 22;
      }
    }

    if (!state.playing) return;

    // 本家: CLEAR_TIME を超えるまで障害物は生成しない
    if (state.runningMs > CLEAR_TIME_MS) {
      // 本家: lastObstacle.isVisible() && !followingCreated && last.x+width+gap < W で次を生成
      if (obstacles.length === 0) {
        obstacles.push(spawnObstacle());
      } else {
        var last = obstacles[obstacles.length - 1];
        var visible = last && last.x + last.w > 0;
        if (
          last &&
          visible &&
          !last.followingCreated &&
          typeof last.gap === "number" &&
          last.x + last.w + last.gap < W
        ) {
          obstacles.push(spawnObstacle());
          last.followingCreated = true;
        }
      }
    }

    for (var j = obstacles.length - 1; j >= 0; j--) {
      var o = obstacles[j];
      o.x -= state.speed * step;
      if (o.x + o.w < 0) obstacles.splice(j, 1);
    }

    var hb = rexHitbox();
    for (var k = 0; k < obstacles.length; k++) {
      var ob = obstacles[k];
      var obox;

      // 透明余白（下方向）を考慮して「見えている領域」へ当たり矩形を寄せる
      if (ob.type === "cactus") {
        if (ob.stems && ob.stems.length > 0) {
          var si2;
          for (si2 = 0; si2 < ob.stems.length; si2++) {
            var st2 = ob.stems[si2];
            var sbox = cactusStemHitRect(
              ob.x + st2.xOff,
              ob.y,
              st2.w,
              st2.h,
              st2.variant
            );
            if (rectsOverlap(hb, sbox)) {
              state.crashed = true;
              state.playing = false;
              gameOverShownAt = performance.now();
              playCrashSe();
              break;
            }
          }
          if (state.crashed) break;
          continue;
        }
        obox = cactusStemHitRect(
          ob.x,
          ob.y,
          ob.w,
          ob.h,
          ob.variant || "small"
        );
      } else if (ob.type === "ptera") {
        var pKey = pteraSpriteKey(ob);
        var vtrimP = computeSpriteVerticalTrim(pKey);
        if (vtrimP && imgOk(pKey)) {
          var imp = spriteImg[pKey];
          // ptera は o.h, o.w が既に表示スケール済み（natural 幅で伸縮される想定）
          var scaleP = ob.h / imp.naturalHeight;
          var topTrimScaledP = vtrimP.topTrim * scaleP;
          var bottomTrimScaledP = vtrimP.bottomTrim * scaleP;
          var visibleHP = Math.max(1, ob.h - topTrimScaledP - bottomTrimScaledP);
          obox = {
            x: ob.x + 2,
            y: ob.y - ob.h + bottomTrimScaledP + 2,
            w: ob.w - 4,
            h: visibleHP - 4,
          };
        }
      }

      if (!obox) {
        obox = {
          x: ob.x + 2,
          y: ob.y - ob.h + 2,
          w: ob.w - 4,
          h: ob.h - 4,
        };
      }

      if (rectsOverlap(hb, obox)) {
        state.crashed = true;
        state.playing = false;
        gameOverShownAt = performance.now();
        playCrashSe();
        break;
      }
    }
  }

  function render() {
    var titleIdle =
      showTitleScreen && !state.playing && !state.crashed;

    if (titleIdle) {
      syncStageLayers();
      syncChromeHint();
      return;
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    if (state.scoreBlinkFrames > 0) {
      state.scoreBlinkFrames--;
    }
    drawScoreHud();

    drawClouds();
    drawGround();

    for (var i = 0; i < obstacles.length; i++) drawObstacle(obstacles[i]);
    drawRex();
    drawObstacleDebugOverlay();
    drawGameOverUI();
    syncStageLayers();
    syncChromeHint();

    if (state.flashTimer > 0) {
      state.flashTimer--;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  var lastTickMs = 0;
  var FRAME_NORM_MS = 1000 / 60;
  var MAX_STEP_MS = 100;

  function loop(now) {
    if (now == null) now = performance.now();
    if (!lastTickMs) {
      lastTickMs = now - FRAME_NORM_MS;
    }
    var dtMs = Math.min(Math.max(now - lastTickMs, 0), MAX_STEP_MS);
    lastTickMs = now;
    var step = dtMs / FRAME_NORM_MS;
    if (step < 1e-6) step = 1e-6;

    tickPhysics(step);
    render();
    requestAnimationFrame(loop);
  }

  function jump() {
    if (state.crashed) return;
    if (introHop) return;
    if (!state.playing) {
      if (!showTitleScreen) return;
      showTitleScreen = false;
      syncStageLayers();
      introHop = true;
      introLeftGround = false;
      rexAnimT = 0;
      rex.vy = INTRO_JUMP_V;
      rex.onGround = false;
      rex.duck = false;
      state.score = 0;
      state.speed = BASE_SPEED;
      state.distance = 0;
      state.runningMs = 0;
      lastScoreHundredMark = 0;
      state.scoreBlinkFrames = 0;
      obstacles.length = 0;
      obstacleHistory.length = 0;
      gameOverShownAt = 0;
      playJumpSe();
      return;
    }
    if (rex.onGround) {
      rex.vy = INITIAL_JUMP_VELOCITY - state.speed / 10;
      rex.onGround = false;
      rex.jumping = true;
      rex.reachedMinHeight = false;
      rex.speedDrop = false;
      rex.duck = false;
      playJumpSe();
    }
  }

  function endJump() {
    if (!rex.jumping) return;
    if (rex.reachedMinHeight && rex.vy < DROP_VELOCITY) {
      rex.vy = DROP_VELOCITY;
    }
  }

  function restart() {
    state.crashed = false;
    state.playing = false;
    introHop = false;
    introLeftGround = false;
    rexAnimT = 0;
    rex.y = GROUND_Y;
    rex.vy = 0;
    rex.duck = false;
    rex.jumping = false;
    rex.reachedMinHeight = false;
    rex.speedDrop = false;
    obstacles.length = 0;
    obstacleHistory.length = 0;
    state.score = 0;
    state.speed = BASE_SPEED;
    state.distance = 0;
    state.runningMs = 0;
    lastScoreHundredMark = 0;
    state.scoreBlinkFrames = 0;
    night = false;
    nextNightScore = nightToggleAt;
    gameOverShownAt = 0;
    showTitleScreen = true;
    syncStageLayers();
  }

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      if (state.crashed) restart();
      else jump();
    }
    if (e.code === "ArrowUp") {
      e.preventDefault();
      if (state.crashed) restart();
      else jump();
    }
    if (e.code === "ArrowDown") {
      e.preventDefault();
      if (state.playing && rex.onGround) rex.duck = true;
      if (state.playing && !rex.onGround) rex.speedDrop = true;
    }
  });

  window.addEventListener("keyup", function (e) {
    if (e.code === "ArrowDown") rex.duck = false;
    if (e.code === "Space" || e.code === "ArrowUp") endJump();
  });

  canvas.addEventListener(
    "pointerdown",
    function () {
      if (state.crashed) restart();
      else jump();
    },
    { passive: true }
  );

  bootSprites();
  wireStartImg();
  wireSpaceHintImg();
  syncStageLayers();
  requestAnimationFrame(loop);
})();
