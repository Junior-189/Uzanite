import { t } from './i18n';
import { CartItem, FlowDeps, FlowResult, FlowState, ProductView, Reply, ReplyListSection, STEPS } from './types';

const money = (n: number): string => Number(n ?? 0).toLocaleString('en-US');
const lang = (state: FlowState): string => state.language || 'sw';
const upper = (text: string): string => text.toUpperCase().trim();

const T = (text: string): Reply => ({ text });
const BTN = (text: string, buttons: Array<{ id: string; title: string }>, footer?: string): Reply => ({ text, buttons, footer });
const LIST = (text: string, buttonText: string, sections: ReplyListSection[], footer?: string): Reply => ({ text, list: { buttonText, sections }, footer });

function languageReply(): Reply {
  return BTN(t('language.select', 'sw'), [
    { id: '1', title: 'English' },
    { id: '2', title: 'Kiswahili' },
  ]);
}

function mainMenuReply(deps: FlowDeps, state: FlowState): Reply {
  return LIST(t('menu.title', lang(state), { businessName: deps.businessName }), t('menu.button', lang(state)), [
    {
      title: t('menu.section', lang(state)),
      rows: [
        { id: '1', title: t('menu.browse', lang(state)) },
        { id: '2', title: t('menu.orders', lang(state)) },
        { id: '3', title: t('menu.track', lang(state)) },
        { id: '4', title: t('menu.contact', lang(state)) },
        { id: '5', title: t('menu.language', lang(state)) },
      ],
    },
  ]);
}

function formatProductsText(products: ProductView[]): string {
  return products.map((p, i) => `${i + 1}. ${p.name} - ${p.currency} ${money(p.price)} (stock ${p.stock})`).join('\n');
}

function browseReply(products: ProductView[], state: FlowState): Reply {
  const body = t('browse.title', lang(state), { list: formatProductsText(products) });
  // A list message fits at most 10 rows; fall back to text when there are more.
  if (products.length > 9) return T(body);
  const rows: Array<{ id: string; title: string; description?: string }> = products.map((p, i) => ({
    id: String(i + 1),
    title: p.name.slice(0, 24),
    description: `${p.currency} ${money(p.price)} · stock ${p.stock}`.slice(0, 72),
  }));
  rows.push({ id: 'CART', title: t('browse.cart', lang(state)) });
  return LIST(body, t('browse.button', lang(state)), [{ title: t('browse.section', lang(state)), rows }]);
}

function formatCartText(cart: CartItem[], state: FlowState): string {
  const items = cart.map((i) => `• ${i.productName} x${i.quantity} = ${i.currency} ${money(i.subtotal)}`).join('\n');
  const total = cart.reduce((sum, i) => sum + i.subtotal, 0);
  return `${items}\n\n${t('cart.total_label', lang(state), { currency: cart[0]?.currency || 'TZS', total: money(total) })}`;
}

function cartReply(cart: CartItem[], state: FlowState): Reply {
  if (!cart.length) return T(t('cart.empty', lang(state)));
  return LIST(formatCartText(cart, state), t('cart.button', lang(state)), [
    {
      title: t('cart.section', lang(state)),
      rows: [
        { id: '1', title: t('cart.checkout', lang(state)) },
        { id: '2', title: t('cart.add_more', lang(state)) },
        { id: '3', title: t('cart.clear', lang(state)) },
        { id: '0', title: t('global.menu', lang(state)) },
      ],
    },
  ]);
}

