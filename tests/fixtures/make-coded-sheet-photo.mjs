// Regenerates tests/fixtures/coded-sheet-photo.png: a fictional coded sheet, rendered in
// Chromium, then rotated, blurred and marked with a canvas so it looks like a phone photo.
// Run: node tests/fixtures/make-coded-sheet-photo.mjs
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const html = `<body style="margin:0;background:#8a7f72"><div id=s style="width:620px;height:820px;background:#fff;padding:40px;font:22px sans-serif;box-sizing:border-box">
<div style="display:flex;justify-content:space-between"><b>Fractions practice</b><span style="font:bold 26px monospace;border:2px solid #000;padding:2px 8px">AL-K7Q4L1</span></div>
<p>Name: ______________ (fictional demo sheet)</p>
${[['1','1/2 + 1/4 =','3/4'],['2','2/3 of 9 =','6'],['3','Which is bigger, 3/8 or 1/2?','1/2']].map(([n,q,a])=>`<p style="margin-top:36px">${n}. ${q}</p><div style="height:46px;border-bottom:2px solid #333;font:italic 30px cursive;color:#1a3a8a;padding-left:20px">${a}</div><div style="font:12px monospace">check Q${n}</div>`).join('')}
</div><canvas id=c width=900 height=1100 style="display:none"></canvas></body>`

const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 900, height: 1100 } })
await page.setContent(html)
const shot = (await page.locator('#s').screenshot()).toString('base64')
const out = await page.evaluate(async (src) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + src
  await img.decode()
  const c = document.getElementById('c')
  const g = c.getContext('2d')
  g.fillStyle = '#7d7366'
  g.fillRect(0, 0, 900, 1100)
  g.filter = 'blur(1.2px) contrast(0.92)'
  g.translate(450, 550)
  g.rotate((3.2 * Math.PI) / 180)
  g.shadowColor = 'rgba(0,0,0,.4)'
  g.shadowBlur = 25
  g.drawImage(img, -img.width / 2, -img.height / 2)
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.filter = 'none'
  g.shadowBlur = 0
  g.strokeStyle = 'rgba(200,30,30,.8)'
  g.lineWidth = 5
  g.beginPath(); g.moveTo(640, 470); g.lineTo(670, 500); g.lineTo(720, 430); g.stroke()
  g.fillStyle = 'rgba(60,60,60,.25)'
  g.fillRect(240, 700, 300, 14)
  return c.toDataURL('image/png').split(',')[1]
}, shot)
writeFileSync(new URL('./coded-sheet-photo.png', import.meta.url), Buffer.from(out, 'base64'))
await b.close()
