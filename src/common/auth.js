/**
 * Auth logic for users: Password and JWT
 */

import { sign, verify } from '@tsndr/cloudflare-worker-jwt';

/**
 * Hash the plain text password by PBKDF2.
 * @param {string} password - The password to hash.
 * @returns {Promise<string>} A promise that resolves to a Base64-encoded string 
 *                            containing the salt and the derived hash.

 */
export async function hashPassword(password) {
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

/**
 * Verify the provided password against the stored hashed password.
 * @param {string} password - The plaintext password to verify.
 * @param {string} storedHash - The Base64-encoded string containing the salt and the stored derived key.
 * @returns {Promise<boolean>} - A promise that resolves to `true` if the password is correct, otherwise `false`.
 */
export async function verifyPassword(password, storedHash) {
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
 * @returns {Promise<string>} - The generated JWT.
 */
export async function generateJWT(user, secret) {
    const payload = {
        sub: user.email,
        hpw: user.hashed_password,
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 10) // 10 days expiration
    };

    return await sign(payload, secret);
}

/**
 * Verifies a JSON Web Token (JWT) using the provided secret key.
 * 
 * @param {string} token - The JWT string to be verified.
 * @param {string} secret - The secret key used to verify the token.
 * @returns {Promise<boolean>} A promise that resolves to the decoded token payload if the token is valid.
 */
export async function verifyJWT(token, secret) {
  return await verify(token, secret);
}

/**
 * Validates password strength requirements.
 * @param {string} password 
 * @returns {{isValid: boolean, error: string|null}}
 */
export function validatePasswordStrength(password) {
  if (password.length < 8 || password.length > 50) {
      return { isValid: false, error: "Password must be between 8 and 50 characters" };
  }

  const requirements = [
      [/[a-z]/, "lowercase letter"],
      [/[A-Z]/, "uppercase letter"],
      [/[0-9]/, "number"],
      [/[^A-Za-z0-9]/, "special character"],
  ];

  const missingReqs = requirements
      .filter(([regex]) => !regex.test(password))
      .map(([, desc]) => desc);

  if (missingReqs.length > 0) {
      const errorMsg = missingReqs.length === 1
          ? `Password must contain at least one ${missingReqs[0]}`
          : `Password must contain at least one of each: ${missingReqs.join(', ')}`;
      return { isValid: false, error: errorMsg };
  }

  return { isValid: true, error: null };
}