/** Customer conversation flow. Mirrors the legacy Express `customerFlow` steps. */
export async function handleCustomerFlow(deps: FlowDeps, state: FlowState, rawText: string): Promise<FlowResult> {
  const text = rawText.trim();
  const up = upper(text);

  // ── Language selection ──
  if (!state.language) {
    if (up === '1') {
      state.language = 'en';
      return { language: 'en', step: STEPS.MAIN_MENU, replies: [T(t('language.selected', 'en')), mainMenuReply(deps, state)] };
    }
    if (up === '2') {
      state.language = 'sw';
      return { language: 'sw', step: STEPS.MAIN_MENU, replies: [T(t('language.selected', 'sw')), mainMenuReply(deps, state)] };
    }
    return { replies: [languageReply()] };
  }

  // ── Global shortcuts ──
  if (['MENU', '0', 'HOME'].includes(up)) {
    return { step: STEPS.MAIN_MENU, cart: state.cart, context: {}, replies: [mainMenuReply(deps, state)] };
  }
  if (up.startsWith('TRACK ')) {
    const orderNumber = text.slice(6).trim();
    const order = await deps.getOrderByNumber(orderNumber);
    if (!order) return { replies: [T(t('track.not_found', lang(state), { orderNumber }))] };
    return { replies: [T(orderSummary(order, lang(state)))] };
  }

  // ── Payment proof (explicit step, or an unrecognised reference at the menu) ──
  if (state.step === STEPS.AWAITING_PAYMENT_PROOF) {
    const submitted = await trySubmitProof(deps, state, text);
    if (submitted) return submitted;
    return { step: STEPS.MAIN_MENU, context: {}, replies: [T(t('payment.no_pending', lang(state))), mainMenuReply(deps, state)] };
  }

  switch (state.step) {
    case STEPS.BROWSE_PRODUCTS:
      return browse(deps, state, text, up);
    case STEPS.PRODUCT_DETAIL:
      return productDetail(deps, state, text);
    case STEPS.CART:
      return cart(deps, state, text);
    case STEPS.CHECKOUT_NAME:
      return checkoutName(deps, state, text);
    case STEPS.CHECKOUT_LOCATION:
      return checkoutLocation(deps, state, text);
    case STEPS.CHECKOUT_PHONE:
      return checkoutPhone(deps, state, text);
    case STEPS.CHECKOUT_OFFER:
      return checkoutOffer(deps, state, text, up);
    case STEPS.MY_ORDERS:
      return myOrders(deps, state);
    case STEPS.MAIN_MENU:
    default:
      return mainMenuStep(deps, state, text);
  }
}

async function trySubmitProof(deps: FlowDeps, state: FlowState, text: string): Promise<FlowResult | null> {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 30 || !/^[A-Za-z0-9\s-]+$/.test(trimmed)) return null;

  const pendingNumber = state.context.pendingOrderNumber ? String(state.context.pendingOrderNumber) : '';
  let order = pendingNumber ? await deps.getOrderByNumber(pendingNumber) : null;
  if (!order) order = await deps.findPaymentPendingOrder();
  if (!order) return null;

  const res = await deps.submitPaymentProof(order.orderNumber, trimmed);
  if (!res.ok) return null;

  deps.log('payment.proof_submitted', { orderNumber: order.orderNumber });
  return {
    step: STEPS.MAIN_MENU,
    context: {},
    replies: [T(t('payment.waiting', lang(state), { ref: trimmed, orderNumber: order.orderNumber })), mainMenuReply(deps, state)],
  };
}

async function mainMenuStep(deps: FlowDeps, state: FlowState, text: string): Promise<FlowResult> {
  switch (text) {
    case '1':
      return browseStep(deps, state);
    case '2':
      return myOrders(deps, state, STEPS.MY_ORDERS);
    case '3':
      return { step: STEPS.MAIN_MENU, replies: [T(t('track.prompt', lang(state)))] };
    case '4':
      return { replies: [T(t('contact.title', lang(state), { businessName: deps.businessName, phone: deps.businessPhone })), mainMenuReply(deps, state)] };
    case '5':
      return { step: STEPS.LANGUAGE_SELECT, replies: [languageReply()] };
    default: {
      // A free-form message at the menu may be a payment reference.
      const submitted = await trySubmitProof(deps, state, text);
      if (submitted) return submitted;
      return { replies: [mainMenuReply(deps, state)] };
    }
  }
}

async function browseStep(deps: FlowDeps, state: FlowState): Promise<FlowResult> {
  const products = await deps.listProducts();
  return { step: STEPS.BROWSE_PRODUCTS, replies: [browseReply(products, state)] };
}

