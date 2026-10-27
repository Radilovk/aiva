/**
 * SchoolRating.eu as its own Worker: the static site (frontend/school) and /api/sf, on the same D1 database as the
 * main app. Deploy: npx wrangler deploy -c wrangler.school.jsonc
 */
import { Hono } from 'hono';
import { sf, type SfEnv } from './routes';

const app = new Hono<{ Bindings: SfEnv }>();
app.route('/api/sf', sf);
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
