/**
 * User Handlers logic
 */

import { hashPassword, verifyPassword, generateJWT, validatePasswordStrength } from "../common/auth";
import { createUser, getUserByEmail, updateUserByEmail } from "../models/userModel";
import { withAuth } from "../middleware/authMiddleware";
import { VOICE_MAPPING, VOICE_INVERTED_MAPPING } from "../common/chatVoiceConfig";

// Validation constants
const USERNAME_MIN_LENGTH = 2;
const USERNAME_MAX_LENGTH = 50;
const MIN_YOB = 1900;
const MAX_STORY_COUNT = 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_VOICES = ['male', 'female'];

/**
 * Handler for user registration.
 * @param {Request} request
 * @param {Object} env
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
    const { email, verification_code, username, plain_pw, yob, voice, story_count } = data;

    // Verification code validation
    if (!verification_code) {
        return new Response(JSON.stringify({ error: "Verification code is required" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }
    const storedCode = await env.VERIFICATION_CODES.get(`${email}_registration`);
    if (!storedCode || storedCode !== verification_code) {
        let errorMessage;
        if (!storedCode) {
            errorMessage = "Verification code has expired. Please request a new code to continue";
        } else {
            errorMessage = "Incorrect verification code. Please check and try again, or request a new code";
        }
        
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    // Email validation
    if (!email) {
        return new Response(JSON.stringify({ error: "Email address is required" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }
    if (!EMAIL_REGEX.test(email)) {
        return new Response(JSON.stringify({ error: "Invalid email format" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    // Username validation
    if (!username) {
        return new Response(JSON.stringify({ error: "Username is required" }), { 
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }
    if (typeof username !== 'string') {
        return new Response(JSON.stringify({ error: "Username must be a text string" }), { 
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }
    if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
        return new Response(JSON.stringify({ 
            error: `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters long` 
        }), { 
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    // Password strength validation
    const passwordValidation = validatePasswordStrength(plain_pw);
    if (!passwordValidation.isValid) {
        return new Response(JSON.stringify({ error: passwordValidation.error }), { 
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    // Year of birth validation
    const currentYear = new Date().getFullYear();
    if (!yob) {
        return new Response(JSON.stringify({ error: "Year of birth is required" }), { 
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }
    if (typeof yob !== 'number') {
        return new Response(JSON.stringify({ error: "Year of birth must be a number" }), { 
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }
    if (yob < MIN_YOB || yob > currentYear) {
        return new Response(JSON.stringify({ 
            error: `Year of birth must be between ${MIN_YOB} and ${currentYear}` 
        }), { 
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }
    // Voice preference validation
    if (!voice) {
        return new Response(JSON.stringify({ error: "Voice preference is required" }), { 
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }
    if (!VALID_VOICES.includes(voice)) {
        return new Response(JSON.stringify({ 
            error: `Voice must be one of: ${VALID_VOICES.join(', ')}` 
        }), { 
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    // Story count validation
    if (story_count !== undefined) {
        if (typeof story_count !== 'number') {
            return new Response(JSON.stringify({ error: "Story count must be a number" }), { 
                status: 422,
                headers: { "Content-Type": "application/json" }
            });
        }
        if (story_count < 0 || story_count > MAX_STORY_COUNT) {
            return new Response(JSON.stringify({ 
                error: `Story count must be between 0 and ${MAX_STORY_COUNT}` 
            }), { 
                status: 422,
                headers: { "Content-Type": "application/json" }
            });
        }
    }

    try {
        // Check if the email already exists
        const existingUser = await getUserByEmail(env, email);
        if (existingUser) {
            return new Response(JSON.stringify({ error: "Email already registered" }), { 
                status: 409, 
                headers: { "Content-Type": "application/json" }
            });
        }

        // Hash the password
        const hashed_password = await hashPassword(plain_pw);

        // Insert user into the database
        const newUser = {
            email,
            username,
            hashed_password,
            yob,
            preferred_voice: VOICE_MAPPING[voice],
            cached_story_count: story_count !== undefined ? story_count : 3
        };

        const result = await createUser(env, newUser);
        if (result.success) {
            // Delete the verification code after successful registration
            await env.VERIFICATION_CODES.delete(`${email}_registration`);

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

    const { email, plain_pw } = data;

    // Required fields validation
    if (!email || !plain_pw) {
        const missingFields = [];
        if (!email) missingFields.push('email');
        if (!plain_pw) missingFields.push('password');
        
        return new Response(JSON.stringify({ 
            error: `Missing required fields: ${missingFields.join(', ')}` 
        }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    // Email validation
    if (typeof email !== 'string') {
        return new Response(JSON.stringify({ error: "Email must be a text string" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }
    
    if (!EMAIL_REGEX.test(email)) {
        return new Response(JSON.stringify({ error: "Invalid email format" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    // Password format validation
    if (typeof plain_pw !== 'string') {
        return new Response(JSON.stringify({ error: "Password must be a text string" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    if (plain_pw.length < 8 || plain_pw.length > 50) {
        return new Response(JSON.stringify({ 
            error: "Password must be between 8 and 50 characters long" 
        }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        // Fetch user from the database
        const user = await getUserByEmail(env, email);        
        if (!user) {
            return new Response(JSON.stringify({ error: "No account found with this email" }), { 
                status: 401, 
                headers: { "Content-Type": "application/json" }
            });
        }

        // Verify password
        const isPasswordValid = await verifyPassword(plain_pw, user.hashed_password);
        if (!isPasswordValid) {
            return new Response(JSON.stringify({ error: "Incorrect password" }), { 
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
 * Handler for password reset
 * @param {Request} request
 * @param {Object} env
 * @returns {Response} 
 */
