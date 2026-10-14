import { businessDayKey } from '../../../utils/businessDate.js'

export const NOTICE_COOLDOWN = 12 * 60 * 60 * 1000
const memory = new Map()
export const noticeKey = (userId, standalone) =>
  `evolutus:push-notice:${standalone ? 'pwa' : 'web'}:${userId}`

export function nextNoticeAt(record, now = Date.now()) {
  if (!record) return now
  if (!Number.isSafeInteger(record.at) || record.at < 0 || record.day !== businessDayKey(record.at))
    return now + NOTICE_COOLDOWN
  // Find the next business day without assuming the device timezone or a fixed UTC offset.
  let low = record.at
  let high = low + 48 * 60 * 60 * 1000
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2)
    if (businessDayKey(mid) > record.day) high = mid
    else low = mid
  }
  return Math.max(high, record.at + NOTICE_COOLDOWN)
}

export function dismissPushNotice(key, now = Date.now()) {
  const record = { day: businessDayKey(now), at: now }
  memory.set(key, record)
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(record))
  } catch {
    /* session fallback */
  }
  return record
}

export function readPushNotice(key, now = Date.now()) {
  let raw
  try {
    raw = globalThis.localStorage?.getItem(key)
  } catch {
    return memory.get(key) || null
  }
  if (!raw) return memory.get(key) || null
  try {
    const record = JSON.parse(raw)
    if (
      !Number.isSafeInteger(record?.at) ||
      record.at < 0 ||
      record.at > 8640000000000000 - 172800000 ||
      record.day !== businessDayKey(record.at)
    )
      throw new Error('invalid')
    const previous = memory.get(key)
    if (previous && previous.at > record.at) return previous
    memory.set(key, record)
    return record
  } catch {
    // Repair once; never reinterpret corruption as a fresh invitation on every render.
    return dismissPushNotice(key, now)
  }
}
