// ============================================================================
// Employee Portal - Google Apps Script Backend (CORRECTED VERSION)
// Fixed to work perfectly with the frontend code
// ============================================================================

// SHEET NAMES
const SHEETS = {
  USERS: 'Users',
  PROFILES: 'Profiles',
  SESSIONS: 'Sessions'
  // Attendance sheets will be dynamic: Attendance_YYYY_MM
};

// ============================================================================
// Secure Password Hashing
// ============================================================================

function hashPassword(password, salt) {
  if (!password) return '';

  // Generate salt if not provided (for new passwords)
  if (!salt) {
    salt = Utilities.getUuid();
  }

  // Combine password with salt
  const combined = password + salt;

  // Use SHA-256 for secure hashing
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    combined,
    Utilities.Charset.UTF_8
  );

  // Convert to hexadecimal string
  const hash = digest.map(byte => {
    const unsignedByte = byte < 0 ? 256 + byte : byte;
    return unsignedByte.toString(16).padStart(2, '0');
  }).join('');

  // Return hash and salt separated by colon
  return hash + ':' + salt;
}

// Add helper function to verify password
function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) {
    // Old format (no salt) - backward compatibility
    return hashPassword(password).split(':')[0] === storedHash;
  }

  const [hash, salt] = storedHash.split(':');
  const newHash = hashPassword(password, salt).split(':')[0];
  return hash === newHash;
}
function validateAndSanitize(input, type = 'text', maxLength = 200) {
  if (input === null || input === undefined) return null;

  let value = String(input).trim();

  if (value.length > maxLength) {
    throw new Error('ইনপুট অত্যধিক লম্বা');
  }

  switch(type) {
    case 'id':
      if (!/^[A-Za-z0-9_-]{3,20}$/.test(value)) {
        throw new Error('অবৈধ আইডি ফরম্যাট');
      }
      break;
    case 'number':
      const num = parseFloat(value);
      if (isNaN(num) || num < 0) {
        throw new Error('অবৈধ সংখ্যা');
      }
      return num;
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error('অবৈধ তারিখ ফরম্যাট');
      }
      break;
  }

  return value;
}


// ============================================================================
// Monthly Sheet Management
// ============================================================================

/**
 * Gets the attendance sheet name for a specific month
 * Format: Attendance_YYYY_MM (e.g., Attendance_2025_01)
 */
function getAttendanceSheetName(yearMonth) {
  if (!yearMonth) {
    const now = new Date();
    yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  // Convert YYYY-MM to Attendance_YYYY_MM
  const parts = yearMonth.split('-');
  return `Attendance_${parts[0]}_${parts[1]}`;
}

/**
 * Gets or creates an attendance sheet for a specific month
 */
function getOrCreateAttendanceSheet(yearMonth) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = getAttendanceSheetName(yearMonth);

  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    Logger.log('📋 Creating new attendance sheet: ' + sheetName);
    sheet = ss.insertSheet(sheetName);

    // Add header row
    sheet.appendRow([
      'UserID', 'Date', 'Status', 'WorkHours', 'OTHours', 'TotalHours',
      'Earned', 'Deduction', 'Details', 'Created'
    ]);

    // Format header
    const headerRange = sheet.getRange(1, 1, 1, 10);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('#ffffff');

    sheet.setFrozenRows(1);

    for (let i = 1; i <= 10; i++) {
      sheet.autoResizeColumn(i);
    }

    Logger.log('✅ New attendance sheet created: ' + sheetName);
  }

  return sheet;
}

/**
 * Gets the month from a date string (YYYY-MM-DD -> YYYY-MM)
 */
function getMonthFromDate(dateStr) {
  const parts = dateStr.split('-');
  return `${parts[0]}-${parts[1]}`;
}

/**
 * Lists all available attendance months
 */
function getAvailableMonths() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const months = [];

  const pattern = /^Attendance_(\d{4})_(\d{2})$/;

  sheets.forEach(sheet => {
    const match = sheet.getName().match(pattern);
    if (match) {
      const year = match[1];
      const month = match[2];
      months.push(`${year}-${month}`);
    }
  });

  // Sort descending (newest first)
  months.sort((a, b) => b.localeCompare(a));

  // Always include current month even if no records yet
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (!months.includes(currentMonth)) {
    months.unshift(currentMonth);
  }

  return months;
}