export async function handlePasswordReset(request, env) {
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
        return new Response(JSON.stringify({ error: "Invalid JSON format in request body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
        });
    }

    const { email, code, new_password } = data;

    // Required fields validation
    if (!email || !code || !new_password) {
        const missingFields = [];
        if (!email) missingFields.push('email');
        if (!code) missingFields.push('verification code');
        if (!new_password) missingFields.push('new password');
        
        return new Response(JSON.stringify({ 
            error: `Missing required fields: ${missingFields.join(', ')}` 
        }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    // Email format validation
    if (typeof email !== 'string') {
        return new Response(JSON.stringify({ error: "Email must be a text string" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    if (!EMAIL_REGEX.test(email)) {
        return new Response(JSON.stringify({ error: "Invalid email format" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }
    const user = await getUserByEmail(env, email);
    if (!user) {
        return new Response(JSON.stringify({ error: "No account found with this email" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    // Verification code format validation
    if (typeof code !== 'string') {
        return new Response(JSON.stringify({ error: "Verification code must be a text string" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    // Verify the code
    const storedCode = await env.VERIFICATION_CODES.get(`${email}_reset-pw`);
    if (!storedCode || storedCode !== code) {
        let errorMessage;
        if (!storedCode) {
            errorMessage = "Verification code has expired. Please request a new code to continue";
        } else {
            errorMessage = "Incorrect verification code. Please check and try again, or request a new code";
        }
        
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    // Password validation
    if (typeof new_password !== 'string') {
        return new Response(JSON.stringify({ error: "New password must be a text string" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    const passwordValidation = validatePasswordStrength(new_password);
    if (!passwordValidation.isValid) {
        return new Response(JSON.stringify({ error: passwordValidation.error }), { 
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        // Hash the new password
        const hashed_password = await hashPassword(new_password);

        // Update user's password in the database
        const result = await updateUserByEmail(env, email, { hashed_password });
        if (!result.success) {
            throw new Error('Failed to update password in database');
        }

        // Delete the verification code after successful password reset
        await env.VERIFICATION_CODES.delete(`${email}_reset-pw`);

        return new Response(JSON.stringify({ 
            message: "Password reset successfully" 
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        console.error("Error resetting password:", error);
        return new Response(JSON.stringify({ error: "Failed to reset password" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}

/**
 * Handler for retrieving user information.
 * @param {Request} request
 * @param {Object} env
 * @returns {Response} 
 */
export const handleUserInfoRetrieval = withAuth(async (request, env, email) => {
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
            status: 405, 
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        // Fetch user info from the database
        const user = await getUserByEmail(env, email);
        if (!user) {
            return new Response(JSON.stringify({ error: "User email is not registered" }), { 
                status: 404, 
                headers: { "Content-Type": "application/json" }
            });
        }

        // Format the response
        const responseBody = {
            username: user.username,
            email: user.email,
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
export const handleUserInfoUpdate = withAuth(async (request, env, email) => {
    if (request.method !== 'PUT') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
            status: 405, 
            headers: { "Content-Type": "application/json" }
        });
    }

    let data;
    try {
        data = await request.json();
    } catch (error) {
        return new Response(JSON.stringify({ error: "Invalid JSON format in request body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
        });
    }

    const { yob, preferred_voice: voice, cached_story_count } = data;

    // Build updateData object as we validate each field
    const updateData = {};
    const currentYear = new Date().getFullYear();

    // Year of birth validation
    if (yob !== undefined) {
        if (typeof yob !== 'number') {
            return new Response(JSON.stringify({ error: "Year of birth must be a number" }), { 
                status: 422, 
                headers: { "Content-Type": "application/json" }
            });
        }
        if (yob < MIN_YOB || yob > currentYear) {
            return new Response(JSON.stringify({ 
                error: `Year of birth must be between ${MIN_YOB} and ${currentYear}` 
            }), { 
                status: 422, 
                headers: { "Content-Type": "application/json" }
            });
        }
        updateData.yob = yob;
    }

    // Voice preference validation
    if (voice !== undefined) {
        if (!voice) {
            return new Response(JSON.stringify({ error: "Voice preference cannot be empty" }), { 
                status: 422, 
                headers: { "Content-Type": "application/json" }
            });
        }
        if (typeof voice !== 'string') {
            return new Response(JSON.stringify({ error: "Voice preference must be a text string" }), { 
                status: 422, 
                headers: { "Content-Type": "application/json" }
            });
        }
        if (!VALID_VOICES.includes(voice)) {
            return new Response(JSON.stringify({ 
                error: `Voice must be one of: ${VALID_VOICES.join(', ')}` 
            }), { 
                status: 422, 
                headers: { "Content-Type": "application/json" }
            });
        }
        updateData.preferred_voice = VOICE_MAPPING[voice];
    }

    // Story count validation
    if (cached_story_count !== undefined) {
        if (typeof cached_story_count !== 'number') {
            return new Response(JSON.stringify({ error: "Story count must be a number" }), { 
                status: 422, 
                headers: { "Content-Type": "application/json" }
            });
        }
        if (!Number.isInteger(cached_story_count)) {
            return new Response(JSON.stringify({ error: "Story count must be a whole number" }), { 
                status: 422, 
                headers: { "Content-Type": "application/json" }
            });
        }
        if (cached_story_count < 0 || cached_story_count > MAX_STORY_COUNT) {
            return new Response(JSON.stringify({ 
                error: `Story count must be between 0 and ${MAX_STORY_COUNT}` 
            }), { 
                status: 422, 
                headers: { "Content-Type": "application/json" }
            });
        }
        updateData.cached_story_count = cached_story_count;
    }

    // Check if there are any fields to update
    if (Object.keys(updateData).length === 0) {
        return new Response(JSON.stringify({ 
            error: "No valid fields to update. Please provide at least one of: year of birth, voice preference, or story count" 
        }), { 
            status: 422, 
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        const result = await updateUserByEmail(env, email, updateData);
        if (result.success) {
            const updatedUser = await getUserByEmail(env, email);
            if (!updatedUser) {
                throw new Error('Failed to retrieve updated user information');
            }
            
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
