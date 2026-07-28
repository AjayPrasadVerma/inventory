import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/error.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { customersRouter } from './modules/customers/customers.routes.js';
import { itemsRouter } from './modules/items/items.routes.js';
import { jobsRouter } from './modules/jobs/jobs.routes.js';
import { karigarsRouter } from './modules/karigars/karigars.routes.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';
import { productsRouter } from './modules/products/products.routes.js';
import { purchasesRouter } from './modules/purchases/purchases.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { salesRouter } from './modules/sales/sales.routes.js';
import { vendorsRouter } from './modules/vendors/vendors.routes.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'diamond-box-wala', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/vendors', vendorsRouter);
  app.use('/api/karigars', karigarsRouter);
  app.use('/api/items', itemsRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/purchases', purchasesRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/reports', reportsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
