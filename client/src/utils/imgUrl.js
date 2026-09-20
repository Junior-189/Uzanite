export function imgUrl(p) {
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  return '/' + String(p).replace(/\\/g, '/').replace(/^\/+/, '');
}
