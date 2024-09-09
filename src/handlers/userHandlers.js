/**
 * User Handlers logic
 */

import { hashPassword, verifyPassword, generateJWT } from "../common/auth";
import { createUser, getUserByUsername, updateUser } from "../models/userModel";
import { withAuth } from "../middleware/authMiddleware";
import { VOICE_MAPPING, VOICE_INVERTED_MAPPING } from "../common/chatVoiceConfig";

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
    if (!username || typeof username !== 'string' || username.length < 2 || username.length > 50) {
        return new Response(JSON.stringify({ error: "Invalid username" }), { 
            status: 400, 
            headers: { "Content-Type": "application/json" }
        });
    }
    if (!plain_pw || typeof plain_pw !== 'string' || plain_pw.length < 8 || plain_pw.length > 50) {
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

    try {
        // Check if the username already exists
        const existingUser = await getUserByUsername(env, username);
        if (existingUser) {
            return new Response(JSON.stringify({ error: "Username already exists" }), { 
                status: 409, 
                headers: { "Content-Type": "application/json" }
            });
        }

        // Hash the password
        const hashed_password = await hashPassword(plain_pw);

        // Insert user into the database
        const newUser = {
            username,
            hashed_password,
            yob,
            preferred_voice: VOICE_MAPPING[voice],
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
    if (!username || typeof username !== 'string' || username.length < 2 || username.length > 50) {
        return new Response(JSON.stringify({ error: "Invalid username" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
        });
    }
    if (!plain_pw || typeof plain_pw !== 'string' || plain_pw.length < 8 || plain_pw.length > 50) {
        return new Response(JSON.stringify({ error: "Invalid password" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        // Fetch user from the database
        const user = await getUserByUsername(env, username);        
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
            status: 201,
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
 * Handler for retrieving user information.
 * @param {Request} request
 * @param {Object} env
 * @returns {Response} 
 */
export const handleUserInfoRetrieval = withAuth(async (request, env, username) => {
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
            status: 405, 
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        // Fetch user info from the database
        const user = await getUserByUsername(env, username);
        if (!user) {
            return new Response(JSON.stringify({ error: "User not found" }), { 
                status: 404, 
                headers: { "Content-Type": "application/json" }
            });
        }

        // Format the response
        const responseBody = {
            username: user.username,
            yob: user.yob,
            voice: VOICE_INVERTED_MAPPING[user.preferred_voice] || user.preferred_voice,
            story_count: user.cached_story_count
        };

        // Return user info
        return new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Error in user info retrieval:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});

/**
 * Handler for updating user information.
 * @param {Request} request
 * @param {Object} env
 * @returns {Response} 
 */
export const handleUserInfoUpdate = withAuth(async (request, env, username) => {
        if (request.method !== 'PUT') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
            status: 405, 
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        // Parse the request body
        const data = await request.json();
        const { yob, preferred_voice: voice, cached_story_count } = data;

        // Validate input
        if (yob && (typeof yob !== 'number' || yob < 1900 || yob > new Date().getFullYear())) {
            return new Response(JSON.stringify({ error: "Invalid year of birth" }), { 
                status: 400, 
                headers: { "Content-Type": "application/json" }
            });
        }
        if (voice && (voice !== 'male' && voice !== 'female')) {
            return new Response(JSON.stringify({ error: "Invalid voice" }), { 
                status: 400, 
                headers: { "Content-Type": "application/json" }
            });
        }
        if (cached_story_count !== undefined && (typeof cached_story_count !== 'number' || cached_story_count < 0 || cached_story_count > 1000)) {
            return new Response(JSON.stringify({ error: "Invalid cached story count" }), { 
                status: 400, 
                headers: { "Content-Type": "application/json" }
            });
        }

        const updateData = {
            ...(yob !== undefined && { yob }),
            ...(voice !== undefined && { preferred_voice: VOICE_MAPPING[voice] }),
            ...(cached_story_count !== undefined && { cached_story_count })
        };

        if (Object.keys(updateData).length === 0) {
            return new Response(JSON.stringify({ error: "No valid fields to update" }), { 
                status: 400, 
                headers: { "Content-Type": "application/json" }
            });
        }

        const result = await updateUser(env, username, updateData);
        if (result.success) {
            const updatedUser = await getUserByUsername(env, username);
            
            // Format the response
            const updatedResponse = {
                username: updatedUser.username,
                yob: updatedUser.yob,
                voice: VOICE_INVERTED_MAPPING[updatedUser.preferred_voice] || updatedUser.preferred_voice,
                story_count: updatedUser.cached_story_count
            };
            return new Response(JSON.stringify({
                message: "User information updated successfully",
                user: updatedResponse
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        } else {
            throw new Error('Failed to update user information');
        }
    } catch (error) {
        console.error("Error in updating user info:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});
