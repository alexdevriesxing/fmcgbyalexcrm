import app from './index';
import { registerBusinessRoutes } from './business-routes';
import { registerCommercialRoutes } from './commercial-routes';

registerBusinessRoutes(app);
registerCommercialRoutes(app);

export default app;
