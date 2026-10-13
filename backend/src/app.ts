import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import { MENU } from './menu';
import { OrderStore } from './order-store';
import { parseOrderRequest, parseStatusRequest, ValidationError } from './validation';

export function createApp(store: OrderStore = new OrderStore()) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '20kb' }));

  app.get('/api/menu', (_request, response) => {
    response.json(MENU);
  });

  app.post('/api/orders', (request, response) => {
    try {
      const { customer, items } = parseOrderRequest(request.body, MENU);
      response.status(201).json(store.createOrder(customer, items));
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      response.status(400).json({ error: error.message, field: error.field });
    }
  });

  app.get('/api/orders', (_request, response) => {
    response.json(store.listOrders());
  });

  app.get('/api/orders/:id', (request, response) => {
    const order = store.getOrder(request.params.id);
    if (!order) {
      response.status(404).json({ error: 'Order not found.' });
      return;
    }
    response.json(order);
  });

  app.patch('/api/orders/:id/status', (request, response) => {
    let status;
    try {
      status = parseStatusRequest(request.body);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      response.status(400).json({ error: error.message, field: error.field });
      return;
    }

    const result = store.updateStatus(request.params.id, status);
    if (result.kind === 'not-found') {
      response.status(404).json({ error: 'Order not found.' });
    } else if (result.kind === 'invalid-transition') {
      response.status(409).json({
        error: `Cannot move from ${result.currentStatus} to ${status}.`,
        currentStatus: result.currentStatus,
      });
    } else {
      response.json(result.order);
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Route not found.' });
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: 'Invalid JSON body.' });
      return;
    }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      response.status(413).json({ error: 'Request body is too large.' });
      return;
    }
    next(error);
  };
  app.use(errorHandler);

  return app;
}
