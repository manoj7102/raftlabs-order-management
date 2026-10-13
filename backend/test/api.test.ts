import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MENU } from '../src/menu';
import { OrderStore } from '../src/order-store';

const customer = {
  name: 'Aarav Sharma',
  address: '12 Park Street, New Delhi',
  phone: '9876543210',
};

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  rawBody?: string;
}

interface ApiResponse {
  status: number;
  // The tests assert the JSON shape returned at this HTTP boundary.
  body: any;
}

async function testApi() {
  const store = new OrderStore(MENU, false);
  const app = createApp(store);

  return async (path: string, options: RequestOptions = {}): Promise<ApiResponse> => {
    const payload = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const socket = new PassThrough();
    const request = new IncomingMessage(socket as unknown as Socket);
    request.method = options.method ?? 'GET';
    request.url = path;
    request.headers = {
      host: 'localhost',
      ...(payload === undefined ? {} : {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
      }),
    };
    if (payload !== undefined) request.push(Buffer.from(payload));
    request.push(null);

    const response = new ServerResponse(request);
    response.assignSocket(socket as unknown as Socket);
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));

    await new Promise<void>((resolve, reject) => {
      response.once('finish', resolve);
      response.once('error', reject);
      app(request, response);
    });

    const raw = Buffer.concat(chunks).toString('utf8');
    socket.destroy();
    const separator = raw.indexOf('\r\n\r\n');
    if (separator < 0) throw new Error('Expected an HTTP response.');
    return { status: response.statusCode, body: JSON.parse(raw.slice(separator + 4)) };
  };
}

describe('order API', () => {
  it('serves a menu with usable image data', async () => {
    const api = await testApi();
    const response = await api('/api/menu');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(MENU.length);
    expect(response.body[0]).toMatchObject({
      id: 'margherita-pizza',
      name: 'Margherita Pizza',
      price: 349,
    });
    expect(response.body[0].image).toMatch(/^data:image\/svg\+xml,/);
    expect(response.body.every((item: { description: string }) => item.description.length > 0)).toBe(true);
  });

  it('creates an order using menu prices, then reads and lists it', async () => {
    const api = await testApi();
    const created = await api('/api/orders', {
      method: 'POST',
      body: {
        customer: { ...customer, name: '  Aarav Sharma  ' },
        items: [
          { menuItemId: 'margherita-pizza', quantity: 2, price: 1 },
          { menuItemId: 'chocolate-brownie', quantity: 1 },
        ],
      },
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      customer,
      status: 'Received',
      total: 847,
      subtotal: 847,
      items: [
        { menuItemId: 'margherita-pizza', name: 'Margherita Pizza', quantity: 2, price: 349, lineTotal: 698 },
        { menuItemId: 'chocolate-brownie', quantity: 1, price: 149, lineTotal: 149 },
      ],
    });
    expect(created.body.id).toEqual(expect.any(String));
    expect(new Date(created.body.createdAt).toISOString()).toBe(created.body.createdAt);

    const read = await api(`/api/orders/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);

    const list = await api('/api/orders');
    expect(list.status).toBe(200);
    expect(list.body).toEqual([created.body]);
  });

  it.each([
    ['missing customer', { items: [{ menuItemId: 'margherita-pizza', quantity: 1 }] }, 'customer'],
    ['blank name', { customer: { ...customer, name: ' ' }, items: [{ menuItemId: 'margherita-pizza', quantity: 1 }] }, 'customer.name'],
    ['short address', { customer: { ...customer, address: 'x' }, items: [{ menuItemId: 'margherita-pizza', quantity: 1 }] }, 'customer.address'],
    ['invalid phone', { customer: { ...customer, phone: 'call me' }, items: [{ menuItemId: 'margherita-pizza', quantity: 1 }] }, 'customer.phone'],
    ['short phone', { customer: { ...customer, phone: '987654321' }, items: [{ menuItemId: 'margherita-pizza', quantity: 1 }] }, 'customer.phone'],
    ['long phone', { customer: { ...customer, phone: '98765432101' }, items: [{ menuItemId: 'margherita-pizza', quantity: 1 }] }, 'customer.phone'],
    ['country code phone', { customer: { ...customer, phone: '+91 9876543210' }, items: [{ menuItemId: 'margherita-pizza', quantity: 1 }] }, 'customer.phone'],
    ['empty cart', { customer, items: [] }, 'items'],
    ['unknown item', { customer, items: [{ menuItemId: 'not-on-menu', quantity: 1 }] }, 'items[0].menuItemId'],
    ['fractional quantity', { customer, items: [{ menuItemId: 'margherita-pizza', quantity: 1.5 }] }, 'items[0].quantity'],
    ['zero quantity', { customer, items: [{ menuItemId: 'margherita-pizza', quantity: 0 }] }, 'items[0].quantity'],
    ['duplicate item', { customer, items: [{ menuItemId: 'margherita-pizza', quantity: 1 }, { menuItemId: 'margherita-pizza', quantity: 2 }] }, 'items[1].menuItemId'],
  ])('rejects %s', async (_case, body, field) => {
    const api = await testApi();
    const response = await api('/api/orders', { method: 'POST', body });
    expect(response.status).toBe(400);
    expect(response.body.field).toBe(field);
    expect(response.body.error).toEqual(expect.any(String));
    expect((await api('/api/orders')).body).toEqual([]);
  });

  it('allows only ordered status changes and returns useful errors', async () => {
    const api = await testApi();
    const created = await api('/api/orders', {
      method: 'POST',
      body: { customer, items: [{ menuItemId: 'fresh-salad', quantity: 1 }] },
    });
    expect(created.status).toBe(201);
    const path = `/api/orders/${created.body.id}/status`;

    const skipped = await api(path, { method: 'PATCH', body: { status: 'Out for Delivery' } });
    expect(skipped.status).toBe(409);
    expect(skipped.body.currentStatus).toBe('Received');

    const preparing = await api(path, { method: 'PATCH', body: { status: 'Preparing' } });
    expect(preparing.status).toBe(200);
    expect(preparing.body.status).toBe('Preparing');
    expect((await api(path, { method: 'PATCH', body: { status: 'Preparing' } })).body).toEqual(preparing.body);

    const out = await api(path, { method: 'PATCH', body: { status: 'Out for Delivery' } });
    expect(out.status).toBe(200);
    expect(out.body.status).toBe('Out for Delivery');
    const backwards = await api(path, { method: 'PATCH', body: { status: 'Received' } });
    expect(backwards.status).toBe(409);
    expect(backwards.body.currentStatus).toBe('Out for Delivery');
    expect((await api(`/api/orders/${created.body.id}`)).body.status).toBe('Out for Delivery');

    const invalid = await api(path, { method: 'PATCH', body: { status: 'Delivered' } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.field).toBe('status');
    expect((await api('/api/orders/nonexistent')).status).toBe(404);
    expect((await api('/api/orders/nonexistent/status', { method: 'PATCH', body: { status: 'Preparing' } })).status).toBe(404);
  });

  it('returns JSON for malformed requests and missing routes', async () => {
    const api = await testApi();
    const malformed = await api('/api/orders', { method: 'POST', rawBody: '{bad' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe('Invalid JSON body.');
    const missing = await api('/api/missing');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('Route not found.');
  });
});
