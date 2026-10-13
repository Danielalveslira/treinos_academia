// Reproducible text audit against the real imported catalogue, without calling external image providers.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import {
  buildExerciseVisualPrompts,
  exercisePoseBrief,
} from '../src/utils/exerciseVisualPromptBuilder.js'
const catalog = JSON.parse(await readFile('imports/exercicios_ptbr.json', 'utf8'))
const sql = await readFile('supabase/migrations/20261021000001_exercise_visuals_v2.sql', 'utf8')
const seed = sql.slice(
  sql.indexOf("E'Ilustração técnica fitness 3D"),
  sql.indexOf('on conflict (name, version)')
)
const [basePart, negativePart] = seed.split("E'Sem texto.")
const unquote = (part) =>
  [...part.matchAll(/(?:E)?'([^']*)'/g)].map((match) => match[1].replaceAll('\\n', '\n')).join('')
const profile = {
  id: 'seed-v2',
  name: 'EVOLUTUS_FITNESS_V2',
  version: 'v2',
  base_prompt: unquote(basePart),
  negative_rules: 'Sem texto.' + unquote("E'" + negativePart),
}
assert.ok(profile.base_prompt.includes('andrógina'))
assert.ok(profile.negative_rules.includes('Sem membros extras.'))
const baseline = process.argv[2] || 'b3d364a1b5303eb60e8bf8234e65d028f6b30ae1'
assert.match(baseline, /^[0-9a-f]{7,40}$/)
const oldSource = execFileSync(
  'git',
  ['show', `${baseline}:src/utils/exerciseVisualPromptBuilder.js`],
  {
    encoding: 'utf8',
  }
)
const old = await import(`data:text/javascript;base64,${Buffer.from(oldSource).toString('base64')}`)
const ids = [
  'Pushups',
  'Butterfly',
  'Barbell_Bench_Press_-_Medium_Grip',
  'Alternate_Hammer_Curl',
  'Calf_Press_On_The_Leg_Press_Machine',
]
const samples = ids.map((id) => {
  const exercise = catalog.find((row) => row.id === id)
  assert.ok(exercise)
  const before = old.buildExerciseVisualPrompts(exercise, profile),
    after = buildExerciseVisualPrompts(exercise, profile)
  assert.equal(after.start.needsClarification, false)
  assert.equal(after.end.needsClarification, false)
  return {
    id,
    name: exercise.name,
    equipment: exercise.equipment,
    pose: exercisePoseBrief(exercise),
    before,
    after,
  }
})
const dir = '/tmp/exercise-visual-tests'
await mkdir(dir, { recursive: true })
await writeFile(
  `${dir}/prompt-samples.json`,
  JSON.stringify({ profile: profile.name, externalGenerationPerformed: false, samples }, null, 2)
)
console.log(
  JSON.stringify({
    cases: samples.length,
    externalGenerationPerformed: false,
    samples: samples.map((sample) => ({
      id: sample.id,
      startBefore: sample.before.start.text.length,
      startAfter: sample.after.start.text.length,
      endBefore: sample.before.end.text.length,
      endAfter: sample.after.end.text.length,
    })),
  })
)
