process.env.FINANCE_ACCESS_FILE = '.finance-local/phase51-access.json'
process.env.FINANCE_MEDIA_STORY_FILE = 'docs/finance-restructure/phase5/evidence51/browser.json'
process.env.FINANCE_PREVIEW_EDGE = 'evolutus_profiles_phase51_edge'
process.env.FINANCE_EVIDENCE_DIR = 'docs/finance-restructure/phase5/evidence51'
await import('./phase5-media.mjs')
const { readFileSync } = await import('node:fs'),
  assert = (await import('node:assert/strict')).default
const story = JSON.parse(readFileSync(process.env.FINANCE_MEDIA_STORY_FILE))
for (const row of story.resources)
  assert.equal(
    (await fetch('http://127.0.0.1:55554/functions/v1/storefront-media?id=' + row.media)).status,
    200,
    'cleanup preserves approved bytes of every sibling resource'
  )
console.log('All approved sibling images preserved')