// ============================================================================
// Main doGet Handler
// ============================================================================
// ============================================================================
// Main doGet Handler
// ============================================================================
function doGet(e) {
  const path = e.parameter.path || '';
  const auth = e.parameter.authorization || '';

  Logger.log('=== doGet Request ===');
  Logger.log('Path: ' + path);
  Logger.log('Auth header present: ' + (auth ? 'Yes' : 'No'));

  try {
    // ===== PUBLIC ENDPOINTS (No Authentication Required) =====
    // These endpoints work WITHOUT a token

    if (path === 'health') {
      Logger.log('✅ Health check - returning success');
      return jsonResponse({ ok: true, message: 'Server is running' });
    }

    // ===== PROTECTED ENDPOINTS (Authentication Required) =====
    // All other endpoints need authentication

    if (!auth) {
      Logger.log('❌ No authorization header provided');
      return jsonResponse({ ok: false, error: 'অননুমোদিত অ্যাক্সেস - টোকেন প্রয়োজন' }, 401);
    }

    const user = validateToken(auth);
    if (!user) {
      Logger.log('❌ Token validation failed');
      return jsonResponse({ ok: false, error: 'অননুমোদিত অ্যাক্সেস - অবৈধ টোকেন' }, 401);
    }

    Logger.log('✅ Token valid for user: ' + user.id);

    // Route to protected handlers
    if (path === 'profile') {
      return handleGetProfile(user);
    } else if (path.startsWith('attendance/stats')) {
      const month = e.parameter.month;
      return handleGetStats(user, month);
    } else if (path.startsWith('attendance/history')) {
      const month = e.parameter.month;
      return handleGetHistory(user, month);
    } else if (path === 'attendance/months') {
      return handleGetAvailableMonths(user);
    }

    // If we get here, the endpoint doesn't exist
    Logger.log('❌ Unknown endpoint: ' + path);
    return jsonResponse({ ok: false, error: 'এন্ডপয়েন্ট খুঁজে পাওয়া যায়নি' }, 404);

  } catch (error) {
    Logger.log('❌ Error in doGet: ' + error.toString());
    Logger.log(error.stack);

    const userMessage = error.message.includes('সমস্ত') ||
                       error.message.includes('অবৈধ') ||
                       error.message.includes('ইনপুট')
        ? error.message
        : 'সার্ভার ত্রুটি। পরে আবার চেষ্টা করুন।';

    return jsonResponse({ ok: false, error: userMessage }, 500);
  }
}

// ============================================================================
// Main doPost Handler
// ============================================================================
function doPost(e) {
  const path = e.parameter.path || '';
  const auth = e.parameter.authorization || '';

  Logger.log('=== doPost Request ===');
  Logger.log('Path: ' + path);
  Logger.log('Auth header present: ' + (auth ? 'Yes' : 'No'));

  try {
    // ===== PUBLIC ENDPOINTS (No Authentication Required) =====

    if (path === 'register') {
      Logger.log('📝 Processing registration');
      return handleRegister(e.parameter);
    }

    if (path === 'login') {
      Logger.log('🔐 Processing login');
      return handleLogin(e.parameter);
    }

    // ===== PROTECTED ENDPOINTS (Authentication Required) =====

    if (!auth) {
      Logger.log('❌ No authorization header provided');
      return jsonResponse({ ok: false, error: 'অননুমোদিত অ্যাক্সেস - টোকেন প্রয়োজন' }, 401);
    }

    const user = validateToken(auth);
    if (!user) {
      Logger.log('❌ Token validation failed');
      return jsonResponse({ ok: false, error: 'অননুমোদিত অ্যাক্সেস - অবৈধ টোকেন' }, 401);
    }

    Logger.log('✅ Token valid for user: ' + user.id);

    // Route to protected handlers
    if (path === 'logout') {
      return handleLogout(user, auth);
    } else if (path === 'profile/setup') {
      return handleProfileSetup(user, e.parameter);
    } else if (path === 'attendance/present') {
      return handlePresent(user, e.parameter);
    } else if (path === 'attendance/absent') {
      return handleAbsent(user, e.parameter);
    } else if (path === 'attendance/offday') {
      return handleOffday(user, e.parameter);
    } else if (path === 'attendance/leave') {
      return handleLeave(user, e.parameter);
    } else if (path === 'attendance/delete') {
    return handleDeleteAttendance(user, e.parameter);
    }

    // If we get here, the endpoint doesn't exist
    Logger.log('❌ Unknown endpoint: ' + path);
    return jsonResponse({ ok: false, error: 'এন্ডপয়েন্ট খুঁজে পাওয়া যায়নি' }, 404);

  } catch (error) {
    Logger.log('❌ Error in doPost: ' + error.toString());
    Logger.log(error.stack);

    const userMessage = error.message.includes('সমস্ত') ||
                       error.message.includes('অবৈধ') ||
                       error.message.includes('ইনপুট')
        ? error.message
        : 'সার্ভার ত্রুটি। পরে আবার চেষ্টা করুন।';

    return jsonResponse({ ok: false, error: userMessage }, 500);
  }
}

