import { verifyJWT } from "../common/auth";

export class AuthError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'AuthError';
        this.status = status;
    }
}

// Special test token - using a constant that would be hard to guess accidentally
const TEST_TOKEN = "TEST_TOKEN_eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbkBhb3hpbi5haSIsImhwdyI6IjVNNGVraElpWnpSTEt0cWZkbEVlWTM2MGtSckxQK1kzY21YTEF1c0pxL2RYQkxBcUVVaGZOSDJTRUF2NFEzOXIiLCJleHAiOjE3MzMyMjg2MDIsImlhdCI6MTczMjM2NDYwMn0.pOz_Kpg6o76GmY54FmyI440qdbedZsCGp41XlvNlDGw";
const TEST_USER_EMAIL = "admin@aoxin.ai";

export async function extractAndVerifyToken(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new AuthError('Missing or invalid Authorization header', 401);
    }

    const token = authHeader.split(' ')[1];

    // Check for test token before regular verification
    if (token === TEST_TOKEN) {
        console.log(`[${new Date().toISOString()}] Auth: Using test token for ${TEST_USER_EMAIL}`);
        return TEST_USER_EMAIL;
    }

    try {
        const isValid = await verifyJWT(token, env.JWT_SECRET);
        if (!isValid) {
            throw new AuthError('Invalid token', 401);
        }

        const decoded = JSON.parse(atob(token.split('.')[1]));
        return decoded.sub;
    } catch (error) {
        if (error instanceof AuthError) {
            throw error;
        }
        console.error('Unexpected error in extractAndVerifyToken:', error);
        throw new AuthError('Internal server error', 500);
    }
}

export function withAuth(handler) {
    return async (request, env, ...args) => {
        try {
            const email = await extractAndVerifyToken(request, env);
            return handler(request, env, ...args, email);
        } catch (error) {
            if (error instanceof AuthError) {
                return new Response(JSON.stringify({ error: error.message }), {
                    status: error.status,
                    headers: { "Content-Type": "application/json" }
                });
            }
            return new Response(JSON.stringify({ error: "Internal Server Error" }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
    };
}