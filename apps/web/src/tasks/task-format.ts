const HOUR_MS = 60 * 60 * 1000;

export function formatOverdueDuration(dueAt: string, now = Date.now()) {
  const elapsed = now - new Date(dueAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return null;
  }
  const hours = Math.floor(elapsed / HOUR_MS);
  if (hours < 1) {
    return "不足1小时";
  }
  if (hours < 24) {
    return `${hours}小时`;
  }
  return `${Math.floor(hours / 24)}天${hours % 24}小时`;
}