// ============================================================================
// OPTIONS Handler for CORS Preflight
// ============================================================================

function doOptions(e) {
  // Handle CORS preflight requests
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ============================================================================
// Authentication Handlers
// ============================================================================

function handleRegister(params) {
  let id, name, password;

  try {
    id = validateAndSanitize(params.id, 'id');
    name = validateAndSanitize(params.name, 'text', 100);
    password = params.password;

    Logger.log('📝 Register attempt for ID: ' + id);

    if (!id || !name || !password) {
      return jsonResponse({ ok: false, error: 'সমস্ত ফিল্ড পূরণ করুন' });
    }
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }

  // Validate password length
  if (password.length < 6) {
    return jsonResponse({ ok: false, error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let usersSheet = ss.getSheetByName(SHEETS.USERS);

  if (!usersSheet) {
    usersSheet = ss.insertSheet(SHEETS.USERS);
    usersSheet.appendRow(['ID', 'Name', 'Password', 'Created', 'LastLogin']);
  }

  // Check if user exists
  const data = usersSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(id).trim()) {
      return jsonResponse({ ok: false, error: 'এই আইডি ইতিমধ্যে নিবন্ধিত আছে' });
    }
  }

  // Hash password securely WITH SALT
  const hashedPassword = hashPassword(password);

  // Add user
  usersSheet.appendRow([id, name, hashedPassword, new Date(), '']);
  Logger.log('✅ User created');

  // Create token
  const token = createToken(id);

  return jsonResponse({ ok: true, token: token });
}

function handleLogin(params) {
  const { id, password } = params;

  Logger.log('🔑 Login attempt for ID: ' + id);

  if (!id || !password) {
    return jsonResponse({ ok: false, error: 'সমস্ত ফিল্ড পূরণ করুন' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usersSheet = ss.getSheetByName(SHEETS.USERS);

  if (!usersSheet) {
    return jsonResponse({ ok: false, error: 'কোন ব্যবহারকারী পাওয়া যায়নি' });
  }

  const data = usersSheet.getDataRange().getValues();

  // Search for user
  for (let i = 1; i < data.length; i++) {
    const storedId = String(data[i][0]).trim();
    const storedHash = String(data[i][2]).trim();

    if (storedId === String(id).trim()) {
      // Use new verification function
      if (verifyPassword(password, storedHash)) {
        // Update last login
        usersSheet.getRange(i + 1, 5).setValue(new Date());

        // Create token
        const token = createToken(id);
        Logger.log('✅ Login successful');

        return jsonResponse({ ok: true, token: token });
      } else {
        return jsonResponse({ ok: false, error: 'ভুল আইডি বা পাসওয়ার্ড' });
      }
    }
  }

  return jsonResponse({ ok: false, error: 'ভুল আইডি বা পাসওয়ার্ড' });
}

function handleLogout(user, authHeader) {
  const token = authHeader.substring(7);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionsSheet = ss.getSheetByName(SHEETS.SESSIONS);

  if (sessionsSheet) {
    const data = sessionsSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === token) {
        sessionsSheet.deleteRow(i + 1);
        break;
      }
    }
  }

  return jsonResponse({ ok: true, message: 'সফলভাবে লগআউট হয়েছে' });
}

// ============================================================================
// Profile Handlers
// ============================================================================

function handleGetProfile(user) {
  Logger.log('📋 Getting profile for: ' + user.id);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let profilesSheet = ss.getSheetByName(SHEETS.PROFILES);

  if (!profilesSheet) {
    return jsonResponse({
      ok: true,
      profile: {
        id: user.id,
        profileComplete: false
      }
    });
  }

  const data = profilesSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(user.id).trim()) {
      return jsonResponse({
        ok: true,
        profile: {
          id: user.id,
          name: data[i][1] || '',
          company: data[i][2] || '',
          cardNo: data[i][3] || '',
          section: data[i][4] || '',
          designation: data[i][5] || '',
          grade: data[i][6] || '',
          basicSalary: Number(data[i][7]) || 0,
          houseRent: Number(data[i][8]) || 0,
          medicalTransport: Number(data[i][9]) || 0,
          otRate: Number(data[i][10]) || 0,
          presentBonus: Number(data[i][11]) || 0,
          nightAllowance: Number(data[i][12]) || 0,
          tiffinBill: Number(data[i][13]) || 0,
          profileImage: data[i][14] || '',
          profileComplete: true
        }
      });
    }
  }

  return jsonResponse({
    ok: true,
    profile: {
      id: user.id,
      profileComplete: false
    }
  });
}

function handleProfileSetup(user, params) {
  Logger.log('⚙️ Setting up profile for: ' + user.id);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let profilesSheet = ss.getSheetByName(SHEETS.PROFILES);

  if (!profilesSheet) {
    profilesSheet = ss.insertSheet(SHEETS.PROFILES);
    profilesSheet.appendRow([
      'ID', 'Name', 'Company', 'CardNo', 'Section', 'Designation', 'Grade',
      'BasicSalary', 'HouseRent', 'MedicalTransport', 'OTRate',
      'PresentBonus', 'NightAllowance', 'TiffinBill', 'ProfileImage', 'Updated'
    ]);
  }

  const data = profilesSheet.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(user.id).trim()) {
      rowIndex = i + 1;
      break;
    }
  }

  const profileData = [
    user.id,
    params.name || '',
    params.company || '',
    params.cardNo || '',
    params.section || '',
    params.designation || '',
    params.grade || '',
    Number(params.basicSalary) || 0,
    Number(params.houseRent) || 0,
    Number(params.medicalTransport) || 0,
    Number(params.otRate) || 0,
    Number(params.presentBonus) || 0,
    Number(params.nightAllowance) || 0,
    Number(params.tiffinBill) || 0,
    params.profileImage || '',
    new Date()
  ];

  if (rowIndex > 0) {
    profilesSheet.getRange(rowIndex, 1, 1, profileData.length).setValues([profileData]);
    Logger.log('✅ Profile updated');
  } else {
    profilesSheet.appendRow(profileData);
    Logger.log('✅ New profile created');
  }

  return jsonResponse({ ok: true, message: 'প্রোফাইল সংরক্ষিত হয়েছে' });
}

