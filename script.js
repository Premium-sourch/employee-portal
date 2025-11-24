// ============================================================================
// Modern Employee Portal JavaScript - WITH MONTHLY SHEET ROTATION
// Updated to support automatic monthly sheet management
// ============================================================================
// ============================================================================
// Global Error Handling
// ============================================================================

window.addEventListener('error', function(e) {
  console.error('Global error:', e.error);
  // Don't show toast for every error, only log to console
});

window.addEventListener('unhandledrejection', function(e) {
  console.error('Unhandled promise rejection:', e.reason);
  e.preventDefault();
});

// ============================================================================
// Main Application Code
// ============================================================================
const API_BASE = (function() {
  // Try to get from CONFIG if available, otherwise use fallback
  if (typeof CONFIG !== 'undefined' && CONFIG.API_URL) {
    return CONFIG.API_URL;
  }
  // Fallback - replace this after deployment
  return 'YOUR_DEPLOYED_APPS_SCRIPT_URL';
})();
// Validate API configuration on load
(function validateConfig() {
    if (API_BASE === 'YOUR_DEPLOYED_APPS_SCRIPT_URL' || !API_BASE) {
        console.error('⚠️ WARNING: API_BASE not configured! Please set your Google Apps Script URL in config.js');
        // Show warning in UI
        setTimeout(() => {
            if (document.getElementById('auth-screen').classList.contains('active')) {
                showToast('⚠️ অ্যাপ্লিকেশন কনফিগারেশন অসম্পূর্ণ', 'warning');
            }
        }, 1000);
    } else {
        console.log('✅ API configured:', API_BASE.substring(0, 50) + '...');
    }
})();
// STORAGE KEYS
const STORAGE_KEYS = {
    TOKEN: 'employee_portal_token',
    USER_ID: 'employee_portal_user_id'
};

// Rate limiting
const API_RATE_LIMIT = {
    calls: 0,
    resetTime: Date.now() + 60000, // Reset every minute
    maxCalls: 30 // Max 30 calls per minute
};

function checkRateLimit() {
    const now = Date.now();

    // Reset counter if time window passed
    if (now > API_RATE_LIMIT.resetTime) {
        API_RATE_LIMIT.calls = 0;
        API_RATE_LIMIT.resetTime = now + 60000;
    }

    // Check if limit exceeded
    if (API_RATE_LIMIT.calls >= API_RATE_LIMIT.maxCalls) {
        throw new Error('অনেক বেশি অনুরোধ। দয়া করে কিছুক্ষণ অপেক্ষা করুন।');
    }

    API_RATE_LIMIT.calls++;
}

// State Management
let currentUser = {
    token: null,
    profile: null,
    profileImage: null
};
// Cache management
const cache = {
    profile: null,
    profileExpiry: null,
    stats: {},
    CACHE_DURATION: 5 * 60 * 1000 // 5 minutes
};

function isCacheValid(key) {
    if (key === 'profile') {
        return cache.profile && cache.profileExpiry && Date.now() < cache.profileExpiry;
    }
    const cached = cache.stats[key];
    return cached && cached.expiry && Date.now() < cached.expiry;
}

function getCached(key) {
    if (key === 'profile') return cache.profile;
    return cache.stats[key]?.data;
}

function setCache(key, data) {
    if (key === 'profile') {
        cache.profile = data;
        cache.profileExpiry = Date.now() + cache.CACHE_DURATION;
    } else {
        cache.stats[key] = {
            data: data,
            expiry: Date.now() + cache.CACHE_DURATION
        };
    }
}

function clearCache() {
    cache.profile = null;
    cache.profileExpiry = null;
    cache.stats = {};
}
// ============================================================================
// Input Validation & Sanitization
// ============================================================================

function sanitizeInput(input) {
  if (input === null || input === undefined) return '';

  const str = String(input);

  // Remove potentially dangerous characters
  return str
    .replace(/[<>&"']/g, '') // Remove HTML tags and quotes
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();                 // Trim spaces
}

function sanitizeNumber(input, defaultValue = 0) {
  if (input === null || input === undefined || input === '') return defaultValue;

  const num = parseFloat(input);
  return isNaN(num) ? defaultValue : Math.max(0, num); // Ensure non-negative
}

function validateEmployeeID(id) {
  // Basic validation - adjust according to your ID format
  return /^[A-Za-z0-9_-]+$/.test(id) && id.length >= 3 && id.length <= 20;
}
let currentView = 'overview';
let currentAttendanceType = null;
let availableMonths = []; // Store available months from backend

// ============================================================================
// LOCAL STORAGE HELPERS
// ============================================================================

function saveToken(token) {
    try {
        localStorage.setItem(STORAGE_KEYS.TOKEN, token);
        currentUser.token = token;
        console.log('Token saved to localStorage');
    } catch (e) {
        console.error('Failed to save token:', e);
    }
}

function getToken() {
    try {
        const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
        if (token) {
            currentUser.token = token;
            console.log('Token loaded from localStorage');
        }
        return token;
    } catch (e) {
        console.error('Failed to get token:', e);
        return null;
    }
}

function clearToken() {
    try {
        localStorage.removeItem(STORAGE_KEYS.TOKEN);
        currentUser.token = null;
        console.log('Token cleared from localStorage');
    } catch (e) {
        console.error('Failed to clear token:', e);
    }
}
// Token refresh check
function setupTokenRefresh() {
    // Check token validity every 30 minutes
    setInterval(async () => {
        if (currentUser.token) {
            try {
                await apiRequest('profile'); // Simple health check
                console.log('Token still valid');
            } catch (error) {
                console.log('Token expired, redirecting to login');
                handleLogout();
            }
        }
    }, 30 * 60 * 1000); // 30 minutes
}

// ============================================================================
// Utility Functions
// ============================================================================

// Bangla Number Converter
function toBanglaNumber(num) {
    const banglaDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    return String(num).replace(/\d/g, digit => banglaDigits[digit]);
}

// Format number with Bangla digits
function formatBanglaNumber(num) {
    if (num === null || num === undefined) return '০';

    const str = String(num);
    const parts = str.split('.');

    let integerPart = parts[0];
    let formatted = '';
    let count = 0;

    for (let i = integerPart.length - 1; i >= 0; i--) {
        if (count > 0 && count % 3 === 0) {
            formatted = ',' + formatted;
        }
        formatted = integerPart[i] + formatted;
        count++;
    }

    formatted = toBanglaNumber(formatted);

    if (parts.length > 1) {
        formatted += '.' + toBanglaNumber(parts[1]);
    }

    return formatted;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
        warning: '⚠️'
    };

    toast.innerHTML = `<span>${icons[type] || icons.info}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

async function apiRequest(endpoint, options = {}) {
    // Add rate limiting check
    checkRateLimit();

    const method = options.method || 'GET';
    try {
        let url = `${API_BASE}?path=${encodeURIComponent(endpoint)}`;

        if (currentUser.token && !options.skipAuth) {
            url += `&authorization=${encodeURIComponent('Bearer ' + currentUser.token)}`;
        }

        let fetchOptions = {
            method: method,
            redirect: 'follow'
        };

        if (method === 'POST' && options.body) {
            const formData = new URLSearchParams();
            Object.keys(options.body).forEach(key => {
                const value = options.body[key];
                formData.append(key, value !== null && value !== undefined ? String(value) : '');
            });
            fetchOptions.body = formData;
            fetchOptions.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        }

        console.log('API Request:', method, endpoint);

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('API Response:', data);

        if (!data.ok) {
            if (data.error && data.error.includes('অননুমোদিত')) {
                console.log('Token invalid, clearing and redirecting to login');
                clearToken();
                switchScreen('auth-screen');
            }
            throw new Error(data.error || 'Request failed');
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        if (error.message.includes('Failed to fetch')) {
            throw new Error('সার্ভারের সাথে সংযোগ করতে ব্যর্থ। ইন্টারনেট সংযোগ চেক করুন।');
        }
        throw error;
    }
}

function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });

    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');
    }
}

function switchView(viewName) {
    currentView = viewName;

    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });

    const targetView = document.getElementById(`${viewName}-view`);
    if (targetView) {
        targetView.classList.add('active');
    }

    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });

    const activeLink = document.querySelector(`.nav-link[data-view="${viewName}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }

    const titles = {
        overview: { title: 'ড্যাশবোর্ড ওভারভিউ', subtitle: 'ফিরে আসার জন্য স্বাগতম! এখানে আপনার সারসংক্ষেপ' },
        history: { title: 'কাজের ইতিহাস', subtitle: 'আপনার উপস্থিতি রেকর্ড দেখুন' },
        profile: { title: 'আমার প্রোফাইল', subtitle: 'আপনার প্রোফাইল তথ্য দেখুন এবং পরিচালনা করুন' }
    };

    if (titles[viewName]) {
        document.getElementById('page-title').textContent = titles[viewName].title;
        document.getElementById('page-subtitle').textContent = titles[viewName].subtitle;
    }

    if (viewName === 'profile') {
        cancelEditProfile();
    } else {
        document.getElementById('profile-view-mode').style.display = 'block';
        document.getElementById('profile-edit-mode').style.display = 'none';
        toggleProfileEditButton(true);
    }

    if (window.innerWidth <= 1024) {
        document.getElementById('sidebar').classList.remove('mobile-open');
    }
}

function formatCurrency(amount) {
    const formatted = parseFloat(amount).toFixed(0);
    return `৳${formatBanglaNumber(formatted)}`;
}


function getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function updateCurrentDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').textContent = now.toLocaleDateString('bn-BD', options);
}

function formatDate(dateStr) {
    if (typeof dateStr === 'string') {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]) - 1;
            const day = parseInt(parts[2]);
            
            // Create date in LOCAL timezone
            const d = new Date(year, month, day);
            
            return d.toLocaleDateString('bn-BD', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }
    }

    const d = new Date(dateStr);
    return d.toLocaleDateString('bn-BD', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}
