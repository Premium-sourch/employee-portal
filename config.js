// ============================================================================
// Employee Portal Configuration - Vercel Deployment
// ============================================================================

const CONFIG = {
    // 🔴 CRITICAL: Replace this with your actual Google Apps Script URL
    // Get it from: Apps Script → Deploy → Manage Deployments → Copy Web App URL
    // Format: https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec

    API_URL: 'https://script.google.com/macros/s/AKfycbxRmNx5FLlJJjIfcFl95IrA7XrcCKakozoNHS6iTFgevODYHfdtqMUtW83iJQyI604K/exec',

    // Example (replace with your actual URL):
    // API_URL: 'https://script.google.com/macros/s/AKfycbzXXXXXXXXXXXXXXXXXXXXXXXX/exec',

    // Application Info
    VERSION: '2.0',
    APP_NAME: 'কর্মচারী পোর্টাল',

    // Feature Flags (optional - enable/disable features)
    FEATURES: {
        OFFLINE_SUPPORT: true,
        PWA_INSTALL: true,
        AUTO_LOGIN: true
    }
};

// ============================================================================
// Validation & Setup
// ============================================================================

(function validateConfig() {
    // Check if API is configured
    if (!CONFIG.API_URL || CONFIG.API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('⚠️  CONFIGURATION ERROR');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('');
        console.error('❌ Google Apps Script URL not configured!');
        console.error('');
        console.error('📋 Setup Steps:');
        console.error('');
        console.error('1️⃣  Open Google Sheets → Extensions → Apps Script');
        console.error('2️⃣  Paste your backend code (google_appscript.js)');
        console.error('3️⃣  Click Deploy → New Deployment → Web App');
        console.error('4️⃣  Set "Who has access" to: Anyone');
        console.error('5️⃣  Click Deploy and copy the Web App URL');
        console.error('6️⃣  Paste the URL in config.js (line 10)');
        console.error('7️⃣  Commit and push changes to GitHub');
        console.error('');
        console.error('📄 Your URL should look like:');
        console.error('https://script.google.com/macros/s/AKfycbz.../exec');
        console.error('');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // Show warning to user
        if (typeof document !== 'undefined') {
            setTimeout(() => {
                // Only show if on auth screen
                const authScreen = document.getElementById('auth-screen');
                if (authScreen && authScreen.classList.contains('active')) {
                    // Try to show toast if available
                    if (typeof showToast === 'function') {
                        showToast('⚠️ API সংযোগ ত্রুটি। config.js চেক করুন।', 'error');
                    } else {
                        alert('⚠️ Configuration Error\n\nGoogle Apps Script URL not configured.\n\nPlease update config.js with your deployment URL.');
                    }
                }
            }, 2000);
        }
    } else {
        // Configuration valid
        console.log('✅ API Configuration Valid');
        console.log('📡 API URL:', CONFIG.API_URL.substring(0, 50) + '...');
        console.log('🚀 App Version:', CONFIG.VERSION);
        console.log('📱 App Name:', CONFIG.APP_NAME);
    }

    // Check if URL format is correct
    if (CONFIG.API_URL && !CONFIG.API_URL.includes('script.google.com')) {
        console.warn('⚠️  Warning: API URL does not look like a Google Apps Script URL');
        console.warn('Expected format: https://script.google.com/macros/s/.../exec');
    }

    // Environment info
    console.log('🌍 Environment:', window.location.hostname);
    console.log('🔒 Protocol:', window.location.protocol);
})();

// ============================================================================
// Export Configuration
// ============================================================================

// Make config available globally (if needed)
if (typeof window !== 'undefined') {
    window.APP_CONFIG = CONFIG;

}
