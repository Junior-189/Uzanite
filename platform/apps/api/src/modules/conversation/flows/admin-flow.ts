import { t } from './i18n';
import { FlowDeps, FlowResult, FlowState, Reply } from './types';
import { orderSummary } from './customer-flow';

const ADMIN_LANG = 'sw';
const money = (n: number): string => Number(n ?? 0).toLocaleString('en-US');
const T = (text: string): Reply => ({ text });

/** Parse `QUICK_ADD name|description|price|stock`. */
function parseQuickAdd(text: string): { name: string; description: string; price: number; stock: number } | null {
  const match = text.match(/QUICK_ADD\s+(.+)/i);
  if (!match) return null;
  const parts = match[1].split('|').map((p) => p.trim());
  if (parts.length < 3) return null;
  return {
    name: parts[0],
    description: parts[1] || 'Product added via WhatsApp',
    price: Number(parts[2]),
    stock: parts[3] ? Number(parts[3]) : 0,
  };
}

/**
 * Admin/staff command flow. Returns `null` when the message is not an admin
 * command so the router can fall back to the customer flow (mirrors Express).
 */
export async function handleAdminFlow(deps: FlowDeps, state: FlowState, rawText: string): Promise<FlowResult | null> {
  const parts = rawText.trim().split(/\s+/);
  const cmd = (parts[0] ?? '').toUpperCase();
  const arg = parts[1];

  try {
    switch (cmd) {
      case 'HELP':
        return { replies: [T(t('admin.help', ADMIN_LANG))] };

      case 'QUICK_ADD': {
        const parsed = parseQuickAdd(rawText);
        if (!parsed || !Number.isFinite(parsed.price) || parsed.price < 0) {
          return { replies: [T(t('admin.quick_add_usage', ADMIN_LANG))] };
        }
        try {
          const product = await deps.createProduct(parsed);
          deps.log('admin.quick_add', { name: product.name, price: product.price, stock: product.stock });
          return { replies: [T(t('admin.quick_add_success', ADMIN_LANG, { name: product.name, currency: product.currency, price: money(product.price), stock: product.stock }))] };
        } catch (err) {
          return { replies: [T(t('admin.quick_add_error', ADMIN_LANG, { message: (err as Error).message }))] };
        }
      }

      case 'ORDERS': {
        const status = arg ? arg.toUpperCase() : undefined;
        const orders = await deps.listAdminOrders(status);
        if (!orders.length) return { replies: [T(t('admin.orders_empty', ADMIN_LANG, { status: status ? ` (${status})` : '' }))] };
        const list = orders
          .slice(0, 10)
          .map((o) => t('admin.orders_line', ADMIN_LANG, { orderNumber: o.orderNumber, status: o.status, customer: o.customerName, currency: o.currency, total: money(o.total) }))
          .join('\n');
        return { replies: [T(t('admin.orders_title', ADMIN_LANG, { status: status ? ` (${status})` : '', list }))] };
      }

      case 'TRACK': {
        if (!arg) return { replies: [T(t('track.prompt', ADMIN_LANG))] };
        const order = await deps.getOrderByNumber(arg);
        if (!order) return { replies: [T(t('admin.track_not_found', ADMIN_LANG, { orderNumber: arg }))] };
        return { replies: [T(orderSummary(order, ADMIN_LANG))] };
      }

      case 'APPROVE': {
        if (!arg) return { replies: [T(t('admin.help', ADMIN_LANG))] };
        const note = parts.slice(2).join(' ');
        const res = await deps.approveOrder(arg, note);
        if (!res.ok) return { replies: [T(res.error ?? t('admin.approve_wrong_status', ADMIN_LANG, { orderNumber: arg, status: '?' }))] };
        deps.log('admin.approve', { orderNumber: arg });
        return { replies: [T(t('admin.approve_success', ADMIN_LANG, { orderNumber: arg }))] };
      }

      case 'REJECT': {
        if (!arg) return { replies: [T(t('admin.help', ADMIN_LANG))] };
        const reason = parts.slice(2).join(' ') || 'No reason provided';
        const res = await deps.rejectOrder(arg, reason);
        if (!res.ok) return { replies: [T(res.error ?? t('admin.not_found', ADMIN_LANG, { orderNumber: arg }))] };
        deps.log('admin.reject', { orderNumber: arg, reason });
        return { replies: [T(t('admin.reject_success', ADMIN_LANG, { orderNumber: arg }))] };
      }

      case 'PAY': {
        if (!arg) return { replies: [T(t('admin.help', ADMIN_LANG))] };
        const res = await deps.requestPayment(arg);
        if (!res.ok) return { replies: [T(res.error ?? t('admin.not_found', ADMIN_LANG, { orderNumber: arg }))] };
        deps.log('admin.request_payment', { orderNumber: arg });
        return { replies: [T(t('admin.pay_success', ADMIN_LANG, { orderNumber: arg }))] };
      }

      case 'CONFIRM_PAYMENT': {
        if (!arg) return { replies: [T(t('admin.help', ADMIN_LANG))] };
        const method = parts[2] || 'manual';
        const reference = parts.slice(3).join(' ') || 'N/A';
        const res = await deps.confirmPayment(arg, method, reference);
        if (!res.ok) return { replies: [T(res.error ?? t('admin.not_found', ADMIN_LANG, { orderNumber: arg }))] };
        deps.log('admin.confirm_payment', { orderNumber: arg, method });
        return { replies: [T(t('admin.confirm_success', ADMIN_LANG, { orderNumber: arg, method, ref: reference }))] };
      }

      case 'DELIVER': {
        if (!arg) return { replies: [T(t('admin.help', ADMIN_LANG))] };
        const note = parts.slice(2).join(' ');
        const res = await deps.deliverOrder(arg, note);
        if (!res.ok) return { replies: [T(res.error ?? t('admin.deliver_wrong_status', ADMIN_LANG, { orderNumber: arg, status: '?' }))] };
        deps.log('admin.deliver', { orderNumber: arg });
        return { replies: [T(t('admin.deliver_success', ADMIN_LANG, { orderNumber: arg }))] };
      }

      case 'PRODUCTS': {
        const products = await deps.listProducts();
        if (!products.length) return { replies: [T(t('admin.products_empty', ADMIN_LANG))] };
        const list = products
          .map((p, i) => t('admin.products_line', ADMIN_LANG, { i: i + 1, name: p.name, currency: p.currency, price: money(p.price) }))
          .join('\n');
        return { replies: [T(t('admin.products_title', ADMIN_LANG, { list }))] };
      }

      default:
        return null; // not an admin command
    }
  } catch (err) {
    deps.log('admin.error', { cmd, message: (err as Error).message });
    return { replies: [T(t('admin.error', ADMIN_LANG, { message: (err as Error).message }))] };
  }
}
