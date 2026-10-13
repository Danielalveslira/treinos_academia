import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canDeleteVisualVersion,
  REJECTION_REASONS,
  visualFileIssues,
} from './exerciseVisualReview.js'
const asset = (role) => ({
  role,
  mime_type: 'image/webp',
  width: role === 'thumbnail' ? 320 : 1024,
  height: role === 'thumbnail' ? 320 : 1024,
  byte_size: 1000,
})
const valid = {
  assets: [asset('start'), asset('end'), asset('thumbnail')],
  previewUrls: { start: 'a', end: 'b', thumbnail: 't' },
}
test('publicadas, arquivadas e qualquer versão previamente publicada não são oferecidas para exclusão', () => {
  for (const status of ['published', 'archived'])
    assert.equal(canDeleteVisualVersion({ status }), false)
  for (const status of ['review', 'rejected', 'failed', 'allocated', 'draft'])
    assert.equal(canDeleteVisualVersion({ status }), true)
  assert.equal(canDeleteVisualVersion({ status: 'failed', published_at: '2026-10-01' }), false)
  assert.equal(canDeleteVisualVersion({ status: 'review', approved_at: '2026-10-01' }), false)
})
test('somente fatos verificáveis: presença, formato, bytes e dimensões; miniatura opcional', () => {
  assert.deepEqual(visualFileIssues(valid), [])
  assert.deepEqual(visualFileIssues({ ...valid, assets: valid.assets.slice(0, 2) }), [])
  assert.match(visualFileIssues({ ...valid, previewUrls: { start: 'a' } }).join(' '), /END ausente/)
  assert.match(
    visualFileIssues({
      ...valid,
      assets: [asset('start'), { ...asset('end'), mime_type: 'image/jpeg' }],
    }).join(' '),
    /inválidos/
  )
  for (const width of [0, 63, 1025])
    assert.match(
      visualFileIssues({ ...valid, assets: [asset('start'), { ...asset('end'), width }] }).join(
        ' '
      ),
      /inválidos/
    )
  assert.equal(REJECTION_REASONS.length, 6)
  assert.ok(REJECTION_REASONS.includes('Imagem sem relação com exercício'))
})
