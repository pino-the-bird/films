// a short film of his, cut on GitHub's machines when the town asks, never on the town's server (Sam, 24 Oct: "don't
// render it on the server"). what to cut is cut.json beside the page, { film, for }, and the film's own file,
// films/<film>.json: its title, and each scene's card and clip (Runway's, five seconds, made from his story by the town,
// world/Films.js). the cards go between the scenes as a silent film's do, white on dark, the title first; the scenes
// play as they came. it makes films/<film>/film.mp4, a poster, a sheet of stills for him to look at (three from each
// scene, a row a scene) and done.json, which carries `for`, so the town knows the film is the one it asked for
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = process.env.CUT_ROOT || process.cwd()
const W = 1280, H = 720, FPS = 24
const BG = '0x141210', INK = '0xe8e2d6'
const ask = JSON.parse(await readFile(join(ROOT, 'cut.json'), 'utf8'))
const film = JSON.parse(await readFile(join(ROOT, 'films', `${ask.film}.json`), 'utf8'))
const OUT = join(ROOT, 'films', film.id)
const WORK = join(ROOT, '.cut')
await rm(WORK, { recursive: true, force: true })
await mkdir(WORK, { recursive: true })
await mkdir(OUT, { recursive: true })

const run = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] })
const lengthOf = (p) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString().trim()) || 5
// (CUT_PLAIN_CARDS: cards with no words, for trying it on a desk whose ffmpeg cannot draw them; GitHub's can)
const PLAIN = process.env.CUT_PLAIN_CARDS === '1'
if (!PLAIN && !execFileSync('ffmpeg', ['-hide_banner', '-filters']).toString().includes('drawtext')) throw new Error('this ffmpeg cannot draw the words on the cards')
const FONT = PLAIN ? '' : ['/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Georgia.ttf', '/System/Library/Fonts/Helvetica.ttc']
  .find((f) => existsSync(f)) || execFileSync('fc-match', ['-f', '%{file}', 'serif']).toString().trim()

// the words of a card in lines that fit across it
function linesOf(text, most) {
  const out = []
  let line = ''
  for (const w of String(text).replace(/\s+/g, ' ').trim().split(' ')) {
    if (line && `${line} ${w}`.length > most) { out.push(line); line = w } else line = line ? `${line} ${w}` : w
  }
  if (line) out.push(line)
  return out.slice(0, 5)
}

// a card: its words in the middle, a thin frame round them, for `seconds`
async function card(name, text, { size = 46, seconds = 3 } = {}) {
  const lines = linesOf(text, size > 50 ? 26 : 34)
  const gap = Math.round(size * 1.35)
  const top = Math.round(H / 2 - (lines.length * gap) / 2 + size * 0.15)
  const draws = []
  for (const [i, l] of (PLAIN ? [] : lines.entries())) {
    const f = join(WORK, `${name}-${i}.txt`)
    await writeFile(f, l)
    draws.push(`drawtext=fontfile='${FONT}':textfile='${f}':fontcolor=${INK}:fontsize=${size}:x=(w-text_w)/2:y=${top + i * gap}`)
  }
  const out = join(WORK, `${name}.mp4`)
  run(['-f', 'lavfi', '-i', `color=c=${BG}:s=${W}x${H}:d=${seconds}:r=${FPS}`, '-vf', [`drawbox=x=64:y=64:w=iw-128:h=ih-128:color=${INK}@0.45:t=2`, ...draws, 'setsar=1', 'format=yuv420p'].join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', out])
  return out
}

// a scene's clip, fetched from where Runway left it, the size and rate of the rest
async function scene(s) {
  const raw = join(WORK, `s${s.n}-raw.mp4`)
  if (/^https?:/.test(s.clip)) {
    const r = await fetch(s.clip, { signal: AbortSignal.timeout(120_000) })
    if (!r.ok) throw new Error(`scene ${s.n} did not come: ${r.status}`)
    await writeFile(raw, Buffer.from(await r.arrayBuffer()))
  } else await writeFile(raw, await readFile(s.clip))
  const out = join(WORK, `s${s.n}.mp4`)
  run(['-i', raw, '-an', '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG},fps=${FPS},setsar=1,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', out])
  return out
}

const parts = [await card('title', film.title || 'untitled', { size: 64, seconds: 3.5 })]
const stills = []
const played = []
for (const s of film.scenes || []) {
  if (!s.clip) continue
  let clip
  try { clip = await scene(s) } catch (err) { console.log(err.message); continue }
  if (s.card) parts.push(await card(`card${s.n}`, s.card))
  parts.push(clip)
  played.push(s.n)
  // three stills from it, early, the middle and late
  const len = lengthOf(clip)
  for (const at of [0.08, 0.5, 0.92]) {
    const f = join(WORK, `still_${String(stills.length).padStart(3, '0')}.png`)
    run(['-ss', String(Math.max(0, len * at)), '-i', clip, '-frames:v', '1', '-vf', 'scale=400:225', f])
    stills.push(f)
  }
  if (stills.length === 3) run(['-ss', String(len * 0.08), '-i', clip, '-frames:v', '1', '-q:v', '3', join(OUT, 'poster.jpg')])
}
if (!played.length) throw new Error('no scene came')

// the film, the cards and the scenes in order
const inputs = parts.flatMap((p) => ['-i', p])
const joins = parts.map((_, i) => `[${i}:v]`).join('')
run([...inputs, '-filter_complex', `${joins}concat=n=${parts.length}:v=1:a=0[v]`, '-map', '[v]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(OUT, 'film.mp4')])
// the stills, a row a scene
run(['-framerate', '1', '-i', join(WORK, 'still_%03d.png'), '-vf', `tile=3x${played.length}:padding=8:margin=8:color=${BG}`, '-frames:v', '1', join(OUT, 'sheet.png')])
const seconds = Math.round(lengthOf(join(OUT, 'film.mp4')) * 10) / 10
await writeFile(join(OUT, 'done.json'), JSON.stringify({ for: ask.for ?? null, at: new Date().toISOString(), film: film.id, title: film.title, scenes: played, seconds, of: process.env.GITHUB_SHA || null }, null, 2))
await rm(WORK, { recursive: true, force: true })
console.log(`"${film.title}": ${played.length} scenes, ${seconds}s, on films/${film.id}/film.mp4`)