// ============================================================================
// Salary Auto-Calculation Functions
// ============================================================================

/**
 * Calculate salary components from gross salary
 * Formula:
 * - মূল মজুরি = (Gross - 2450) / 1.5
 * - বাড়ী ভাড়া = মূল মজুরি × 50%
 * - চিকিৎসা = 750 (fixed)
 * - যাতায়াত = 450 (fixed)
 * - খাদ্য ভাতা = 1250 (fixed)
 * - ওটি রেট = মূল মজুরি / 104
 */
function calculateSalaryComponents(grossSalary) {
    const gross = parseFloat(grossSalary) || 0;
    
    // Fixed allowances
    const medical = 750;
    const transport = 450;
    const food = 1250;
    const fixedTotal = medical + transport + food; // 2450
    
    // Calculate basic salary
    const basicSalary = (gross - fixedTotal) / 1.5;
    
    // Calculate house rent (50% of basic)
    const houseRent = basicSalary * 0.5;
    
    // Calculate OT rate
    const otRate = basicSalary / 104;
    
    // Verify total
    const totalSalary = basicSalary + houseRent + medical + transport + food;
    
    return {
        basicSalary: Math.round(basicSalary * 100) / 100,
        houseRent: Math.round(houseRent * 100) / 100,
        medical: medical,
        transport: transport,
        food: food,
        totalSalary: Math.round(totalSalary * 100) / 100,
        otRate: Math.round(otRate * 100) / 100
    };
}

/**
 * Update the calculation preview in real-time
 */
function updateSalaryCalculationPreview() {
    const grossInput = document.getElementById('initial-gross-salary');
    if (!grossInput) return;
    
    const gross = parseFloat(grossInput.value) || 0;
    
    if (gross <= 0) {
        document.getElementById('calc-basic').textContent = '৳০';
        document.getElementById('calc-house').textContent = '৳০';
        document.getElementById('calc-total').textContent = '৳০';
        document.getElementById('calc-ot').textContent = '৳০';
        return;
    }
    
    const components = calculateSalaryComponents(gross);
    
    document.getElementById('calc-basic').textContent = formatCurrency(components.basicSalary);
    document.getElementById('calc-house').textContent = formatCurrency(components.houseRent);
    document.getElementById('calc-total').textContent = formatCurrency(components.totalSalary);
    document.getElementById('calc-ot').textContent = formatCurrency(components.otRate);
}

/**
 * Store calculated salary data temporarily
 */
let calculatedSalaryData = null;

/**
 * Handle Grade & Gross Salary form submission
 */
async function handleGradeGrossSubmit(event) {
    event.preventDefault();
    
    const grade = sanitizeInput(document.getElementById('initial-grade').value);
    const grossSalary = sanitizeNumber(document.getElementById('initial-gross-salary').value);
    
    if (!grade || grossSalary <= 0) {
        showToast('সমস্ত ফিল্ড সঠিকভাবে পূরণ করুন', 'error');
        return;
    }
    
    // Calculate components
    const components = calculateSalaryComponents(grossSalary);
    
    // Store for next step
    calculatedSalaryData = {
        grade: grade,
        ...components
    };
    
    // Pre-fill profile setup form
    document.getElementById('setup-grade').value = grade;
    document.getElementById('setup-basic-salary').value = components.basicSalary;
    document.getElementById('setup-house-rent').value = components.houseRent;
    document.getElementById('setup-medical').value = components.medical;
    document.getElementById('setup-transport').value = components.transport;
    document.getElementById('setup-food').value = components.food;
    document.getElementById('setup-total-salary').value = components.totalSalary;
    document.getElementById('setup-ot-rate').value = components.otRate;
    
    showToast('✅ বেতন হিসাব সম্পন্ন!', 'success');
    
    // Move to profile setup
    switchScreen('profile-setup-screen');
}

function getBanglaStatus(status) {
    const statusMap = {
        'present': 'উপস্থিত',
        'absent': 'অনুপস্থিত',
        'leave': 'ছুটি',
        'offday': 'ছুটির দিন',
        'offday-work': 'ছুটির দিন কাজ'
    };
    return statusMap[status] || status;
}

function getBanglaMonth(yearMonth) {
    const [year, month] = yearMonth.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString('bn-BD', { year: 'numeric', month: 'long' });
}

function decodeFormData(text) {
    if (!text || typeof text !== 'string') return text;
    return decodeURIComponent(text.replace(/\+/g, ' '));
}

function cleanProfileData(profile) {
    if (!profile) return profile;

    const cleaned = { ...profile };
    const textFields = ['name', 'company', 'designation', 'section', 'grade', 'cardNo'];

    textFields.forEach(field => {
        if (cleaned[field] && typeof cleaned[field] === 'string') {
            cleaned[field] = cleaned[field].replace(/\+/g, ' ');
        }
    });

    return cleaned;
}

// ============================================================================
// Enhanced Loading Functions
// ============================================================================

