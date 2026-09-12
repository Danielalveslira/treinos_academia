export function toDate(value) {
  return value?.toDate ? value.toDate() : new Date(value)
}
