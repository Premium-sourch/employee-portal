#!/bin/bash

echo "=========================================="
echo "Build Script Started"
echo "=========================================="

if [ -z "$API_URL" ]; then
    echo "ERROR: API_URL not set!"
    exit 1
fi

echo "API_URL found: $API_URL"
echo "Generating config.js..."

cat > config.js << 'EOF'
const CONFIG = {
    API_URL: 'API_URL_PLACEHOLDER',
    FEATURES: {
        OFFLINE_MODE: true,
        AUTO_LOGIN: true,
        CACHE_ENABLED: true
    },
    TIMEOUTS: {
        API_REQUEST: 30000,
        TOKEN_REFRESH: 30 * 60 * 1000,
        CACHE_DURATION: 5 * 60 * 1000
    },
    LIMITS: {
        MAX_FILE_SIZE: 2 * 1024 * 1024,
        MAX_PASSWORD_LENGTH: 128,
        MIN_PASSWORD_LENGTH: 6
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
EOF

sed -i.bak "s|API_URL_PLACEHOLDER|$API_URL|g" config.js
rm -f config.js.bak

echo "config.js generated successfully!"
echo "=========================================="
