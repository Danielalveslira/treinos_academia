import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sheetPickerUrl, validSheetId } from './workoutEntry.js'
const id = 'd0286db4-57cc-4aa8-999c-c74aee7ff43b'
test('legacy entry only preserves valid selection intentions', () => {
  assert.equal(sheetPickerUrl(''), '/treinar')
  assert.equal(sheetPickerUrl('?planejado=2026-02-31'), '/treinar')
  assert.equal(sheetPickerUrl('?ficha=bad&exercicio=bad&evil=1&planejado=bad'), '/treinar')
  assert.equal(
    sheetPickerUrl(`?exercicio=${id}&planejado=2026-10-27&evil=1`),
    `/treinar?exercicio=${id}&planejado=2026-10-27`
  )
  assert.equal(validSheetId('other-user'), false)
  assert.equal(validSheetId(id), true)
})
