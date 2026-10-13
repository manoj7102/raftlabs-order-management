import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const menu = [
  { id: 'margherita-pizza', name: 'Margherita Pizza', description: 'Tomato, basil, and mozzarella.', price: 349, image: '' },
  { id: 'fresh-salad', name: 'Fresh Garden Salad', description: 'Crisp greens and seasonal vegetables.', price: 229, image: '' },
];

const order = {
  id: 'test-order-123',
  customer: { name: 'Asha Rao', address: '12 Market Road, Pune', phone: '9876543210' },
  items: [{ menuItemId: 'margherita-pizza', quantity: 1, name: 'Margherita Pizza', price: 349 }],
  total: 349,
  status: 'Received',
  createdAt: '2026-10-13T12:00:00.000Z',
};

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ordering flow', () => {
  it('shows menu items and lets people search the menu', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(menu)));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Margherita Pizza' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fresh Garden Salad' })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search menu' }), 'salad');
    expect(screen.queryByRole('heading', { name: 'Margherita Pizza' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fresh Garden Salad' })).toBeInTheDocument();
  });

  it('updates quantities and submits checkout details once', async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/menu') return jsonResponse(menu);
      if (url === '/api/orders' && init?.method === 'POST') return jsonResponse(order, 201);
      if (url === '/api/orders/test-order-123') return jsonResponse(order);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: 'Margherita Pizza' });
    await user.click(screen.getByRole('button', { name: 'Add Margherita Pizza to cart' }));
    await user.click(screen.getAllByRole('button', { name: 'Add one more Margherita Pizza' })[0]);
    await user.click(screen.getAllByRole('button', { name: 'Remove one Margherita Pizza' })[0]);
    expect(screen.getByRole('button', { name: 'View cart, 1 item' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Continue to checkout/i }));
    const dialog = screen.getByRole('dialog', { name: 'Delivery details' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Full name' }), 'Asha Rao');
    await user.type(within(dialog).getByRole('textbox', { name: 'Phone number' }), '9876543210');
    await user.type(within(dialog).getByRole('textbox', { name: 'Delivery address' }), '12 Market Road, Pune');
    await user.click(within(dialog).getByRole('button', { name: /Place order/i }));

    expect(await screen.findByRole('heading', { name: 'Received' })).toBeInTheDocument();
    expect(requests.filter(({ url }) => url === '/api/orders')).toHaveLength(1);
    expect(requests.find(({ url }) => url === '/api/orders')?.body).toEqual({
      customer: order.customer,
      items: [{ menuItemId: 'margherita-pizza', quantity: 1 }],
    });
    expect(window.localStorage.getItem('hearth-harvest-active-order')).toBe('test-order-123');
  });

  it('shows field errors for an oversized phone and blank address, then accepts corrections', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/menu') return jsonResponse(menu);
      if (url === '/api/orders' && init?.method === 'POST') return jsonResponse(order, 201);
      if (url === '/api/orders/test-order-123') return jsonResponse(order);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: 'Margherita Pizza' });
    await user.click(screen.getByRole('button', { name: 'Add Margherita Pizza to cart' }));
    await user.click(screen.getByRole('button', { name: /Continue to checkout/i }));

    const dialog = screen.getByRole('dialog', { name: 'Delivery details' });
    const name = within(dialog).getByRole('textbox', { name: 'Full name' });
    const phone = within(dialog).getByRole('textbox', { name: 'Phone number' });
    const address = within(dialog).getByRole('textbox', { name: 'Delivery address' });

    await user.type(name, 'A');
    await user.tab();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('Enter a name between 2 and 100 characters.')).toBeInTheDocument();

    await user.clear(name);
    await user.type(name, 'Asha Rao');
    await user.type(phone, '123456789012345678901');
    await user.tab();
    expect(phone).toHaveAttribute('maxLength', '30');
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('Enter a valid phone number with 7 to 15 digits.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Place order/i }));
    expect(address).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('Enter a delivery address between 5 and 300 characters.')).toBeInTheDocument();
    expect(phone).toHaveFocus();
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/orders' && init?.method === 'POST')).toBe(false);

    await user.clear(phone);
    await user.type(phone, '9876543210');
    await user.type(address, '12 Market Road, Pune');
    expect(phone).toHaveAttribute('aria-invalid', 'false');
    expect(address).toHaveAttribute('aria-invalid', 'false');
    await user.click(within(dialog).getByRole('button', { name: /Place order/i }));

    expect(await screen.findByRole('heading', { name: 'Received' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/orders' && init?.method === 'POST')).toHaveLength(1);
  });

  it('retries a failed menu load', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(jsonResponse(menu));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Menu unavailable right now' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Margherita Pizza' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('restores an order and displays its latest status', async () => {
    window.localStorage.setItem('hearth-harvest-active-order', 'test-order-123');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/menu') return jsonResponse(menu);
      if (url === '/api/orders/test-order-123') return jsonResponse({ ...order, status: 'Preparing' });
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Preparing' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Our kitchen is making your food fresh, just for you.')).toBeInTheDocument());
  });
});
