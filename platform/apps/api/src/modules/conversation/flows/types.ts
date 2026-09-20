// Transport-agnostic conversation flow types. Flows are pure over `FlowDeps`
// (data + domain actions) and return reply text; they never touch Meta.

export interface CartItem {
  productId: string;
  productName: string;
  price: number;
  minPrice: number;
  currency: string;
  quantity: number;
  subtotal: number;
}

export interface ProductView {
  id: string;
  name: string;
  description: string;
  price: number;
  minPrice: number;
  currency: string;
  stock: number;
  active: boolean;
}

export interface OrderItemView {
  productName: string;
  quantity: number;
  subtotal: number;
}

export interface OrderView {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  total: number;
  customerName: string;
  createdAt: string;
  items: OrderItemView[];
}

export interface FlowState {
  tenantId: string;
  phone: string;
  step: string;
  language: string; // '' until chosen
  cart: CartItem[];
  context: Record<string, unknown>;
}

export interface ReplyButton {
  id: string;
  title: string;
}
export interface ReplyListRow {
  id: string;
  title: string;
  description?: string;
}
export interface ReplyListSection {
  title: string;
  rows: ReplyListRow[];
}
/** A single outbound reply. `text` is the body; `buttons`/`list` make it interactive. */
export interface Reply {
  text: string;
  buttons?: ReplyButton[];
  list?: { buttonText: string; sections: ReplyListSection[] };
  footer?: string;
}

export interface FlowResult {
  step?: string;
  language?: string;
  cart?: CartItem[];
  context?: Record<string, unknown>;
  replies: Reply[];
}

export interface CreateOrderInput {
  customerName: string;
  customerPhone: string;
  deliveryLocation: string;
  deliveryPhone: string;
  items: Array<{ productId: string; quantity: number }>;
  offeredTotal?: number;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  order?: OrderView;
}

export interface FlowDeps {
  tenantId: string;
  phone: string;
  businessName: string;
  businessPhone: string;
  listProducts(): Promise<ProductView[]>;
  getProduct(id: string): Promise<ProductView | null>;
  createOrder(input: CreateOrderInput): Promise<OrderView>;
  createProduct(input: { name: string; description: string; price: number; stock: number }): Promise<ProductView>;
  listCustomerOrders(): Promise<OrderView[]>;
  getOrderByNumber(orderNumber: string): Promise<OrderView | null>;
  /** The customer's order awaiting a payment reference (APPROVED), if any. */
  findPaymentPendingOrder(): Promise<OrderView | null>;
  submitPaymentProof(orderNumber: string, reference: string): Promise<ActionResult>;
  listAdminOrders(status?: string): Promise<OrderView[]>;
  approveOrder(orderNumber: string, note: string): Promise<ActionResult>;
  rejectOrder(orderNumber: string, reason: string): Promise<ActionResult>;
  requestPayment(orderNumber: string): Promise<ActionResult>;
  confirmPayment(orderNumber: string, method: string, reference: string): Promise<ActionResult>;
  deliverOrder(orderNumber: string, note: string): Promise<ActionResult>;
  log(decision: string, data?: Record<string, unknown>): void;
}

export const STEPS = {
  LANGUAGE_SELECT: 'LANGUAGE_SELECT',
  MAIN_MENU: 'MAIN_MENU',
  BROWSE_PRODUCTS: 'BROWSE_PRODUCTS',
  PRODUCT_DETAIL: 'PRODUCT_DETAIL',
  CART: 'CART',
  CHECKOUT_NAME: 'CHECKOUT_NAME',
  CHECKOUT_LOCATION: 'CHECKOUT_LOCATION',
  CHECKOUT_PHONE: 'CHECKOUT_PHONE',
  CHECKOUT_OFFER: 'CHECKOUT_OFFER',
  MY_ORDERS: 'MY_ORDERS',
  AWAITING_PAYMENT_PROOF: 'AWAITING_PAYMENT_PROOF',
} as const;
