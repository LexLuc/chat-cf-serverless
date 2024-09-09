import { verifyJWT } from "../common/auth";

export class AuthError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'AuthError';
        this.status = status;
    }
}

export async function extractAndVerifyToken(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new AuthError('Missing or invalid Authorization header', 401);
    }

    const token = authHeader.split(' ')[1];
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
    return async (request, env) => {
        try {
            const username = await extractAndVerifyToken(request, env);
            return handler(request, env, username);
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