function showEnhancedLoading(message = 'আপনার ড্যাশবোর্ড লোড হচ্ছে...') {
    switchScreen('loading-screen');

    if (message) {
        const loadingText = document.querySelector('.loading-content p');
        if (loadingText) {
            loadingText.textContent = message;
        }
    }

    const loadingTips = [
        'সিস্টেম প্রস্তুত করা হচ্ছে...',
        'ডেটা লোড হচ্ছে...',
        'প্রোফাইল তথ্য সংগ্রহ করা হচ্ছে...',
        'অভ্যর্থনা! আপনি লগইন হয়েেছেন...'
    ];

    let tipIndex = 0;
    const tipInterval = setInterval(() => {
        const loadingText = document.querySelector('.loading-content p');
        if (loadingText && tipIndex < loadingTips.length) {
            loadingText.textContent = loadingTips[tipIndex];
            tipIndex++;
        } else {
            clearInterval(tipInterval);
        }
    }, 2000);

    return () => clearInterval(tipInterval);
}
// Failsafe for loading screen
function showEnhancedLoadingWithTimeout(message, timeout = 10000) {
    const cleanup = showEnhancedLoading(message);

    // Auto-hide after timeout
    const timeoutId = setTimeout(() => {
        switchScreen('auth-screen');
        showToast('লোডিং টাইমআউট। আবার চেষ্টা করুন।', 'error');
        if (cleanup) cleanup();
    }, timeout);

    // Return enhanced cleanup function
    return () => {
        clearTimeout(timeoutId);
        if (cleanup) cleanup();
    };
}
// ============================================================================
// Authentication Functions
// ============================================================================

async function handleRegister(event) {
    event.preventDefault();
    const name = sanitizeInput(document.getElementById('register-name').value);
    const id = sanitizeInput(document.getElementById('register-id').value);
    const password = document.getElementById('register-password').value;

    if (!name || !id || !password) {
        showToast('সমস্ত ফিল্ড পূরণ করুন', 'error');
        return;
    }

    // Add validation
    if (!validateEmployeeID(id)) {
        showToast('অবৈধ কর্মচারী আইডি ফরম্যাট', 'error');
        return;
    }

    if (password.length < 6) {
        showToast('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে', 'error');
        return;
    }

    try {
        const cleanupLoading = showEnhancedLoadingWithTimeout('নিবন্ধন প্রক্রিয়া চলছে...', 15000);

        const data = await apiRequest('register', {
            method: 'POST',
            body: { id, name, password },
            skipAuth: true
        });

        saveToken(data.token);
        showToast('নিবন্ধন সফল!', 'success');
        document.getElementById('register-form').reset();

        // Load profile
        await loadProfile(true);

        cleanupLoading();

        // Go to grade/gross modal first
        console.log('Registration complete, going to grade/gross entry');
        switchScreen('grade-gross-modal');
    } catch (error) {
        switchScreen('auth-screen');
        showToast(error.message || 'নিবন্ধন করতে সমস্যা হয়েছে', 'error');
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const id = sanitizeInput(document.getElementById('login-id').value);
    const password = document.getElementById('login-password').value;

    if (!id || !password) {
        showToast('সমস্ত ফিল্ড পূরণ করুন', 'error');
        return;
    }

    // Add validation
    if (!validateEmployeeID(id)) {
        showToast('অবৈধ কর্মচারী আইডি ফরম্যাট', 'error');
        return;
    }

    try {
        const cleanupLoading = showEnhancedLoading('লগইন প্রক্রিয়া চলছে...');

        const data = await apiRequest('login', {
            method: 'POST',
            body: { id, password },
            skipAuth: true
        });

        saveToken(data.token);
        showToast('লগইন সফল!', 'success');
        document.getElementById('login-form').reset();

        // Load profile and wait for it
        await loadProfile(true);

        showEnhancedLoading('প্রোফাইল পরীক্ষা করা হচ্ছে...');

        // Add small delay to ensure profile data is processed
        await new Promise(resolve => setTimeout(resolve, 300));

        cleanupLoading();

        // Navigate based on profile completion status
        if (currentUser.profile && currentUser.profile.profileComplete) {
            console.log('Profile is complete, going to dashboard');
            goToDashboard();
        } else {
            console.log('Profile is incomplete, going to setup');
            goToProfileSetup();
        }
    } catch (error) {
        switchScreen('auth-screen');
        showToast(error.message || 'লগইন করতে সমস্যা হয়েছে', 'error');
    }
}

async function handleLogout() {
    const cleanupLoading = showEnhancedLoading('লগআউট করা হচ্ছে...');

    clearToken();
    currentUser = { token: null, profile: null, profileImage: null };

    apiRequest('logout', { method: 'POST' }).catch(error => {
        console.error('Logout error:', error);
    });

    await new Promise(resolve => setTimeout(resolve, 800));

    cleanupLoading();
    showToast('সফলভাবে লগআউট হয়েছে', 'info');
    switchScreen('auth-screen');
}

// ============================================================================
// AUTO-LOGIN ON PAGE LOAD
// ============================================================================

async function attemptAutoLogin() {
    const token = getToken();

    if (!token) {
        console.log('No saved token found');
        switchScreen('auth-screen');
        return;
    }

    console.log('Found saved token, attempting auto-login...');

    try {
        const cleanupLoading = showEnhancedLoading('আপনার সেশন পুনর্দ্ধার করা হচ্ছে...');

        await loadProfile();

        if (!currentUser.profile.profileComplete) {
            cleanupLoading();
            goToProfileSetup();
        } else {
            cleanupLoading();
            goToDashboard();
        }

        console.log('Auto-login successful');
    } catch (error) {
        console.error('Auto-login failed:', error);
        clearToken();
        switchScreen('auth-screen');
        showToast('আপনার সেশন মেয়াদ শেষ হয়েছে। আবার লগইন করুন।', 'info');
    }
}

// ============================================================================
// Profile Functions
// ============================================================================

async function loadProfile(force = false) {
    // Check cache first
    if (!force && isCacheValid('profile')) {
        currentUser.profile = getCached('profile');
        console.log('Profile loaded from cache');
        return;
    }

    const data = await apiRequest('profile');
    currentUser.profile = cleanProfileData(data.profile);

    // Ensure profileComplete flag is set correctly
    if (!currentUser.profile.profileComplete) {
        currentUser.profile.profileComplete = false;
    }

    setCache('profile', currentUser.profile);
    console.log('Profile loaded from server:', currentUser.profile);
    console.log('Profile complete status:', currentUser.profile.profileComplete);
}

function goToProfileSetup() {
    switchScreen('profile-setup-screen');
}

async function goToDashboard() {
    // Check if profile exists and is complete
    if (!currentUser.profile) {
        showToast('প্রোফাইল লোড করা যায়নি', 'error');
        goToProfileSetup();
        return;
    }

    if (!currentUser.profile.profileComplete) {
        showToast('দয়া করে প্রথমে আপনার প্রোফাইল সম্পূর্ণ করুন', 'warning');
        goToProfileSetup();
        return;
    }

    const cleanupLoading = showEnhancedLoading('ড্যাশবোর্ড প্রস্তুত করা হচ্ছে...');

    switchScreen('dashboard-screen');
    updateCurrentDate();

    try {
        await loadDashboardData();
        cleanupLoading();
    } catch (error) {
        console.error('Dashboard load error:', error);
        showToast('ড্যাশবোর্ড লোড করতে সমস্যা হয়েছে', 'error');
        cleanupLoading();
    }
}

async function handleProfileSetup(event) {
    event.preventDefault();

    const company = sanitizeInput(document.getElementById('setup-company').value);
    const name = sanitizeInput(document.getElementById('setup-name').value);
    const cardNo = sanitizeInput(document.getElementById('setup-card-no').value);
    const section = sanitizeInput(document.getElementById('setup-section').value);
    const designation = sanitizeInput(document.getElementById('setup-designation').value);
    
    // Get calculated salary data (readonly fields)
    const grade = document.getElementById('setup-grade').value;
    const basicSalary = parseFloat(document.getElementById('setup-basic-salary').value);
    const houseRent = parseFloat(document.getElementById('setup-house-rent').value);
    const medical = parseFloat(document.getElementById('setup-medical').value);
    const transport = parseFloat(document.getElementById('setup-transport').value);
    const food = parseFloat(document.getElementById('setup-food').value);
    const otRate = parseFloat(document.getElementById('setup-ot-rate').value);
    
    // Get manual entry fields
    const presentBonus = sanitizeNumber(document.getElementById('setup-present-bonus').value);
    const nightAllowance = sanitizeNumber(document.getElementById('setup-night-allowance').value);
    const tiffinBill = sanitizeNumber(document.getElementById('setup-tiffin').value);
    
    try {
        const cleanupLoading = showEnhancedLoading('প্রোফাইল সংরক্ষণ করা হচ্ছে...');

        await apiRequest('profile/setup', {
            method: 'POST',
            body: {
                company,
                name,
                cardNo,
                section,
                designation,
                grade,
                basicSalary,
                houseRent,
                medical,
                transport,
                food,
                otRate,
                presentBonus,
                nightAllowance,
                tiffinBill,
                profileImage: currentUser.profileImage || ''
            }
        });

        // Force reload profile and wait for it to complete
        await loadProfile(true);

        // Ensure profile is marked as complete
        if (currentUser.profile) {
            currentUser.profile.profileComplete = true;
        }

        cleanupLoading();

        // Show success message AFTER navigation
        showToast('প্রোফাইল সেটআপ সম্পূর্ণ!', 'success');

        // Small delay to ensure smooth transition
        await new Promise(resolve => setTimeout(resolve, 500));

        goToDashboard();
    } catch (error) {
        switchScreen('profile-setup-screen');
        showToast(error.message, 'error');
    }
}

// ============================================================================
// Dashboard Functions - WITH MONTHLY SHEET SUPPORT
// ============================================================================

async function loadDashboardData() {
    try {
        // Update UI with cached profile data immediately
        updateSidebarUser();
        updateProfileDisplay();
        updateAllAvatars();
        updateProfileView();

        // Load data in parallel for better performance
        const [months] = await Promise.all([
            loadAvailableMonths(),
            // Add more parallel requests here if needed
        ]);

        // Then load dependent data
        await populateMonthSelect();

        // Load stats and history in parallel
        await Promise.all([
            loadMonthlyStats(),
            loadWorkHistory()
        ]);

    } catch (error) {
        console.error('Dashboard load error:', error);
        showToast('ড্যাশবোর্ড লোড করতে ত্রুটি', 'error');
    }
}

async function loadAvailableMonths() {
    try {
        const data = await apiRequest('attendance/months');
        availableMonths = data.months || [];
        console.log('📅 Available months:', availableMonths);
    } catch (error) {
        console.error('Failed to load available months:', error);
        // Fallback: use current month
        availableMonths = [getCurrentMonth()];
    }
}

function updateSidebarUser() {
    if (currentUser.profile) {
        document.getElementById('sidebar-user-name').textContent = decodeFormData(currentUser.profile.name);
        document.getElementById('sidebar-user-role').textContent = decodeFormData(currentUser.profile.designation) || 'কর্মচারী';

        if (currentUser.profile.profileImage) {
            const avatar = document.getElementById('sidebar-user-avatar');
            avatar.src = currentUser.profile.profileImage;
            avatar.style.display = 'block';
            avatar.nextElementSibling.style.display = 'none';

            const mobileAvatar = document.getElementById('mobile-user-avatar');
            if (mobileAvatar) {
                mobileAvatar.src = currentUser.profile.profileImage;
                mobileAvatar.style.display = 'block';
                const mobileIcon = mobileAvatar.nextElementSibling;
                if (mobileIcon) {
                    mobileIcon.style.display = 'none';
                }
            }
        }
    }
}

function updateProfileDisplay() {
    if (currentUser.profile) {
        document.getElementById('profile-name').textContent = decodeFormData(currentUser.profile.name);
        document.getElementById('profile-designation').textContent = decodeFormData(currentUser.profile.designation) || 'কর্মচারী';
        document.getElementById('profile-company').textContent = decodeFormData(currentUser.profile.company) || 'N/A';

        // ✅ FIXED: Use medical + transport + food separately
        const totalSalary = (currentUser.profile.basicSalary || 0) +
                           (currentUser.profile.houseRent || 0) +
                           (currentUser.profile.medical || 750) +
                           (currentUser.profile.transport || 450) +
                           (currentUser.profile.food || 1250);
        document.getElementById('profile-salary').textContent = formatCurrency(totalSalary);

        if (currentUser.profile.profileImage) {
            const avatar = document.getElementById('profile-avatar');
            avatar.src = currentUser.profile.profileImage;
            avatar.style.display = 'block';
            avatar.nextElementSibling.style.display = 'none';

            const mobileAvatar = document.getElementById('mobile-user-avatar');
            if (mobileAvatar) {
                mobileAvatar.src = currentUser.profile.profileImage;
                mobileAvatar.style.display = 'block';
                const mobileIcon = mobileAvatar.nextElementSibling;
                if (mobileIcon) {
                    mobileIcon.style.display = 'none';
                }
            }
        }
    }
}

function updateAllAvatars() {
    if (currentUser.profile && currentUser.profile.profileImage) {
        const avatarElements = [
            'sidebar-user-avatar',
            'mobile-user-avatar',
            'profile-avatar',
            'view-profile-photo'
        ];

        avatarElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.src = currentUser.profile.profileImage;
                element.style.display = 'block';
                const icon = element.nextElementSibling;
                if (icon && icon.tagName === 'I') {
                    icon.style.display = 'none';
                }
            }
        });
    }
}

