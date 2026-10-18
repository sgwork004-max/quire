import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { createAuth, type Auth } from "./auth";
import { emailEnabled, googleEnabled, type Env } from "./env";
import { devicePage, homePage, privacyPage } from "./pages";
import { live, sharing } from "./sharing";
import { comments, notifications } from "./comments";

export { DocRoom } from "./room";

type Vars = { auth: Auth; user: { id: string; name: string; email: string; image?: string | null } | null };
type AppEnv = { Bindings: Env; Variables: Vars };

const app = new Hono<AppEnv>();

// One auth instance per request: bindings are per-request on Workers.
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  c.set("auth", createAuth(c.env, url.origin));
  await next();
});

// The desktop app talks to the API with a Bearer token, not cookies, so CORS
// only needs to allow the app's own origins.
app.use(
  "/api/*",
  cors({
    origin: ["tauri://localhost", "http://tauri.localhost", "http://localhost:1420"],
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["set-auth-token"],
  }),
);

app.get("/", (c) => (c.req.header("accept")?.includes("text/html") ? c.html(homePage()) : c.json({ name: "Quire Cloud", ok: true })));
app.get("/privacy", (c) => c.html(privacyPage()));

app.on(["GET", "POST"], "/api/auth/*", (c) => c.get("auth").handler(c.req.raw));

app.get("/device", (c) =>
  c.html(devicePage({ userCode: c.req.query("user_code") ?? "", google: googleEnabled(c.env), email: emailEnabled(c.env) })),
);

// ---------------------------------------------------------------- profile

const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Not signed in" }, 401);
  c.set("user", session.user);
  await next();
});

app.get("/api/me", requireUser, (c) => {
  const u = c.get("user")!;
  return c.json({ id: u.id, name: u.name, email: u.email, image: u.image ?? null });
});

app.patch("/api/me", requireUser, async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const name = body.name?.trim();
  if (!name || name.length > 80) return c.json({ error: "Name must be 1–80 characters" }, 400);
  await c.get("auth").api.updateUser({ headers: c.req.raw.headers, body: { name } });
  const u = c.get("user")!;
  return c.json({ id: u.id, name, email: u.email, image: u.image ?? null });
});

app.use("/api/documents/*", requireUser);
app.use("/api/documents", requireUser);
app.route("/api/documents", comments);
app.route("/api/documents", sharing);
app.use("/api/notifications/*", requireUser);
app.use("/api/notifications", requireUser);
app.route("/api/notifications", notifications);
app.get("/live/:id", live);

export default app;
