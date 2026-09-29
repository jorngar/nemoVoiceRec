import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({
  viewport: { width: 1024, height: 1024 },
  deviceScaleFactor: 1,
});
await page.setContent(
  `<style>*{box-sizing:border-box}body{margin:0;background:transparent}</style><svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="48" y="48" width="928" height="928" rx="220" fill="#f3eee5"/><rect x="58" y="58" width="908" height="908" rx="212" fill="#fcfaf6" stroke="#e4dbce" stroke-width="3"/><g stroke-linecap="round" stroke-width="38"><path d="M242 453v118 M313 382v260 M384 292v440 M455 420v184" stroke="#c96b4d"/><path d="M526 338v348 M597 250v524" stroke="#568e7c"/><path d="M668 371v282 M739 446v132 M810 479v66" stroke="#7586b5"/></g></svg>`,
);
await page.screenshot({ path: "build/icon-1024.png", omitBackground: true });
await browser.close();