function updateProfileView() {
    if (currentUser.profile) {
        document.getElementById('view-profile-name').textContent = decodeFormData(currentUser.profile.name);
        document.getElementById('view-profile-designation').textContent = decodeFormData(currentUser.profile.designation) || 'কর্মচারী';
        document.getElementById('view-profile-company').textContent = decodeFormData(currentUser.profile.company) || 'N/A';
        document.getElementById('view-profile-id').textContent = decodeFormData(currentUser.profile.id);

        document.getElementById('view-card-no').textContent = decodeFormData(currentUser.profile.cardNo) || 'N/A';
        document.getElementById('view-section').textContent = decodeFormData(currentUser.profile.section) || 'N/A';
        document.getElementById('view-designation').textContent = decodeFormData(currentUser.profile.designation) || 'N/A';
        document.getElementById('view-grade').textContent = decodeFormData(currentUser.profile.grade) || 'N/A';
        document.getElementById('view-basic-salary').textContent = formatCurrency(currentUser.profile.basicSalary || 0);
        document.getElementById('view-house-rent').textContent = formatCurrency(currentUser.profile.houseRent || 0);
        
        // ✅ FIXED: Calculate combined medical+transport+food
        const medicalTransportFood = (currentUser.profile.medical || 750) + 
                                     (currentUser.profile.transport || 450) + 
                                     (currentUser.profile.food || 1250);
        document.getElementById('view-medical-transport').textContent = formatCurrency(medicalTransportFood);

        // ✅ FIXED: Total salary includes all components
        const totalSalary = (currentUser.profile.basicSalary || 0) +
                           (currentUser.profile.houseRent || 0) +
                           (currentUser.profile.medical || 750) +
                           (currentUser.profile.transport || 450) +
                           (currentUser.profile.food || 1250);
        document.getElementById('view-total-salary').textContent = formatCurrency(totalSalary);

        document.getElementById('view-ot-rate').textContent = formatCurrency(currentUser.profile.otRate || 0);
        document.getElementById('view-bonus').textContent = formatCurrency(currentUser.profile.presentBonus || 0);
        document.getElementById('view-night').textContent = formatCurrency(currentUser.profile.nightAllowance || 0);
        document.getElementById('view-tiffin').textContent = formatCurrency(currentUser.profile.tiffinBill || 0);

        if (currentUser.profile.profileImage) {
            const photo = document.getElementById('view-profile-photo');
            photo.src = currentUser.profile.profileImage;
            photo.style.display = 'block';
            photo.nextElementSibling.style.display = 'none';
        }
    }
}