// ============================================================================
// Attendance Handlers
// ============================================================================

function handlePresent(user, params) {
  const { date, otHours, isFriday, workHours } = params;

  Logger.log('✓ Recording present for ' + user.id + ' on ' + date);

  if (!date) {
    return jsonResponse({ ok: false, error: 'তারিখ প্রয়োজন' });
  }

  const profile = getProfile(user.id);
  if (!profile) {
    return jsonResponse({ ok: false, error: 'প্রোফাইল পাওয়া যায়নি' });
  }

  const ot = Number(otHours) || 0;
  const work = Number(workHours) || 8;
  const isFri = String(isFriday) === 'true';

  // Calculate daily salary (gross salary / 30)
  const dailySalary = (profile.basicSalary + profile.houseRent + profile.medicalTransport) / 30;

  let earned = 0;

  if (isFri) {
    // Friday: Only OT earnings + bonus
    earned = (ot * profile.otRate) + profile.presentBonus;
  } else {
    // Regular day: Daily salary + OT + bonus
    earned = dailySalary + (ot * profile.otRate) + profile.presentBonus;
  }

  // Add tiffin bill if 5+ hours OT
  if (ot >= 5) {
    earned += profile.tiffinBill;
  }

  // Add night allowance if 7+ hours OT
  if (ot >= 7) {
    earned += profile.nightAllowance;
  }

  // Save record
  saveAttendanceRecord({
    userId: user.id,
    date: date,
    status: 'present',
    workHours: work,
    otHours: ot,
    totalHours: work + ot,
    earned: earned,
    deduction: 0,
    details: isFri ? 'Friday Work' : 'Regular Work'
  });

  return jsonResponse({ ok: true, message: 'উপস্থিতি রেকর্ড হয়েছে' });
}

