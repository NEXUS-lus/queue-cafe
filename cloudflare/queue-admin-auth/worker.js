const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;
const PASSWORD_ITERATIONS = 100000;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_BYTES = 256;
const MAX_BODY_BYTES = 4096;

const responseHeaders = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
};

function jsonResponse(body, status = 200, corsHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...responseHeaders,
            "Content-Type": "application/json; charset=utf-8",
            ...corsHeaders
        }
    });
}

function corsHeaders(origin) {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin"
    };
}

function validOrigin(origin, allowedOrigin) {
    if (!origin || !allowedOrigin || origin !== allowedOrigin) return false;
    try {
        const parsed = new URL(origin);
        return parsed.protocol === "https:" && parsed.origin === origin;
    } catch {
        return false;
    }
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get("Origin");
        if (!validOrigin(origin, env.ALLOWED_ORIGIN)) {
            return jsonResponse({ error: "origin_not_allowed" }, 403);
        }

        const headers = corsHeaders(origin);
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: { ...responseHeaders, ...headers } });
        }

        const url = new URL(request.url);
        if (!url.pathname.startsWith("/auth/")) {
            return jsonResponse({ error: "not_found" }, 404, headers);
        }
        if (!["GET", "POST"].includes(request.method)) {
            return jsonResponse({ error: "method_not_allowed" }, 405, headers);
        }
        const contentLength = Number(request.headers.get("Content-Length") || 0);
        if (request.method === "POST" && contentLength > MAX_BODY_BYTES) {
            return jsonResponse({ error: "request_too_large" }, 413, headers);
        }

        const id = env.AUTH_STATE.idFromName("queue-admin-auth");
        const stub = env.AUTH_STATE.get(id);
        const internalUrl = new URL(url.pathname, "https://auth.internal");
        const internalRequest = new Request(internalUrl, request);
        const response = await stub.fetch(internalRequest);
        const responseBody = await response.arrayBuffer();
        return new Response(responseBody, {
            status: response.status,
            headers: { ...responseHeaders, ...headers, "Content-Type": "application/json; charset=utf-8" }
        });
    }
};

