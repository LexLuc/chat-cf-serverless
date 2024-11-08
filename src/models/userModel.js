

/**
 * Inserts a new user into the database.
 * @param {Object} env - The environment variables.
 * @param {Object} user - The user data to insert.
 * @returns {Object} - Result of the database insertion.
 */
export async function createUser(env, user) {
    try {
        const { email, username, hashed_password, yob, preferred_voice, cached_story_count } = user;

        const query = `
            INSERT INTO user_account (email, username, hashed_password, preferred_voice, cached_story_count, yob)
            VALUES (?, ?, ?, ?, ?, ?);
        `;

        const result = await env.DB.prepare(query)
            .bind(email, username, hashed_password, preferred_voice, cached_story_count, yob)
            .run();

        return { success: true, result };
    } catch (error) {
        console.error("Database insertion error:", error);
        return { success: false, error };
    }
}

/**
 * Retrieves a user account from the database by their email address.
 * @param {Object} env - The environment variables.
 * @param {string} email - The email address of the user account to retrieve.
 * @returns {Promise<Object|null>} - A promise that resolves to the user account object if found, otherwise null.
 */
export async function getUserByEmail(env, email) {
    return await env.DB.prepare("SELECT * FROM user_account WHERE email = ?")
        .bind(email)
        .first();
}

export async function updateUserByEmail(env, email, updateData) {
    try {
        const updateFields = Object.keys(updateData).map(key => `${key} = ?`).join(", ");
        const updateValues = Object.values(updateData);

        const query = `UPDATE user_account SET ${updateFields} WHERE email = ?`;
        updateValues.push(email);

        const result = await env.DB.prepare(query).bind(...updateValues).run();
        return { success: true, result };
    } catch (error) {
        console.error("Database update error:", error);
        return { success: false, error };
    }
}