function handleAbsent(user, params) {
  const { date, reason } = params;

  if (!date) {
    return jsonResponse({ ok: false, error: 'তারিখ প্রয়োজন' });
  }

  const profile = getProfile(user.id);
  if (!profile) {
    return jsonResponse({ ok: false, error: 'প্রোফাইল পাওয়া যায়নি' });
  }

  // Deduct only basic salary per day
  const dailyDeduction = profile.basicSalary / 30;

  saveAttendanceRecord({
    userId: user.id,
    date: date,
    status: 'absent',
    workHours: 0,
    otHours: 0,
    totalHours: 0,
    earned: 0,
    deduction: dailyDeduction,
    details: reason || 'No reason provided'
  });

  return jsonResponse({ ok: true, message: 'অনুপস্থিতি রেকর্ড হয়েছে' });
}

function handleOffday(user, params) {
  const { date, type } = params;

  if (!date) {
    return jsonResponse({ ok: false, error: 'তারিখ প্রয়োজন' });
  }

  saveAttendanceRecord({
    userId: user.id,
    date: date,
    status: 'offday',
    workHours: 0,
    otHours: 0,
    totalHours: 0,
    earned: 0,
    deduction: 0,
    details: type || 'offday'
  });

  return jsonResponse({ ok: true, message: 'ছুটি রেকর্ড হয়েছে' });
}

function handleLeave(user, params) {
  const { date, type } = params;

  if (!date) {
    return jsonResponse({ ok: false, error: 'তারিখ প্রয়োজন' });
  }

  saveAttendanceRecord({
    userId: user.id,
    date: date,
    status: 'leave',
    workHours: 0,
    otHours: 0,
    totalHours: 0,
    earned: 0,
    deduction: 0,
    details: type || 'leave'
  });

  return jsonResponse({ ok: true, message: 'ছুটি রেকর্ড হয়েছে' });
}
function handleDeleteAttendance(user, params) {
  const { date } = params;

  Logger.log('🗑️ Deleting attendance record for ' + user.id + ' on ' + date);

  if (!date) {
    return jsonResponse({ ok: false, error: 'তারিখ প্রয়োজন' });
  }

  try {
    // Get the month from the date
    const month = getMonthFromDate(date);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = getAttendanceSheetName(month);
    const attendanceSheet = ss.getSheetByName(sheetName);

    if (!attendanceSheet) {
      return jsonResponse({ ok: false, error: 'এই মাসের কোন রেকর্ড নেই' });
    }

    const data = attendanceSheet.getDataRange().getValues();
    let rowToDelete = -1;

    // Find the record to delete
    for (let i = 1; i < data.length; i++) {
      const rowUserId = String(data[i][0]).trim();
      const rowDate = data[i][1];
      
      // Convert date to string for comparison
      let rowDateStr;
      if (rowDate instanceof Date) {
        rowDateStr = Utilities.formatDate(rowDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        rowDateStr = String(rowDate);
      }
      
      Logger.log('Comparing: ' + rowUserId + ' === ' + user.id + ' && ' + rowDateStr + ' === ' + date);
      
      if (rowUserId === String(user.id).trim() && rowDateStr === String(date)) {
        rowToDelete = i + 1; // +1 because sheet rows are 1-indexed
        Logger.log('Found matching record at row: ' + rowToDelete);
        break;
      }
    }

    if (rowToDelete === -1) {
      Logger.log('No matching record found');
      return jsonResponse({ ok: false, error: 'রেকর্ড খুঁজে পাওয়া যায়নি' });
    }

    // Delete the row
    attendanceSheet.deleteRow(rowToDelete);
    Logger.log('✅ Record deleted successfully');

    return jsonResponse({ ok: true, message: 'রেকর্ড সফলভাবে মুছে ফেলা হয়েছে' });

  } catch (error) {
    Logger.log('❌ Delete error: ' + error.toString());
    return jsonResponse({ ok: false, error: 'রেকর্ড মুছতে সমস্যা হয়েছে' });
  }
}
// ============================================================================
// Stats & History Handlers
// ============================================================================

function handleGetStats(user, month) {
  const records = getAttendanceRecords(user.id, month);
  const profile = getProfile(user.id);

  let presentDays = 0;
  let absentDays = 0;
  let totalOTHours = 0;
  let totalOTAmount = 0;
  let totalDeduction = 0;

  records.forEach(record => {
    if (record.status === 'present') {
      presentDays++;
      totalOTHours += Number(record.otHours) || 0;
      if (profile) {
        totalOTAmount += (Number(record.otHours) || 0) * profile.otRate;
      }
    } else if (record.status === 'absent') {
      absentDays++;
      totalDeduction += Number(record.deduction) || 0;
    }
  });

  return jsonResponse({
    ok: true,
    stats: {
      presentDays: presentDays,
      absentDays: absentDays,
      totalOTHours: totalOTHours,
      totalOTAmount: totalOTAmount,
      totalDeduction: totalDeduction
    }
  });
}

function handleGetHistory(user, month) {
  const records = getAttendanceRecords(user.id, month);

  return jsonResponse({
    ok: true,
    records: records
  });
}

function handleGetAvailableMonths(user) {
  const months = getAvailableMonths();

  return jsonResponse({
    ok: true,
    months: months
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

function saveAttendanceRecord(record) {
  const month = getMonthFromDate(record.date);
  const attendanceSheet = getOrCreateAttendanceSheet(month);

  const data = attendanceSheet.getDataRange().getValues();

  // Check if record exists
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(record.userId).trim() &&
        String(data[i][1]) === String(record.date)) {
      // Update existing
      attendanceSheet.getRange(i + 1, 3, 1, 8).setValues([[
        record.status,
        record.workHours,
        record.otHours,
        record.totalHours,
        record.earned,
        record.deduction,
        record.details,
        new Date()
      ]]);
      Logger.log('✅ Record updated');
      return;
    }
  }

  // Add new record
  attendanceSheet.appendRow([
    record.userId,
    record.date,
    record.status,
    record.workHours,
    record.otHours,
    record.totalHours,
    record.earned,
    record.deduction,
    record.details,
    new Date()
  ]);
  Logger.log('✅ New record created');
}

function getAttendanceRecords(userId, month) {
  if (!month) {
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = getAttendanceSheetName(month);
  const attendanceSheet = ss.getSheetByName(sheetName);

  if (!attendanceSheet) {
    return [];
  }

  const data = attendanceSheet.getDataRange().getValues();
  const records = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(userId).trim()) {
      records.push({
        date: data[i][1],
        status: data[i][2],
        workHours: Number(data[i][3]) || 0,
        otHours: Number(data[i][4]) || 0,
        totalHours: Number(data[i][5]) || 0,
        earned: Number(data[i][6]) || 0,
        deduction: Number(data[i][7]) || 0,
        details: data[i][8] || ''
      });
    }
  }

  records.sort((a, b) => new Date(b.date) - new Date(a.date));

  return records;
}

function getProfile(userId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const profilesSheet = ss.getSheetByName(SHEETS.PROFILES);

  if (!profilesSheet) {
    return null;
  }

  const data = profilesSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(userId).trim()) {
      return {
        id: userId,
        basicSalary: Number(data[i][7]) || 0,
        houseRent: Number(data[i][8]) || 0,
        medicalTransport: Number(data[i][9]) || 0,
        otRate: Number(data[i][10]) || 0,
        presentBonus: Number(data[i][11]) || 0,
        nightAllowance: Number(data[i][12]) || 0,
        tiffinBill: Number(data[i][13]) || 0
      };
    }
  }

  return null;
}