async function browse(deps: FlowDeps, state: FlowState, text: string, up: string): Promise<FlowResult> {
  if (up === 'CART') return { step: STEPS.CART, replies: [cartReply(state.cart, state)] };

  const products = await deps.listProducts();
  const index = parseInt(text, 10) - 1;
  if (Number.isNaN(index) || index < 0 || index >= products.length) {
    return { replies: [T(t('browse.invalid', lang(state), { max: products.length }))] };
  }
  const product = products[index];
  state.context = { ...state.context, productId: product.id };

  const negotiable = product.minPrice ? `\n${t('product.negotiable', lang(state), { min: money(product.minPrice), currency: product.currency })}` : '';
  const detail = t('product.detail', lang(state), {
    name: product.name,
    description: (product.description || '-') + negotiable,
    currency: product.currency,
    price: money(product.price),
    stock: product.stock,
  });
  return { step: STEPS.PRODUCT_DETAIL, context: { ...state.context }, replies: [BTN(detail, [{ id: '0', title: t('global.back', lang(state)) }])] };
}

async function productDetail(deps: FlowDeps, state: FlowState, text: string): Promise<FlowResult> {
  const up = upper(text);
  if (up === 'BACK' || up === '0') return browseStep(deps, state);

  const qty = parseInt(text, 10);
  if (Number.isNaN(qty) || qty < 1) return { replies: [T(t('product.invalid_qty', lang(state)))] };

  const productId = String(state.context.productId ?? '');
  const product = await deps.getProduct(productId);
  if (!product) {
    return { step: STEPS.MAIN_MENU, cart: [], context: {}, replies: [T(t('product.not_found', lang(state)))] };
  }
  if (qty > product.stock) return { replies: [T(t('product.out_of_stock', lang(state), { stock: product.stock }))] };

  const existing = state.cart.find((c) => c.productId === product.id);
  let cart: CartItem[];
  if (existing) {
    cart = state.cart.map((c) => (c.productId === product.id ? { ...c, quantity: c.quantity + qty, subtotal: c.price * (c.quantity + qty) } : c));
  } else {
    cart = [
      ...state.cart,
      {
        productId: product.id,
        productName: product.name,
        price: product.price,
        minPrice: product.minPrice || 0,
        currency: product.currency,
        quantity: qty,
        subtotal: product.price * qty,
      },
    ];
  }
  const added = t('cart.added', lang(state), { name: product.name, qty, menu: '' });
  return { step: STEPS.CART, cart, replies: [T(added), cartReply(cart, state)] };
}

async function cart(deps: FlowDeps, state: FlowState, text: string): Promise<FlowResult> {
  switch (text) {
    case '1':
      if (!state.cart.length) return { replies: [T(t('cart.empty_checkout', lang(state)))] };
      return { step: STEPS.CHECKOUT_NAME, context: {}, replies: [T(t('checkout.name_prompt', lang(state)))] };
    case '2':
      return browseStep(deps, state);
    case '3':
      return { step: STEPS.MAIN_MENU, cart: [], replies: [T(t('cart.cleared', lang(state))), mainMenuReply(deps, state)] };
    case '0':
      return { step: STEPS.MAIN_MENU, cart: [], context: {}, replies: [mainMenuReply(deps, state)] };
    default:
      return { replies: [cartReply(state.cart, state)] };
  }
}

async function checkoutName(deps: FlowDeps, state: FlowState, text: string): Promise<FlowResult> {
  const name = text.trim();
  if (name.length < 2) return { replies: [T(t('checkout.name_invalid', lang(state)))] };

  const outOfStock: string[] = [];
  for (const item of state.cart) {
    const product = await deps.getProduct(item.productId);
    if (product && product.stock === 0) outOfStock.push(item.productName);
  }
  if (outOfStock.length) {
    return { step: STEPS.MAIN_MENU, cart: [], context: {}, replies: [T(t('checkout.out_of_stock', lang(state), { items: outOfStock.map((n) => `• ${n}`).join('\n') })), mainMenuReply(deps, state)] };
  }

  return { step: STEPS.CHECKOUT_LOCATION, context: { ...state.context, customerName: name }, replies: [T(t('checkout.location_prompt', lang(state)))] };
}

async function checkoutLocation(deps: FlowDeps, state: FlowState, text: string): Promise<FlowResult> {
  const location = text.trim();
  if (location.length < 3) return { replies: [T(t('checkout.location_invalid', lang(state)))] };
  return { step: STEPS.CHECKOUT_PHONE, context: { ...state.context, deliveryLocation: location }, replies: [T(t('checkout.phone_prompt', lang(state)))] };
}

