#!/bin/bash

echo "=========================================="
echo "🚀 Employee Portal Build Script"
echo "=========================================="

# Check if API_URL exists
if [ -z "$API_URL" ]; then
    echo "❌ ERROR: API_URL environment variable is not set!"
    echo ""
    echo "Please set it in Netlify:"
    echo "Site settings > Environment variables"
    echo "Key: API_URL"
    echo "Value: Your Google Apps Script URL"
    echo ""
    exit 1
fi

echo "✅ API_URL found in environment"
echo "📍 URL: $API_URL"
echo ""

echo "📝 Generating config.js from environment variables..."

# Create config.js
cat > config.js << 'CONFIGEOF'
// ============================================================================
// Configuration File - AUTO-GENERATED at build time
// DO NOT EDIT MANUALLY - This file is generated from environment variables
// Generated at: BUILD_TIMESTAMP
// ============================================================================

const CONFIG = {
    // API URL from Netlify environment variable
    API_URL: 'API_URL_PLACEHOLDER',
    
    // Feature flags
    FEATURES: {
        OFFLINE_MODE: true,
        AUTO_LOGIN: true,
        CACHE_ENABLED: true
    },
    
    // Timeouts
    TIMEOUTS: {
        API_REQUEST: 30000, // 30 seconds
        TOKEN_REFRESH: 30 * 60 * 1000, // 30 minutes
        CACHE_DURATION: 5 * 60 * 1000 // 5 minutes
    },
    
    // Limits
    LIMITS: {
        MAX_FILE_SIZE: 2 * 1024 * 1024, // 2MB
        MAX_PASSWORD_LENGTH: 128,
        MIN_PASSWORD_LENGTH: 6
    }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
CONFIGEOF

# Replace placeholders
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
sed -i.bak "s|API_URL_PLACEHOLDER|$API_URL|g" config.js
sed -i.bak "s|BUILD_TIMESTAMP|$TIMESTAMP|g" config.js
rm -f config.js.bak

echo "✅ config.js generated successfully!"
echo ""
echo "📄 Generated config.js content:"
echo "---"
head -n 15 config.js
echo "..."
echo "---"
echo ""
echo "✅ Build completed successfully!"
echo "=========================================="