async function loadMonthlyStats() {
    try {
        const selectedMonth = document.getElementById('history-month-select').value || getCurrentMonth();
        const data = await apiRequest(`attendance/stats?month=${selectedMonth}`);
        const stats = data.stats;

     // ✅ FIXED: Calculate base gross salary (per month)
        const grossSalary = (currentUser.profile.basicSalary || 0) +
                           (currentUser.profile.houseRent || 0) +
                           (currentUser.profile.medical || 750) +
                           (currentUser.profile.transport || 450) +
                           (currentUser.profile.food || 1250);

        // Calculate present bonus (presentBonus × presentDays)
        const totalPresentBonus = (currentUser.profile.presentBonus || 0) * stats.presentDays;

        // If there are absent days, deduct from gross salary
        const netAfterDeduction = grossSalary - stats.totalDeduction;

        // Total salary = (gross - deductions) + (present bonus × days)
        const totalSalary = netAfterDeduction + totalPresentBonus;

        // Display format: Gross ± Deductions + Bonus = Total
        let salaryDisplay;

        if (stats.absentDays > 0) {
            // Show: (Gross - Deduction) + Bonus = Total
            salaryDisplay = `${formatCurrency(netAfterDeduction)} + ${formatCurrency(totalPresentBonus)} = ${formatCurrency(totalSalary)}`;
        } else if (totalPresentBonus > 0) {
            // Show: Gross + Bonus = Total
            salaryDisplay = `${formatCurrency(grossSalary)} + ${formatCurrency(totalPresentBonus)} = ${formatCurrency(totalSalary)}`;
        } else {
            // Show: Gross = Total (no bonus, no deductions)
            salaryDisplay = formatCurrency(totalSalary);
        }

        document.getElementById('stat-total-salary').textContent = salaryDisplay;
        document.getElementById('stat-total-ot').textContent = formatBanglaNumber(stats.totalOTHours.toFixed(1)) + 'ঘন্টা';
        document.getElementById('stat-ot-amount').textContent = formatCurrency(stats.totalOTAmount);
        document.getElementById('stat-present').textContent = formatBanglaNumber(stats.presentDays);
        document.getElementById('stat-absent').textContent = formatBanglaNumber(stats.absentDays);
        document.getElementById('stat-deduction').textContent = formatCurrency(stats.totalDeduction);
    } catch (error) {
        console.error('Stats load error:', error);
    }
}

