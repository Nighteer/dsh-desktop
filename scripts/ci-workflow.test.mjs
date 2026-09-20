import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const workflow = readFileSync(
  fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url)),
  'utf8',
)

test('CI creates unsigned artifacts without publishing GitHub Releases', () => {
  assert.doesNotMatch(workflow, /^\s*tags:\s*\[v\*\]\s*$/mu)
  assert.doesNotMatch(workflow, /^\s+release:\s*$/mu)
  assert.doesNotMatch(workflow, /\bgh\s+release\s+create\b/u)
})
