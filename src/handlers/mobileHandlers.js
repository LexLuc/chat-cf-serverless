/**
 * Mobile Handlers logic
 * like mobile software upgrade
 */


/**
 * Handler for retrieve latest software version info.
 * @param {Request} request
 * @param {Object} env
 * @returns {Response} 
 */
export async function handleMobileAppGetLatestAPK(request, env) {
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: `Method ${request.method} is Not Allowed` }), { 
            status: 405, 
            Allow: "GET",
            headers: { "Content-Type": "application/json" }
        });
    }

    try {
        const url = new URL(request.url);
        const appId = url.searchParams.get('appid');
        const validAppId = ['story', 'qna'];
        if (!validAppId.includes(appId)) {
            const errorMessage = `APP ID not given or invalid. Expected "story" or "qna".`;
            console.error(`[${new Date().toISOString()}] handleMobileAppGetLatestAPK: ${errorMessage}`);
            return new Response(errorMessage, { 
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        const packagesListing = await env.R2_BUCKET.list({
            limit: 1000,
            prefix: `installers/latest/${appId}`,
        });
        console.log(`[${new Date().toISOString()}] handleMobileAppGetLatestAPK: R2 list result:' ${JSON.stringify(packagesListing, null, 2)}`);
        
        if (!packagesListing || !packagesListing.objects || packagesListing.objects.length === 0) {
            return new Response(JSON.stringify({ error: 'No APK files found' }), { 
                status: 404,
                headers: { "Content-Type": "application/json" }
            });
        }

        const latestAPK = packagesListing.objects.sort((a, b) =>
            new Date(b.uploaded).getTime() - new Date(a.uploaded).getTime()
        )[0];

        console.log(`[${new Date().toISOString()}] handleMobileAppGetLatestAPK: Latest APK found:' ${JSON.stringify(latestAPK, null, 2)}`);
        const versionMatch = latestAPK.key.match(/-v(\d+(\.\d+)*)/);
        const versionNumber = versionMatch ? versionMatch[1] : null;

        const downloadUrl = `https://pub-f64c5ab9f8a64b529973741e25c40b59.r2.dev/${latestAPK.key}`;
        
        return new Response(JSON.stringify({
            version: versionNumber,
            downloadUrl: downloadUrl,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });

    } catch (error) {
        console.log(`[${new Date().toISOString()}] handleMobileAppGetLatestAPK: Error occurred while retrieving the latest APK: ${error}`);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