async function checkoutPhone(deps: FlowDeps, state: FlowState, text: string): Promise<FlowResult> {
  const phone = text.trim().replace(/\D/g, '');
  if (phone.length < 5) return { replies: [T(t('checkout.phone_invalid', lang(state)))] };

  const hasNegotiable = state.cart.some((i) => i.minPrice > 0);
  if (hasNegotiable) {
    const total = state.cart.reduce((s, i) => s + i.subtotal, 0);
    const minTotal = state.cart.reduce((s, i) => s + (i.minPrice || 0) * i.quantity, 0);
    const prompt = t('checkout.offer_prompt', lang(state), { total: money(total), currency: state.cart[0]?.currency || 'TZS', minTotal: money(minTotal) });
    return { step: STEPS.CHECKOUT_OFFER, context: { ...state.context, deliveryPhone: phone, originalTotal: total, minTotal }, replies: [T(prompt)] };
  }

  return completeOrder(deps, state, phone, undefined);
}

async function checkoutOffer(deps: FlowDeps, state: FlowState, text: string, up: string): Promise<FlowResult> {
  const { deliveryPhone, originalTotal, minTotal } = state.context as { deliveryPhone: string; originalTotal: number; minTotal: number };
  if (up === 'NO' || up === '0') return completeOrder(deps, state, deliveryPhone, originalTotal);

  const offer = parseFloat(text.trim());
  if (Number.isNaN(offer) || offer < 0) return { replies: [T(t('checkout.offer_invalid', lang(state)))] };
  if (offer < minTotal) return { replies: [T(t('checkout.offer_too_low', lang(state), { minTotal: money(minTotal), currency: state.cart[0]?.currency || 'TZS' }))] };

  return completeOrder(deps, state, deliveryPhone, Math.min(offer, originalTotal));
}

async function completeOrder(deps: FlowDeps, state: FlowState, deliveryPhone: string, offeredTotal?: number): Promise<FlowResult> {
  const customerName = String(state.context.customerName ?? 'Customer');
  const deliveryLocation = String(state.context.deliveryLocation ?? '');

  const order = await deps.createOrder({
    customerName,
    customerPhone: deps.phone,
    deliveryLocation,
    deliveryPhone,
    items: state.cart.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    offeredTotal,
  });
  deps.log('order.created', { orderNumber: order.orderNumber, total: order.total });

  return {
    step: STEPS.MAIN_MENU,
    cart: [],
    context: {},
    replies: [
      T(
        t('checkout.success', lang(state), {
          name: customerName,
          orderNumber: order.orderNumber,
          currency: order.currency,
          total: money(order.total),
        })
      ),
      mainMenuReply(deps, state),
    ],
  };
}

async function myOrders(deps: FlowDeps, state: FlowState, nextStep: string = STEPS.MAIN_MENU): Promise<FlowResult> {
  const orders = await deps.listCustomerOrders();
  if (!orders.length) {
    const products = await deps.listProducts();
    return { step: STEPS.BROWSE_PRODUCTS, replies: [T(t('my_orders.empty', lang(state), { list: formatProductsText(products) }))] };
  }
  const list = orders
    .slice(0, 5)
    .map((o, i) => t('my_orders.line', lang(state), { i: i + 1, orderNumber: o.orderNumber, status: o.status, currency: o.currency, total: money(o.total) }))
    .join('\n');
  return { step: nextStep, replies: [T(t('my_orders.title', lang(state), { list })), mainMenuReply(deps, state)] };
}

export function orderSummary(
  order: { orderNumber: string; status: string; currency: string; total: number; customerName: string; items: Array<{ productName: string; quantity: number; subtotal: number }> },
  _language: string
): string {
  const items = order.items.map((i) => `  • ${i.productName} x${i.quantity} = ${order.currency} ${money(i.subtotal)}`).join('\n');
  return `Order ${order.orderNumber}\nStatus: ${order.status}\nCustomer: ${order.customerName}\n${items}\nTotal: ${order.currency} ${money(order.total)}`;
}