// ============================================================================
// Token Management
// ============================================================================

function createToken(userId) {
  const timestamp = new Date().getTime();
  const randomPart = Utilities.getUuid(); // More secure random
  const tokenData = userId + ':' + timestamp + ':' + randomPart;
  const token = Utilities.base64Encode(tokenData);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sessionsSheet = ss.getSheetByName(SHEETS.SESSIONS);

  if (!sessionsSheet) {
    sessionsSheet = ss.insertSheet(SHEETS.SESSIONS);
    sessionsSheet.appendRow(['Token', 'UserID', 'Created', 'Expires', 'LastUsed']);
  }

  // Reduced to 24 hours for better security
  const expires = new Date(timestamp + (24 * 60 * 60 * 1000));
  sessionsSheet.appendRow([token, userId, new Date(), expires, new Date()]);

  return token;
}

function validateToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7).trim();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionsSheet = ss.getSheetByName(SHEETS.SESSIONS);

  if (!sessionsSheet) {
    return null;
  }

  const data = sessionsSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const storedToken = String(data[i][0]).trim();

    if (storedToken === token) {
      const userId = data[i][1];
      const expires = new Date(data[i][3]);
      const now = new Date();

      if (now < expires) {
        return { id: userId };
      } else {
        sessionsSheet.deleteRow(i + 1);
        return null;
      }
    }
  }

  return null;
}

// ============================================================================
// Response Helper
// ============================================================================

function jsonResponse(data, status = 200) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);

  // Note: CORS headers are automatically handled by Google Apps Script web apps
  // No need to manually set headers - they're added automatically

  return output;
}
