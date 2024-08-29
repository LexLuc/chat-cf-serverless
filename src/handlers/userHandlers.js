/**
 * User Handlers logic
 */

import { sign, verify } from '@tsndr/cloudflare-worker-jwt';


/**
 * Handler for user login.
 * @param {Request} request
 * @param {Object} env
 * @returns {Response} 
 */
export async function handleUserLogin(request, env) {
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
            status: 405, 
            headers: { "Content-Type": "application/json" }
        });
    }

    let data;
    try {
        data = await request.json();
    } catch (error) {
        return new Response(JSON.stringify({ error: "Invalid JSON Body" }), { 
            status: 400, 
            headers: { "Content-Type": "application/json" }
        });
    }

    // Parse the request body
    const { username, plain_pw } = data;

    // Input validation
    if (!username || typeof username !== 'string' || username.length < 2 || username.length > 30) {
        return new Response(JSON.stringify({ error: "Invalid username" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
        });
    }
    if (!plain_pw || typeof plain_pw !== 'string' || plain_pw.length < 8 || plain_pw.length > 30) {
        return new Response(JSON.stringify({ error: "Invalid password" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        // Fetch user from the database
        const user = await env.DB.prepare("SELECT * FROM user_account WHERE username = ?")
            .bind(username)
            .first();
        
        if (!user) {
            return new Response(JSON.stringify({ error: "Invalid username or password" }), { 
                status: 401, 
                headers: { "Content-Type": "application/json" }
            });
        }

        // Verify password
        const isPasswordValid = await verifyPassword(plain_pw, user.hashed_password);

        if (!isPasswordValid) {
            return new Response(JSON.stringify({ error: "Invalid username or password" }), { 
                status: 401, 
                headers: { "Content-Type": "application/json" }
            });
        }

        // Generate JWT
        const token = await generateJWT(user, env.JWT_SECRET);

        return new Response(JSON.stringify({ token }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Error in login:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}

/**
 * Verify the provided password against the stored hashed password.
 * @param {string} password - The plain text password to verify.
 * @param {string} storedHash - The stored hashed password.
 * @returns {boolean} - Whether the password is valid.
 */
async function verifyPassword(password, storedHash) {
    const decoder = new TextDecoder();
    const storedHashBuffer = Uint8Array.from(atob(storedHash), c => c.charCodeAt(0));
    const salt = storedHashBuffer.slice(0, 16);
    const storedDerivedKey = storedHashBuffer.slice(16);

    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const key = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 10000,
            hash: 'SHA-256'
        },
        key,
        256
    );

    const derivedKey = new Uint8Array(derivedBits);

    return crypto.subtle.timingSafeEqual(derivedKey, storedDerivedKey);
}

/**
 * Generate a JWT for the authenticated user.
 * @param {Object} user - The user object.
 * @param {string} secret - The JWT secret.
 * @returns {string} - The generated JWT.
 */
async function generateJWT(user, secret) {
    const payload = {
        sub: user.username,
        yob: user.yob,
        preferred_voice: user.preferred_voice,
        exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour expiration
    };

    return await sign(payload, secret);
}


/**
 * Handler for user registration.
 * @param {Request} request
 * @param {Object} user
 * @returns {Response} 
 */
export async function handleUserRegistration(request, env) {
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
            status: 405, 
            headers: { "Content-Type": "application/json" }
        });
    }

    let data;
    try {
        data = await request.json();
    } catch (error) {
        return new Response(JSON.stringify({ error: "Invalid JSON Body" }), { 
            status: 400, 
            headers: { "Content-Type": "application/json" }
        });
    }

    // Parse the request body
    const { username, plain_pw, yob, voice, story_count } = data;

    // Input validation
    if (!username || typeof username !== 'string' || username.length < 2 || username.length > 30) {
        return new Response(JSON.stringify({ error: "Invalid username" }), { 
            status: 400, 
            headers: { "Content-Type": "application/json" }
        });
    }
    if (!plain_pw || typeof plain_pw !== 'string' || plain_pw.length < 8 || plain_pw.length > 30) {
        return new Response(JSON.stringify({ error: "Invalid password" }), { 
            status: 400, 
            headers: { "Content-Type": "application/json" }
        });
    }
    if (!yob || typeof yob !== 'number' || yob < 1900 || yob > new Date().getFullYear()) {
        return new Response(JSON.stringify({ error: "Invalid year of birth" }), { 
            status: 400, 
            headers: { "Content-Type": "application/json" }
        });
    }
    if (!voice || (voice !== 'male' && voice !== 'female')) {
        return new Response(JSON.stringify({ error: "Invalid voice" }), { 
            status: 400, 
            headers: { "Content-Type": "application/json" }
        });
    }
    if (story_count !== undefined && (typeof story_count !== 'number' || story_count < 0 || story_count > 1000)) {
        return new Response(JSON.stringify({ error: "Invalid story count to save" }), { 
            status: 400, 
            headers: { "Content-Type": "application/json" }
        });
    }

    // Check if the username already exists
    try {
        const existingUser = await env.DB.prepare("SELECT * FROM user_account WHERE username = ?")
            .bind(username)
            .first();
        
        if (existingUser) {
            return new Response(JSON.stringify({ error: "Username already exists" }), { 
                status: 409, 
                headers: { "Content-Type": "application/json" }
            });
        }

        // Hash the password
        const hashed_password = await hashPassword(plain_pw);

        // Voice mapping
        const voice_mapping = {
            male: 'echo',
            female: 'nova',
        };

        // Insert user into the database
        const newUser = {
            username,
            hashed_password,
            yob,
            preferred_voice: voice_mapping[voice],
            cached_story_count: story_count !== undefined ? story_count : 3
        };

        const result = await createUser(env, newUser);

        if (result.success) {
            return new Response(JSON.stringify({ message: "User created successfully" }), {
                status: 201,
                headers: { "Content-Type": "application/json" },
            });
        } else {
            return new Response(JSON.stringify({ error: "User creation failed" }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }
    } catch (error) {
        console.error("Error in registration:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}


/**
 * Inserts a new user into the database.
 * @param {Object} env - The environment variables.
 * @param {Object} user - The user data to insert.
 * @returns {Object} - Result of the database insertion.
 */
async function createUser(env, user) {
    try {
        const { username, hashed_password, yob, preferred_voice, cached_story_count } = user;

        const query = `
            INSERT INTO user_account (username, hashed_password, preferred_voice, cached_story_count, yob)
            VALUES (?, ?, ?, ?, ?);
        `;

        const result = await env.DB.prepare(query)
            .bind(username, hashed_password, preferred_voice, cached_story_count, yob)
            .run();

        return { success: true, result };
    } catch (error) {
        console.error("Database insertion error:", error);
        return { success: false, error };
    }
}

/**
 * Hash the plain text password by PBKDF2.
 * @param {Object} password.
 * @returns {Object} - Encrypted password.
 */
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordBuffer = encoder.encode(password);
  
    const key = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
  
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 10000,
        hash: 'SHA-256'
      },
      key,
      256
    );
  
    const derivedBitsArray = new Uint8Array(derivedBits);
    const saltAndDerivedBits = new Uint8Array(salt.length + derivedBitsArray.length);
    saltAndDerivedBits.set(salt);
    saltAndDerivedBits.set(derivedBitsArray, salt.length);
  
    return btoa(String.fromCharCode.apply(null, saltAndDerivedBits));
  }