export class AuthState {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.queue = Promise.resolve();
    }

    fetch(request) {
        const response = this.queue.then(() => this.handle(request));
        this.queue = response.then(() => undefined, () => undefined);
        return response;
    }

    async handle(request) {
        const url = new URL(request.url);
        try {
            if (request.method === "GET" && url.pathname === "/auth/status") {
                const password = await this.state.storage.get("password");
                return jsonResponse({ configured: Boolean(password) });
            }
            if (request.method === "GET" && url.pathname === "/auth/session") {
                const session = await this.findSession(request);
                return session
                    ? jsonResponse({ authenticated: true })
                    : jsonResponse({ error: "unauthorized" }, 401);
            }
            if (request.method !== "POST") {
                return jsonResponse({ error: "not_found" }, 404);
            }

            const body = await this.readJson(request);
            if (!body) return jsonResponse({ error: "invalid_request" }, 400);
            if (url.pathname === "/auth/setup") return this.setup(request, body);
            if (url.pathname === "/auth/login") return this.login(request, body);
            if (url.pathname === "/auth/change-password") return this.changePassword(request, body);
            if (url.pathname === "/auth/logout") return this.logout(request);
            return jsonResponse({ error: "not_found" }, 404);
        } catch (error) {
            console.error("Authentication request failed.", error);
            return jsonResponse({ error: "internal_error" }, 500);
        }
    }

    async readJson(request) {
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
        try {
            const body = JSON.parse(text);
            return body && typeof body === "object" && !Array.isArray(body) ? body : null;
        } catch {
            return null;
        }
    }

    async setup(request, body) {
        if (await this.state.storage.get("password")) {
            return jsonResponse({ error: "already_configured" }, 409);
        }
        const addressKey = await this.getRateKey(request);
        const rate = await this.checkRateLimit(addressKey);
        if (rate.limited) return this.rateLimited(rate.retryAfter);

        if (
            typeof body.setupKey !== "string" ||
            typeof this.env.BOOTSTRAP_KEY !== "string" ||
            !(await this.constantTimeTextEqual(body.setupKey, this.env.BOOTSTRAP_KEY))
        ) {
            await this.recordFailure(addressKey);
            return jsonResponse({ error: "setup_not_authorized" }, 403);
        }
        if (!this.validPassword(body.password)) {
            return jsonResponse({ error: "weak_password" }, 400);
        }

        const password = await this.hashPassword(body.password);
        await this.state.storage.put("password", password);
        await this.clearRateLimit(addressKey);
        return jsonResponse({ token: await this.createSession() });
    }

    async login(request, body) {
        const addressKey = await this.getRateKey(request);
        const rate = await this.checkRateLimit(addressKey);
        if (rate.limited) return this.rateLimited(rate.retryAfter);

        const password = await this.state.storage.get("password");
        if (!password) return jsonResponse({ error: "setup_required" }, 409);
        if (typeof body.password !== "string" || !(await this.verifyPassword(body.password, password))) {
            await this.recordFailure(addressKey);
            return jsonResponse({ error: "invalid_credentials" }, 401);
        }

        await this.clearRateLimit(addressKey);
        return jsonResponse({ token: await this.createSession() });
    }

    async changePassword(request, body) {
        const session = await this.findSession(request);
        if (!session) return jsonResponse({ error: "unauthorized" }, 401);

        const addressKey = await this.getRateKey(request);
        const rate = await this.checkRateLimit(addressKey);
        if (rate.limited) return this.rateLimited(rate.retryAfter);

        const password = await this.state.storage.get("password");
        if (
            !password ||
            typeof body.currentPassword !== "string" ||
            !(await this.verifyPassword(body.currentPassword, password))
        ) {
            await this.recordFailure(addressKey);
            return jsonResponse({ error: "invalid_credentials" }, 401);
        }
        if (!this.validPassword(body.newPassword)) {
            return jsonResponse({ error: "weak_password" }, 400);
        }

        await this.state.storage.put("password", await this.hashPassword(body.newPassword));
        await this.revokeAllSessions();
        await this.clearRateLimit(addressKey);
        return jsonResponse({ token: await this.createSession() });
    }

    async logout(request) {
        const session = await this.findSession(request);
        if (session) await this.state.storage.delete(`session:${session.key}`);
        return jsonResponse({ loggedOut: true });
    }

    validPassword(password) {
        if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) return false;
        const byteLength = new TextEncoder().encode(password).byteLength;
        return byteLength <= PASSWORD_MAX_BYTES;
    }

    async hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits(
            { name: "PBKDF2", salt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
            key,
            256
        );
        return {
            salt: this.encodeBase64(salt),
            hash: this.encodeBase64(new Uint8Array(bits)),
            iterations: PASSWORD_ITERATIONS
        };
    }

    async verifyPassword(password, record) {
        if (typeof password !== "string" || new TextEncoder().encode(password).byteLength > PASSWORD_MAX_BYTES) {
            password = "";
        }
        const calculated = await this.hashPassword(password, this.decodeBase64(record.salt));
        return this.constantTimeBytesEqual(
            this.decodeBase64(calculated.hash),
            this.decodeBase64(record.hash)
        );
    }

    async constantTimeTextEqual(left, right) {
        const encoder = new TextEncoder();
        const leftHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(left)));
        const rightHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(right)));
        return this.constantTimeBytesEqual(leftHash, rightHash);
    }

    constantTimeBytesEqual(left, right) {
        if (left.length !== right.length) return false;
        let difference = 0;
        for (let index = 0; index < left.length; index += 1) {
            difference |= left[index] ^ right[index];
        }
        return difference === 0;
    }

    encodeBase64(bytes) {
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }

    decodeBase64(value) {
        const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
        const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }

    async createSession() {
        await this.cleanupSessions();
        const sessions = await this.state.storage.list({ prefix: "session:" });
        if (sessions.size >= 20) {
            const oldest = [...sessions.entries()]
                .sort((left, right) => left[1].createdAt - right[1].createdAt)
                .slice(0, sessions.size - 19);
            for (const [key] of oldest) await this.state.storage.delete(key);
        }

        const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
        const token = this.encodeBase64(tokenBytes);
        const key = await this.digestHex(token);
        await this.state.storage.put(`session:${key}`, {
            createdAt: Date.now(),
            expiresAt: Date.now() + SESSION_TTL_MS
        });
        return token;
    }

    async findSession(request) {
        const authorization = request.headers.get("Authorization") || "";
        const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
        if (!match) return null;

        const key = await this.digestHex(match[1]);
        const session = await this.state.storage.get(`session:${key}`);
        if (!session) return null;
        if (session.expiresAt <= Date.now()) {
            await this.state.storage.delete(`session:${key}`);
            return null;
        }
        return { key, ...session };
    }

    async cleanupSessions() {
        const sessions = await this.state.storage.list({ prefix: "session:" });
        const now = Date.now();
        for (const [key, session] of sessions) {
            if (session.expiresAt <= now) await this.state.storage.delete(key);
        }
    }

    async revokeAllSessions() {
        const sessions = await this.state.storage.list({ prefix: "session:" });
        for (const key of sessions.keys()) await this.state.storage.delete(key);
    }

    async digestHex(value) {
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
        return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    async getRateKey(request) {
        const address = request.headers.get("CF-Connecting-IP") || "unknown";
        return `rate:${await this.digestHex(address)}`;
    }

    async checkRateLimit(key) {
        const value = await this.state.storage.get(key);
        if (!value) return { limited: false };
        const now = Date.now();
        if (value.blockedUntil > now) {
            return { limited: true, retryAfter: Math.ceil((value.blockedUntil - now) / 1000) };
        }
        if (value.windowStart + RATE_WINDOW_MS <= now) {
            await this.state.storage.delete(key);
            return { limited: false };
        }
        return { limited: false };
    }

    async recordFailure(key) {
        const now = Date.now();
        const current = await this.state.storage.get(key);
        const failures = !current || current.windowStart + RATE_WINDOW_MS <= now
            ? { windowStart: now, count: 0 }
            : current;
        failures.count += 1;
        if (failures.count >= RATE_LIMIT) {
            failures.blockedUntil = now + RATE_WINDOW_MS;
        }
        await this.state.storage.put(key, failures);
    }

    async clearRateLimit(key) {
        await this.state.storage.delete(key);
    }

    rateLimited(retryAfter) {
        return jsonResponse({ error: "rate_limited", retryAfter }, 429, { "Retry-After": String(retryAfter) });
    }
}