async function loadWorkHistory() {
    const month = document.getElementById('history-month-select').value || getCurrentMonth();
    try {
        const data = await apiRequest(`attendance/history?month=${month}`);
        const tbody = document.getElementById('history-tbody');

        if (data.records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center">কোন রেকর্ড পাওয়া যায়নি</td></tr>';
            return;
        }

        tbody.innerHTML = data.records.map(record => {
            const totalHours = (record.workHours || 0) + (record.otHours || 0);

            // Ensure date is in YYYY-MM-DD format - FIXED VERSION
            let recordDate = record.date;
            if (recordDate instanceof Date) {
                // Use UTC to prevent timezone shifts
                const year = recordDate.getUTCFullYear();
                const month = String(recordDate.getUTCMonth() + 1).padStart(2, '0');
                const day = String(recordDate.getUTCDate()).padStart(2, '0');
                recordDate = `${year}-${month}-${day}`;
            } else if (typeof recordDate === 'string') {
                // Clean the date string and ensure YYYY-MM-DD format
                recordDate = recordDate.split('T')[0].split(' ')[0].trim();
            }

            return `
                <tr data-date="${recordDate}">
                    <td>${formatDate(recordDate)}</td>
                    <td><span class="status-badge status-${record.status}">${getBanglaStatus(record.status)}</span></td>
                    <td>${record.workHours ? formatBanglaNumber(record.workHours.toFixed(1)) + 'ঘন্টা' : '-'}</td>
                    <td>${record.otHours ? formatBanglaNumber(record.otHours.toFixed(1)) + 'ঘন্টা' : '-'}</td>
                    <td>${totalHours > 0 ? formatBanglaNumber(totalHours.toFixed(1)) + 'ঘন্টা' : '-'}</td>
                    <td>${record.earned ? formatCurrency(record.earned) : '-'}</td>
                    <td>${record.deduction ? formatCurrency(record.deduction) : '-'}</td>
                    <td>
                        <button class="btn-delete" onclick="deleteAttendanceRecord('${recordDate}')" title="মুছে ফেলুন">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('History load error:', error);
        showToast('ইতিহাস লোড করতে ত্রুটি', 'error');
    }
}

// ============================================================================
// Optimistic UI Updates - For Faster Perceived Performance
// ============================================================================

/**
 * Updates the UI immediately without waiting for server response
 * Provides instant feedback to users
 */
function optimisticUpdateUI(action, data) {
    console.log('🚀 Optimistic update:', action, data);

    switch(action) {
        case 'add':
            optimisticAddRecord(data);
            break;
        case 'delete':
            optimisticDeleteRecord(data.date);
            break;
    }
}

/**
 * Adds a record to the UI immediately
 */
function optimisticAddRecord(record) {
    // Update stats immediately
    const presentStat = document.getElementById('stat-present');
    const absentStat = document.getElementById('stat-absent');

    if (record.status === 'present') {
        const current = parseInt(presentStat.textContent.replace(/[০-৯,]/g, match =>
            '০১২৩৪৫৬৭৮৯'.indexOf(match) !== -1 ? '০১২৩৪৫৬৭৮৯'.indexOf(match) : match
        )) || 0;
        presentStat.textContent = formatBanglaNumber(current + 1);
    } else if (record.status === 'absent') {
        const current = parseInt(absentStat.textContent.replace(/[০-৯,]/g, match =>
            '০১২৩৪৫৬৭৮৯'.indexOf(match) !== -1 ? '০১২৩৪৫৬৭৮৯'.indexOf(match) : match
        )) || 0;
        absentStat.textContent = formatBanglaNumber(current + 1);
    }

    // Add visual feedback
    showToast('✨ রেকর্ড যুক্ত হচ্ছে...', 'info');
}

/**
 * Removes a record from the UI immediately
 */
function optimisticDeleteRecord(date) {
    const row = document.querySelector(`tr[data-date="${date}"]`);
    if (row) {
        // Add fade-out animation
        row.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        row.style.opacity = '0';
        row.style.transform = 'translateX(-20px)';

        // Remove after animation
        setTimeout(() => {
            row.remove();

            // Check if table is empty
            const tbody = document.getElementById('history-tbody');
            if (tbody.children.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center">কোন রেকর্ড পাওয়া যায়নি</td></tr>';
            }
        }, 300);
    }
}

async function deleteAttendanceRecord(date) {
  // ✅ STEP 1: Clean and format date to YYYY-MM-DD
  let formattedDate = String(date).trim();
  
  // Remove time component
  if (formattedDate.includes('T')) {
    formattedDate = formattedDate.split('T')[0];
  }
  if (formattedDate.includes(' ')) {
    formattedDate = formattedDate.split(' ')[0];
  }
  
  console.log('🗑️ Delete - Formatted date:', formattedDate);
  
  // ✅ STEP 2: Validate format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(formattedDate)) {
    showToast('তারিখ ফরম্যাট সমস্যা', 'error');
    console.error('Invalid date format:', formattedDate);
    return;
  }

  // ✅ STEP 3: Confirm deletion
  const confirmMsg = `আপনি কি ${formatDate(formattedDate)} তারিখের রেকর্ড মুছে ফেলতে চান?`;
  if (!confirm(confirmMsg)) {
    return;
  }

  try {
    console.log('🗑️ Sending delete request for date:', formattedDate);

    // ✅ STEP 4: Optimistic UI update (remove from display immediately)
    optimisticDeleteRecord(formattedDate);
    showToast('🗑️ রেকর্ড মুছে ফেলা হচ্ছে...', 'info');

    // ✅ STEP 5: Send delete request to backend
    const response = await apiRequest('attendance/delete', {
      method: 'POST',
      body: { date: formattedDate }
    });

    console.log('✅ Delete response:', response);

    // Show success
    showToast('✅ রেকর্ড মুছে ফেলা হয়েছে!', 'success');

    // ✅ STEP 6: Refresh data in background
    setTimeout(async () => {
      try {
        await Promise.all([
          loadMonthlyStats(),
          loadWorkHistory(),
          loadAvailableMonths(),
          populateMonthSelect()
        ]);
        console.log('✅ Data refreshed after delete');
      } catch (err) {
        console.error('Background refresh error:', err);
        showToast('📄 পেজ রিলোড করুন', 'warning');
      }
    }, 500);

  } catch (error) {
    console.error('❌ Delete error:', error);
    showToast(error.message || 'রেকর্ড মুছতে সমস্যা হয়েছে', 'error');

    // Reload to show correct data
    await Promise.all([
      loadMonthlyStats(),
      loadWorkHistory()
    ]);
  }
}
// Make the function globally accessible
window.deleteAttendanceRecord = deleteAttendanceRecord;

async function populateMonthSelect() {
    const select = document.getElementById('history-month-select');

    // Always ensure current month is included
    const currentMonth = getCurrentMonth();

    if (availableMonths.length === 0) {
        // Fallback: generate last 12 months
        const months = [];
        const now = new Date();

        for (let i = 0; i < 12; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const label = date.toLocaleString('bn-BD', { month: 'long', year: 'numeric' });
            months.push({ value, label });
        }

        select.innerHTML = months.map(m => `<option value="${m.value}">${m.label}</option>`).join('');
    } else {
        // Use backend months
        const monthsWithCurrent = [...new Set([currentMonth, ...availableMonths])].sort((a, b) => b.localeCompare(a));

        select.innerHTML = monthsWithCurrent.map(month => {
            return `<option value="${month}">${getBanglaMonth(month)}</option>`;
        }).join('');
    }

    // Set current month as default
    if (select.querySelector(`option[value="${currentMonth}"]`)) {
        select.value = currentMonth;
    }
}

// ============================================================================
// Floating Action Button & Modal Functions
// ============================================================================

function initFAB() {
    const fabBtn = document.getElementById('fab-main');
    const modal = document.getElementById('attendance-modal');
    const modalClose = document.getElementById('modal-close');
    const attendanceOptions = document.querySelectorAll('.attendance-option');

    // Open modal
    fabBtn.addEventListener('click', () => {
        modal.classList.add('active');
        resetModal();
    });

    // Close modal
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    // Attendance type selection
    attendanceOptions.forEach(option => {
        option.addEventListener('click', () => {
            const type = option.dataset.type;
            selectAttendanceType(type, option);
        });
    });

    // OT hours change listener
    const otHoursSelect = document.getElementById('ot-hours');
    if (otHoursSelect) {
        otHoursSelect.addEventListener('change', updatePresentCalculation);
    }

    // Form submissions
    document.getElementById('present-form').addEventListener('submit', handlePresentSubmit);
    document.getElementById('absent-form').addEventListener('submit', handleAbsentSubmit);
    document.getElementById('offday-form').addEventListener('submit', handleOffdaySubmit);
    document.getElementById('leave-form').addEventListener('submit', handleLeaveSubmit);
}

function closeModal() {
    const modal = document.getElementById('attendance-modal');
    modal.classList.remove('active');
    resetModal();
}

function resetModal() {
    currentAttendanceType = null;

    document.querySelectorAll('.modal-step').forEach(step => {
        step.classList.remove('active');
    });

    document.getElementById('step-1').classList.add('active');

    document.querySelectorAll('.attendance-option').forEach(option => {
        option.classList.remove('selected');
    });

    document.querySelectorAll('#present-form, #absent-form, #offday-form, #leave-form').forEach(form => {
        form.reset();
    });

    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach(input => {
        input.value = today;
    });

    updatePresentCalculation();
}

function selectAttendanceType(type, element) {
    currentAttendanceType = type;

    document.querySelectorAll('.attendance-option').forEach(option => {
        option.classList.remove('selected');
    });

    element.classList.add('selected');

    setTimeout(() => {
        document.querySelectorAll('.modal-step').forEach(step => {
            step.classList.remove('active');
        });
        document.getElementById(`step-2-${type}`).classList.add('active');
    }, 300);
}

function updatePresentCalculation() {
    const otHours = parseInt(document.getElementById('ot-hours').value) || 0;
    const totalHours = 8 + otHours;

    document.getElementById('preview-ot').textContent = `${formatBanglaNumber(otHours)} ঘন্টা`;
    document.getElementById('preview-total').textContent = `${formatBanglaNumber(totalHours)} ঘন্টা`;

    const tiffinBill = document.getElementById('preview-tiffin');
    const tiffinAmount = document.getElementById('preview-tiffin-amount');

    if (otHours >= 5) {
        tiffinBill.style.display = 'flex';
        tiffinAmount.textContent = formatCurrency(currentUser.profile?.tiffinBill || 0);
    } else {
        tiffinBill.style.display = 'none';
    }

    const nightBill = document.getElementById('preview-night');
    const nightAmount = document.getElementById('preview-night-amount');

    if (otHours >= 7) {
        nightBill.style.display = 'flex';
        nightAmount.textContent = formatCurrency(currentUser.profile?.nightAllowance || 0);
    } else {
        nightBill.style.display = 'none';
    }
}

// ============================================================================
// Attendance Functions
// ============================================================================

// Replace the handlePresentSubmit function in your frontend code

async function handlePresentSubmit(event) {
    event.preventDefault();

    const date = document.getElementById('present-date').value;
    const otHours = parseInt(document.getElementById('ot-hours').value);

    if (!date) {
        showToast('তারিখ নির্বাচন করুন', 'error');
        return;
    }

    const selectedDate = new Date(date + 'T00:00:00'); // Force local timezone
    const isFriday = selectedDate.getDay() === 5;

    // ✅ Check if record already exists for this date
    const existingRecord = checkIfRecordExists(date);
    const isUpdate = existingRecord !== null;

    try {
  // Close modal immediately for better UX
  closeModal();

  // Check if record exists
  const existingRecord = checkIfRecordExists(date);
  const isUpdate = existingRecord !== null;

  // Show appropriate message
  if (isUpdate) {
    showToast('🔄 রেকর্ড আপডেট হচ্ছে...', 'info');
  } else {
    showToast('➕ নতুন রেকর্ড যুক্ত হচ্ছে...', 'info');
  }

  // Optimistic update
  optimisticUpdateUI('add', {
    status: 'present',
    date: date,
    otHours: otHours,
    isFriday: isFriday
  });

  // Send to server
  const requestPromise = apiRequest('attendance/present', {
    method: 'POST',
    body: {
      date: date,
      otHours: otHours,
      isFriday: isFriday,
      workHours: isFriday ? 0 : 8,
      totalHours: isFriday ? otHours : (8 + otHours)
    }
  });

  // Show success message
  if (isUpdate) {
    showToast('✅ রেকর্ড আপডেট হয়েছে!', 'success');
  } else {
    showToast('✅ উপস্থিতি রেকর্ড হয়েছে!', 'success');
  }

  // Wait for server response
  await requestPromise;

  // Refresh data
  setTimeout(() => {
    Promise.all([
      loadMonthlyStats(),
      loadWorkHistory(),
      loadAvailableMonths(),
      populateMonthSelect()
    ]).catch(err => {
      console.error('Background refresh error:', err);
      showToast('🔄 ডেটা রিফ্রেশ করতে পেজ রিলোড করুন', 'warning');
    });
  }, 500);

} catch (error) {
  showToast(error.message, 'error');
  await loadMonthlyStats();
  await loadWorkHistory();
}
}
// Helper function to check if record exists for a date
function checkIfRecordExists(date) {
  const tbody = document.getElementById('history-tbody');
  const rows = tbody.querySelectorAll('tr[data-date]');
  
  // Normalize the input date to YYYY-MM-DD
  const searchDate = String(date).trim().split('T')[0].split(' ')[0];
  
  for (let row of rows) {
    const rowDate = row.getAttribute('data-date');
    if (rowDate === searchDate) {
      return row; // Record exists
    }
  }
  
  return null; // No record found
}

// Also update handleAbsentSubmit, handleOffdaySubmit, and handleLeaveSubmit
// with the same pattern (checking for existing records)

async function handleAbsentSubmit(event) {
    event.preventDefault();

    const date = document.getElementById('absent-date').value;
    const reason = sanitizeInput(document.getElementById('absent-reason').value);

    if (!date) {
        showToast('তারিখ নির্বাচন করুন', 'error');
        return;
    }

    const isUpdate = checkIfRecordExists(date) !== null;

    try {
        closeModal();
        
        if (isUpdate) {
            showToast('🔄 রেকর্ড আপডেট হচ্ছে...', 'info');
        } else {
            showToast('➕ অনুপস্থিতি রেকর্ড করা হচ্ছে...', 'info');
        }

        optimisticUpdateUI('add', { date, reason, status: 'absent' });

        const promise = apiRequest('attendance/absent', {
            method: 'POST',
            body: {
                date: date,
                reason: reason || 'কোন কারণ দেওয়া হয়নি'
            }
        });

        if (isUpdate) {
            showToast('✅ রেকর্ড আপডেট হয়েছে!', 'success');
        } else {
            showToast('✅ অনুপস্থিতি রেকর্ড হয়েছে!', 'warning');
        }

        await promise;

        setTimeout(() => {
            Promise.all([
                loadMonthlyStats(),
                loadWorkHistory(),
                loadAvailableMonths(),
                populateMonthSelect()
            ]);
        }, 500);

    } catch (error) {
        showToast(error.message, 'error');
        await loadMonthlyStats();
        await loadWorkHistory();
    }
}

async function handleOffdaySubmit(event) {
    event.preventDefault();

    const date = document.getElementById('offday-date').value;
    const type = document.getElementById('offday-type').value;

    if (!date) {
        showToast('তারিখ নির্বাচন করুন', 'error');
        return;
    }

    const isUpdate = checkIfRecordExists(date) !== null;

    try {
        closeModal();
        
        if (isUpdate) {
            showToast('🔄 রেকর্ড আপডেট হচ্ছে...', 'info');
        } else {
            showToast('➕ ছুটি রেকর্ড করা হচ্ছে...', 'info');
        }

        optimisticUpdateUI('add', { date, type, status: 'offday' });

        const promise = apiRequest('attendance/offday', {
            method: 'POST',
            body: { date, type }
        });

        if (isUpdate) {
            showToast('✅ রেকর্ড আপডেট হয়েছে!', 'success');
        } else {
            showToast('✅ ছুটি রেকর্ড হয়েছে!', 'success');
        }

        await promise;

        setTimeout(() => {
            Promise.all([
                loadMonthlyStats(),
                loadWorkHistory(),
                loadAvailableMonths(),
                populateMonthSelect()
            ]);
        }, 500);

    } catch (error) {
        showToast(error.message, 'error');
        await loadMonthlyStats();
        await loadWorkHistory();
    }
}

async function handleLeaveSubmit(event) {
    event.preventDefault();

    const date = document.getElementById('leave-date').value;
    const type = document.getElementById('leave-type').value;

    if (!date) {
        showToast('তারিখ নির্বাচন করুন', 'error');
        return;
    }

    const isUpdate = checkIfRecordExists(date) !== null;

    try {
        closeModal();
        
        if (isUpdate) {
            showToast('🔄 রেকর্ড আপডেট হচ্ছে...', 'info');
        } else {
            showToast('➕ ছুটি রেকর্ড করা হচ্ছে...', 'info');
        }

        optimisticUpdateUI('add', { date, type, status: 'leave' });

        const promise = apiRequest('attendance/leave', {
            method: 'POST',
            body: { date, type }
        });

        if (isUpdate) {
            showToast('✅ রেকর্ড আপডেট হয়েছে!', 'success');
        } else {
            showToast('✅ ছুটি রেকর্ড হয়েছে!', 'success');
        }

        await promise;

        setTimeout(() => {
            Promise.all([
                loadMonthlyStats(),
                loadWorkHistory(),
                loadAvailableMonths(),
                populateMonthSelect()
            ]);
        }, 500);

    } catch (error) {
        showToast(error.message, 'error');
        await loadMonthlyStats();
        await loadWorkHistory();
    }
}

async function handleAbsentSubmit(event) {
    event.preventDefault();

    const date = document.getElementById('absent-date').value;
    const reason = sanitizeInput(document.getElementById('absent-reason').value);

    if (!date) {
        showToast('তারিখ নির্বাচন করুন', 'error');
        return;
    }

    try {
        showToast('অনুপস্থিতি রেকর্ড করা হচ্ছে...', 'info');

        closeModal();
        optimisticUpdateUI('absent', { date, reason });

        const promise = apiRequest('attendance/absent', {
            method: 'POST',
            body: {
                date: date,
                reason: reason || 'কোন কারণ দেওয়া হয়নি'
            }
        });

        showToast('অনুপস্থিতি রেকর্ড করা হয়েছে!', 'warning');

        await promise;

        loadMonthlyStats();
        loadWorkHistory();
        loadAvailableMonths();
        populateMonthSelect();

    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function handleOffdaySubmit(event) {
    event.preventDefault();

    const date = document.getElementById('offday-date').value;
    const type = document.getElementById('offday-type').value;

    if (!date) {
        showToast('তারিখ নির্বাচন করুন', 'error');
        return;
    }

    try {
        showToast('ছুটি রেকর্ড করা হচ্ছে...', 'info');

        closeModal();
        optimisticUpdateUI('offday', { date, type });

        const promise = apiRequest('attendance/offday', {
            method: 'POST',
            body: { date, type }
        });

        showToast('ছুটি রেকর্ড করা হয়েছে!', 'success');

        await promise;

        loadMonthlyStats();
        loadWorkHistory();
        loadAvailableMonths();
        populateMonthSelect();

    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function handleLeaveSubmit(event) {
    event.preventDefault();

    const date = document.getElementById('leave-date').value;
    const type = document.getElementById('leave-type').value;

    if (!date) {
        showToast('তারিখ নির্বাচন করুন', 'error');
        return;
    }

    try {
        showToast('ছুটি রেকর্ড করা হচ্ছে...', 'info');

        closeModal();
        optimisticUpdateUI('leave', { date, type });

        const promise = apiRequest('attendance/leave', {
            method: 'POST',
            body: { date, type }
        });

        showToast('ছুটি রেকর্ড করা হয়েছে!', 'success');

        await promise;

        loadMonthlyStats();
        loadWorkHistory();
        loadAvailableMonths();
        populateMonthSelect();

    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ============================================================================
// Profile Edit Functions
// ============================================================================

function toggleProfileEditButton(show) {
    const editButton = document.getElementById('edit-profile-btn');
    if (editButton) {
        editButton.style.display = show ? 'block' : 'none';
    }
}

function showEditProfile() {
    document.getElementById('profile-view-mode').style.display = 'none';
    document.getElementById('profile-edit-mode').style.display = 'block';

    toggleProfileEditButton(false);

    if (currentUser.profile) {
        document.getElementById('edit-company').value = decodeFormData(currentUser.profile.company) || '';
        document.getElementById('edit-name').value = decodeFormData(currentUser.profile.name) || '';
        document.getElementById('edit-card-no').value = decodeFormData(currentUser.profile.cardNo) || '';
        document.getElementById('edit-section').value = decodeFormData(currentUser.profile.section) || '';
        document.getElementById('edit-designation').value = decodeFormData(currentUser.profile.designation) || '';
        document.getElementById('edit-grade').value = decodeFormData(currentUser.profile.grade) || '';
        document.getElementById('edit-basic-salary').value = currentUser.profile.basicSalary || 0;
        document.getElementById('edit-house-rent').value = currentUser.profile.houseRent || 0;
        document.getElementById('edit-medical-transport').value = currentUser.profile.medicalTransport || 0;
        document.getElementById('edit-ot-rate').value = currentUser.profile.otRate || 0;
        document.getElementById('edit-present-bonus').value = currentUser.profile.presentBonus || 0;
        document.getElementById('edit-night-allowance').value = currentUser.profile.nightAllowance || 0;
        document.getElementById('edit-tiffin').value = currentUser.profile.tiffinBill || 0;

        if (currentUser.profile.profileImage) {
            const preview = document.getElementById('edit-photo-preview');
            preview.innerHTML = `<img src="${currentUser.profile.profileImage}" alt="প্রিভিউ">`;
            currentUser.profileImage = currentUser.profile.profileImage;
        }
    }
}

function cancelEditProfile() {
    document.getElementById('profile-view-mode').style.display = 'block';
    document.getElementById('profile-edit-mode').style.display = 'none';

    toggleProfileEditButton(true);

    document.getElementById('edit-profile-form').reset();
}

async function handleEditProfile(event) {
    event.preventDefault();

    const company = sanitizeInput(document.getElementById('edit-company').value);
    const name = sanitizeInput(document.getElementById('edit-name').value);
    const cardNo = sanitizeInput(document.getElementById('edit-card-no').value);
    const section = sanitizeInput(document.getElementById('edit-section').value);
    const designation = sanitizeInput(document.getElementById('edit-designation').value);
    const grade = sanitizeInput(document.getElementById('edit-grade').value);
    const basicSalary = sanitizeNumber(document.getElementById('edit-basic-salary').value);
    const houseRent = sanitizeNumber(document.getElementById('edit-house-rent').value);
    const medicalTransport = sanitizeNumber(document.getElementById('edit-medical-transport').value);
    const otRate = sanitizeNumber(document.getElementById('edit-ot-rate').value);
    const presentBonus = sanitizeNumber(document.getElementById('edit-present-bonus').value);
    const nightAllowance = sanitizeNumber(document.getElementById('edit-night-allowance').value);
    const tiffinBill = sanitizeNumber(document.getElementById('edit-tiffin').value);

    try {
        showToast('প্রোফাইল আপডেট করা হচ্ছে...', 'info');

        await apiRequest('profile/setup', {
            method: 'POST',
            body: {
                company,
                name,
                cardNo,
                section,
                designation,
                grade,
                basicSalary,
                houseRent,
                medicalTransport,
                otRate,
                presentBonus,
                nightAllowance,
                tiffinBill,
                profileImage: currentUser.profileImage || ''
            }
        });

        showToast('প্রোফাইল সফলভাবে আপডেট করা হয়েছে!', 'success');
        await loadProfile();

        updateSidebarUser();
        updateProfileDisplay();
        updateProfileView();
        updateAllAvatars();

        cancelEditProfile();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ============================================================================
// Image Handling
// ============================================================================

function handleImageUpload(event, previewId) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        showToast('ছবির আকার 2MB এর কম হতে হবে', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        currentUser.profileImage = e.target.result;
        const preview = document.getElementById(previewId);
        preview.innerHTML = `<img src="${e.target.result}" alt="প্রিভিউ">`;
    };
    reader.readAsDataURL(file);
}

// ============================================================================
// Event Listeners Setup
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('Application starting...');

    // Auth Tab Switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
            document.getElementById(`${tabName}-form`).classList.add('active');
        });
    });

    // Form Submissions
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('profile-setup-form').addEventListener('submit', handleProfileSetup);
    document.getElementById('edit-profile-form').addEventListener('submit', handleEditProfile);

    // Logout Button
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Navigation Links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const view = link.dataset.view;
            if (view) switchView(view);
        });
    });

    // Mobile Menu Toggle
    document.getElementById('menu-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.add('mobile-open');
    });

    document.getElementById('sidebar-close').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('mobile-open');
    });

    // Image Upload - Profile Setup
    document.getElementById('upload-photo-btn').addEventListener('click', () => {
        document.getElementById('profile-image').click();
    });
    document.getElementById('profile-image').addEventListener('change', (e) => {
        handleImageUpload(e, 'setup-photo-preview');
    });

    // Image Upload - Profile Edit
    document.getElementById('edit-upload-photo-btn').addEventListener('click', () => {
        document.getElementById('edit-profile-image').click();
    });
    document.getElementById('edit-profile-image').addEventListener('change', (e) => {
        handleImageUpload(e, 'edit-photo-preview');
    });

    // Profile Edit Buttons
    document.getElementById('edit-profile-btn').addEventListener('click', showEditProfile);

    // Banner Edit Button
    document.getElementById('banner-edit-profile-btn').addEventListener('click', () => {
        switchView('profile');
        setTimeout(() => {
            showEditProfile();
        }, 100);
    });

    document.getElementById('cancel-edit-btn').addEventListener('click', cancelEditProfile);

    // History Month Select - WITH RELOAD SUPPORT
    document.getElementById('history-month-select').addEventListener('change', async () => {
        await loadMonthlyStats();
        await loadWorkHistory();
    });

    // Initialize FAB
    initFAB();

    // Setup token refresh checking
    setupTokenRefresh();

    // Set default date values
    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach(input => {
        input.value = today;
    });
    // Grade & Gross Salary form
    const gradeGrossForm = document.getElementById('grade-gross-form');
    if (gradeGrossForm) {
        gradeGrossForm.addEventListener('submit', handleGradeGrossSubmit);
        console.log('✅ Grade/Gross form listener added');
    }
    
    // Real-time calculation update
    const grossSalaryInput = document.getElementById('initial-gross-salary');
    if (grossSalaryInput) {
        grossSalaryInput.addEventListener('input', updateSalaryCalculationPreview);
        console.log('✅ Real-time calculation listener added');
    }
    // Attempt auto-login on page load
    console.log('Attempting auto-login...');
    attemptAutoLogin();
});

// ============================================================================
// Export for debugging (optional)
// ============================================================================
window.employeePortal = {
    currentUser,
    availableMonths,
    switchScreen,
    switchView,
    showToast,
    toBanglaNumber,
    formatBanglaNumber,
    formatCurrency,
    getToken,
    clearToken,
    attemptAutoLogin,
    loadAvailableMonths,
    populateMonthSelect
};
