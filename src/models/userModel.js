

/**
 * Inserts a new user into the database.
 * @param {Object} env - The environment variables.
 * @param {Object} user - The user data to insert.
 * @returns {Object} - Result of the database insertion.
 */
export async function createUser(env, user) {
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
export async function getUserByUsername(env, username) {
    return await env.DB.prepare("SELECT * FROM user_account WHERE username = ?")
        .bind(username)
        .first();
}

export async function updateUser(env, username, updateData) {
    try {
        const updateFields = Object.keys(updateData).map(key => `${key} = ?`).join(", ");
        const updateValues = Object.values(updateData);

        const query = `UPDATE user_account SET ${updateFields} WHERE username = ?`;
        updateValues.push(username);

        const result = await env.DB.prepare(query).bind(...updateValues).run();
        return { success: true, result };
    } catch (error) {
        console.error("Database update error:", error);
        return { success: false, error };
    }
}
