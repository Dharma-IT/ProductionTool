// Keep marketplace IDs as strings: they exceed JavaScript/Excel numeric precision.
export function readTikTokOrderId(tags) {
  const entries = Array.isArray(tags) ? tags : String(tags ?? '').split(',')
  for (const entry of entries) {
    const match = String(entry).trim().match(/^tik[\s_-]*tok[\s_-]*order[\s_-]*id\s*[:=]\s*(\d+)$/i)
    if (match) return match[1]
  }
  return ''
}
