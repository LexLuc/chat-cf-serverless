import { Resend } from "resend";
import { getUserByEmail } from "../models/userModel";


/**
 * Generates a random 4-digit verification code
 * @returns {string}
 */
function generateVerificationCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Rate limiting function to prevent abuse
 * @param {Object} env 
 * @param {string} email 
 * @param {string} type 
 * @returns {Promise<boolean>}
 */
async function checkRateLimit(env, email, type) {
    const key = `ratelimit_${type}_${email}`;
    const currentAttempts = await env.VERIFICATION_CODES.get(key);
    
    if (currentAttempts) {
        const attempts = parseInt(currentAttempts);
        if (attempts >= 5) { // Maximum 5 attempts per hour
            return false;
        }
        await env.VERIFICATION_CODES.put(key, (attempts + 1).toString(), { expirationTtl: 3600 });
    } else {
        await env.VERIFICATION_CODES.put(key, "1", { expirationTtl: 3600 });
    }
    
    return true;
}

/**
 * Sends verification email using Resend
 * @param {string} email 
 * @param {string} code 
 * @param {string} type - Either 'registration' or 'reset-pw'
 * @param {Resend} resend 
 */
async function sendVerificationEmail(email, code, type, resend) {

    const subject = type === 'registration' 
        ? 'Verify your email for registration' 
        : 'Reset your password';
    
    const content = type === 'registration'
        ? `<p>Dear User,</p>
    <p>Thank you for registering for our service! To verify your email address and ensure your account's security, please use the following 4-digit code:</p>
    <p><span><strong>Verification Code: ${code}</strong></span></p>
    <p>Please enter this code where prompted to complete the email verification. The code is valid for 1 hour, so be sure to complete the process promptly.</p>
    <p>If you did not request this code, please ignore this email.</p>
    <p>Best regards,</p>`
        : `<p>Dear User,</p>
    <p>You have requested to change your password. To ensure the security of your account, please use the following 4-digit code to verify your identity:</p>
    <p><span><strong>Verification Code: ${code}</strong></span></p>
    <p>Please enter this code where prompted to complete the password change. The code is valid for 1 hour, so be sure to complete the process promptly.</p>
    <p>If you did not request a password change, please ignore this email, and your account will remain secure.</p>
    <p>Best regards,</p>`;

    const { data, error } = await resend.emails.send({
        from: "POPO's Notification <onboarding@resend.dev>",
        to: email,
        subject: subject,
        html: `<p>${content}</p>`,
    });

    if (error) {
        throw new Error(`Failed to send email: ${error.message}`);
    }

    console.log({ data });
}

/**
 * Handler for sending verification code during registration
 * @param {Request} request
 * @param {Object} env
 * @returns {Response} 
*/
export async function handleEmailVerification(request, env) {
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

    const { email, type } = data;

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
        return new Response(JSON.stringify({ error: "Please enter a valid email address (e.g., user@example.com)" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    if (!['registration', 'reset-pw'].includes(type)) {
        return new Response(JSON.stringify({ error: "Invalid verification type. Must be either 'registration' or 'reset-pw'" }), {
            status: 422,
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        // Check rate limiting
        const isWithinLimit = await checkRateLimit(env, email, type);
        if (!isWithinLimit) {
            return new Response(JSON.stringify({ 
                error: "Too many attempts. Please try again later." 
            }), {
                status: 429,
                headers: { "Content-Type": "application/json" }
            });
        }

        // Check if email exists in database
        const existingUser = await getUserByEmail(env, email);

        // For registration: email should NOT exist
        if (type === 'registration' && existingUser) {
            return new Response(JSON.stringify({ 
                error: "Email is already registered" 
            }), {
                status: 409,
                headers: { "Content-Type": "application/json" }
            });
        }

        // For password reset: email should exist
        if (type === 'reset' && !existingUser) {
            return new Response(JSON.stringify({ 
                error: "Email is not registered" 
            }), {
                status: 404,
                headers: { "Content-Type": "application/json" }
            });
        }

        const resend = new Resend(env.RESEND_API_KEY);
        const verificationCode = generateVerificationCode();
        
        // Store verification code in KV with 1-hour expiration
        const key = `${email}_${type}`;
        await env.VERIFICATION_CODES.put(key, verificationCode, { expirationTtl: 3600 * 1 });
        
        // Send verification email
        await sendVerificationEmail(email, verificationCode, type, resend);

        return new Response(JSON.stringify({ 
            message: "Verification code sent successfully" 
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        console.error("Error sending verification email:", error);
        return new Response(JSON.stringify({ error: "Failed to send verification email" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
