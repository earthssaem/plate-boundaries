/* 판의 경계 시뮬레이션 자동 점검
   - 콘솔 오류 없음
   - 장면·시점별 이름표가 서로 겹치지 않음
   - 진원 깊이 색이 학습 내용과 일치(해령·열곡대·변환 단층 = 천발만, 섭입대 = 천발→중발→심발, 대륙 충돌 = 심발 없음)
   - 장면별 스크린샷을 tests/out/ 에 저장
   실행: npm test  (playwright 필요: npm i) */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push('console: ' + m.text()); });   // 외부 글꼴 로드 실패는 무시
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForTimeout(400);

  // 이름표 상자·진원 기록용 훅
  await page.evaluate(() => {
    window.__labels = [];
    window.__quakes = [];
    const origRound = CanvasRenderingContext2D.prototype.roundRect;
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      window.__labels.push({ x, y, w, h });
      return origRound.call(this, x, y, w, h, r);
    };
    const origQuake = window.drawQuake;
    window.drawQuake = function (x, y, seed, override) {
      window.__quakes.push({ y, cls: override ? 0 : qClassByY(y) });
      return origQuake(x, y, seed, override);
    };
  });

  const names = ['ridge', 'rift', 'oc', 'oo', 'cc', 'tr'];
  const views = [{ v: 0.52, yaw: 0.3 }, { v: 0.0, yaw: 0.5 }, { v: 0.95, yaw: 0.9 }];
  for (let i = 0; i < 6; i++) {
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.92, 1.0]) {
      for (const vw of views) {
        const r = await page.evaluate(([i, t, vw]) => {
          selectScene(i); state.t = t; state.playing = false; VIEW.v = vw.v; VIEW.yaw = vw.yaw;
          return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
            window.__labels = []; window.__quakes = [];
            requestAnimationFrame(() => {
              const L = window.__labels, hits = [];
              for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) {
                const A = L[a], B = L[b];
                if (A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h) hits.push([a, b]);
              }
              res({ hits, quakes: window.__quakes.slice() });
            });
          })));
        }, [i, t, vw]);
        if (r.hits.length) problems.push(`${names[i]} t=${t} view=${JSON.stringify(vw)}: 이름표 겹침 ${r.hits.length}건`);
        const cls = new Set(r.quakes.map(q => q.cls));
        if (t >= 0.5 && r.quakes.length) {
          if ((i === 0 || i === 1 || i === 5) && (cls.has(1) || cls.has(2))) problems.push(`${names[i]} t=${t}: 천발이 아닌 진원이 있음`);
          if (i === 4 && cls.has(2)) problems.push(`cc t=${t}: 심발 진원이 있음`);
          if ((i === 2 || i === 3) && t >= 0.7) {
            if (!(cls.has(0) && cls.has(1) && cls.has(2))) problems.push(`${names[i]} t=${t}: 베니오프대에 천발·중발·심발이 모두 나타나지 않음 (${[...cls]})`);
            const shallowest = r.quakes.reduce((a, b) => (a.y < b.y ? a : b));
            if (shallowest.cls !== 0) problems.push(`${names[i]} t=${t}: 가장 얕은 진원이 천발이 아님`);
          }
        }
        if (vw === views[0] && (t === 0.5 || t === 0.92)) {
          await page.locator('#cv').screenshot({ path: path.join(OUT, `${names[i]}_t${Math.round(t * 100)}.png`) });
        }
      }
    }
  }
  await browser.close();
  if (problems.length) {
    console.error('점검 실패:\n' + problems.map(p => ' - ' + p).join('\n'));
    process.exit(1);
  }
  console.log(`점검 통과. 스크린샷: ${path.relative(ROOT, OUT)}/`);
})();
