/**
 * User Handlers logic
 */

import { hashPassword, verifyPassword, generateJWT } from "../common/auth";
import { withAuth } from "../middleware/authMiddleware";

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
 * Retrieves a user account from the database by their username.
 * @param {Object} env - The environment variables.
 * @param {string} username - The username of the user account to retrieve.
 * @returns {Promise<Object|null>} - A promise that resolves to the user account object if found, otherwise null.
 */
async function getUserByUsername(env, username) {
    return await env.DB.prepare("SELECT * FROM user_account WHERE username = ?")
        .bind(username)
        .first();
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

        const voiceInversedMapping = {
            'echo': 'male',
            'nova': 'female'
        };

        // Format the response
        const responseBody = {
            username: user.username,
            yob: user.yob,
            voice: voiceInversedMapping[user.preferred_voice] || user.preferred_voice,
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

        // Prepare the update query
        let updateQuery = "UPDATE user_account SET ";
        const updateValues = [];
        const updateFields = [];
        const voice_mapping = {
            male: 'echo',
            female: 'nova',
        };

        if (yob !== undefined) {
            updateFields.push("yob = ?");
            updateValues.push(yob);
        }
        if (voice !== undefined) {
            updateFields.push("preferred_voice = ?");
            updateValues.push(voice_mapping[voice]);
        }
        if (cached_story_count !== undefined) {
            updateFields.push("cached_story_count = ?");
            updateValues.push(cached_story_count);
        }

        if (updateFields.length === 0) {
            return new Response(JSON.stringify({ error: "No valid fields to update" }), { 
                status: 400, 
                headers: { "Content-Type": "application/json" }
            });
        }

        updateQuery += updateFields.join(", ") + " WHERE username = ?";
        updateValues.push(username);

        // Execute the update query
        const result = await env.DB.prepare(updateQuery).bind(...updateValues).run();

        if (result.success) {
            // Fetch updated user info
            const updatedUser = await env.DB.prepare("SELECT username, yob, preferred_voice, cached_story_count FROM user_account WHERE username = ?")
                .bind(username)
                .first();
            const voiceInversedMapping = {
                'echo': 'male',
                'nova': 'female'
            };
            
            // Format the response
            const formattedResponse = {
                username: updatedUser.username,
                yob: updatedUser.yob,
                voice: voiceInversedMapping[updatedUser.preferred_voice] || updatedUser.preferred_voice,
                story_count: updatedUser.cached_story_count
            };
            return new Response(JSON.stringify({
                message: "User information updated successfully",
                user: formattedResponse
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
