// ============================================================================
// Employee Portal - Google Apps Script Backend (COMPLETE - ALL FIXES)
// ✅ Auto-replace duplicate entries
// ✅ Fixed delete function
// ✅ Fixed timezone issues (Asia/Dhaka)
// ============================================================================

// SHEET NAMES
const SHEETS = {
  USERS: 'Users',
  PROFILES: 'Profiles',
  SESSIONS: 'Sessions'
};

// ============================================================================
// Date Normalization - TIMEZONE FIXED
// ============================================================================

function normalizeDateToString(dateInput) {
  if (!dateInput) return null;
  
  let dateStr = '';
  
  if (dateInput instanceof Date) {
    // ✅ Use Asia/Dhaka timezone to prevent date shifts
    dateStr = Utilities.formatDate(dateInput, 'Asia/Dhaka', 'yyyy-MM-dd');
  } else if (typeof dateInput === 'string') {
    dateStr = String(dateInput).trim();
    if (dateStr.includes('T')) {
      dateStr = dateStr.split('T')[0];
    }
    if (dateStr.includes(' ')) {
      dateStr = dateStr.split(' ')[0];
    }
  } else {
    return null;
  }
  
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    Logger.log('⚠️ Invalid date format: ' + dateStr);
    return null;
  }
  
  return dateStr;
}

// ============================================================================
// Password Hashing
// ============================================================================

function hashPassword(password, salt) {
  if (!password) return '';

  if (!salt) {
    salt = Utilities.getUuid();
  }

  const combined = password + salt;
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    combined,
    Utilities.Charset.UTF_8
  );

  const hash = digest.map(byte => {
    const unsignedByte = byte < 0 ? 256 + byte : byte;
    return unsignedByte.toString(16).padStart(2, '0');
  }).join('');

  return hash + ':' + salt;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) {
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

function getAttendanceSheetName(yearMonth) {
  if (!yearMonth) {
    const now = new Date();
    yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  const parts = yearMonth.split('-');
  return `Attendance_${parts[0]}_${parts[1]}`;
}

function getOrCreateAttendanceSheet(yearMonth) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = getAttendanceSheetName(yearMonth);

  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    Logger.log('📋 Creating new attendance sheet: ' + sheetName);
    sheet = ss.insertSheet(sheetName);

    sheet.appendRow([
      'UserID', 'Date', 'Status', 'WorkHours', 'OTHours', 'TotalHours',
      'Earned', 'Deduction', 'Details', 'Created'
    ]);

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

function getMonthFromDate(dateStr) {
  const parts = dateStr.split('-');
  return `${parts[0]}-${parts[1]}`;
}

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

  months.sort((a, b) => b.localeCompare(a));

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

function doGet(e) {
  const path = e.parameter.path || '';
  const auth = e.parameter.authorization || '';

  Logger.log('=== doGet Request ===');
  Logger.log('Path: ' + path);

  try {
    if (path === 'health') {
      return jsonResponse({ ok: true, message: 'Server is running' });
    }

    if (!auth) {
      return jsonResponse({ ok: false, error: 'অননুমোদিত অ্যাক্সেস - টোকেন প্রয়োজন' }, 401);
    }

    const user = validateToken(auth);
    if (!user) {
      return jsonResponse({ ok: false, error: 'অননুমোদিত অ্যাক্সেস - অবৈধ টোকেন' }, 401);
    }

    Logger.log('✅ Token valid for user: ' + user.id);

    if (path === 'profile') {
      return handleGetProfile(user);
    } else if (path.startsWith('attendance/stats')) {
      return handleGetStats(user, e.parameter.month);
    } else if (path.startsWith('attendance/history')) {
      return handleGetHistory(user, e.parameter.month);
    } else if (path === 'attendance/months') {
      return handleGetAvailableMonths(user);
    }

    return jsonResponse({ ok: false, error: 'এন্ডপয়েন্ট খুঁজে পাওয়া যায়নি' }, 404);

  } catch (error) {
    Logger.log('❌ Error in doGet: ' + error.toString());
    
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

  try {
    if (path === 'register') {
      return handleRegister(e.parameter);
    }

    if (path === 'login') {
      return handleLogin(e.parameter);
    }

    if (!auth) {
      return jsonResponse({ ok: false, error: 'অননুমোদিত অ্যাক্সেস - টোকেন প্রয়োজন' }, 401);
    }

    const user = validateToken(auth);
    if (!user) {
      return jsonResponse({ ok: false, error: 'অননুমোদিত অ্যাক্সেস - অবৈধ টোকেন' }, 401);
    }

    Logger.log('✅ Token valid for user: ' + user.id);

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

    return jsonResponse({ ok: false, error: 'এন্ডপয়েন্ট খুঁজে পাওয়া যায়নি' }, 404);

  } catch (error) {
    Logger.log('❌ Error in doPost: ' + error.toString());

    const userMessage = error.message.includes('সমস্ত') ||
                       error.message.includes('অবৈধ') ||
                       error.message.includes('ইনপুট')
        ? error.message
        : 'সার্ভার ত্রুটি। পরে আবার চেষ্টা করুন।';

    return jsonResponse({ ok: false, error: userMessage }, 500);
  }
}

function doOptions(e) {
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

    if (!id || !name || !password) {
      return jsonResponse({ ok: false, error: 'সমস্ত ফিল্ড পূরণ করুন' });
    }
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }

  if (password.length < 6) {
    return jsonResponse({ ok: false, error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let usersSheet = ss.getSheetByName(SHEETS.USERS);

  if (!usersSheet) {
    usersSheet = ss.insertSheet(SHEETS.USERS);
    usersSheet.appendRow(['ID', 'Name', 'Password', 'Created', 'LastLogin']);
  }

  const data = usersSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(id).trim()) {
      return jsonResponse({ ok: false, error: 'এই আইডি ইতিমধ্যে নিবন্ধিত আছে' });
    }
  }

  const hashedPassword = hashPassword(password);
  usersSheet.appendRow([id, name, hashedPassword, new Date(), '']);
  Logger.log('✅ User created');

  const token = createToken(id);
  return jsonResponse({ ok: true, token: token });
}

function handleLogin(params) {
  const { id, password } = params;

  if (!id || !password) {
    return jsonResponse({ ok: false, error: 'সমস্ত ফিল্ড পূরণ করুন' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usersSheet = ss.getSheetByName(SHEETS.USERS);

  if (!usersSheet) {
    return jsonResponse({ ok: false, error: 'কোন ব্যবহারকারী পাওয়া যায়নি' });
  }

  const data = usersSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const storedId = String(data[i][0]).trim();
    const storedHash = String(data[i][2]).trim();

    if (storedId === String(id).trim()) {
      if (verifyPassword(password, storedHash)) {
        usersSheet.getRange(i + 1, 5).setValue(new Date());
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
          // ✅ FIXED: Return separate fields
          medical: Number(data[i][9]) || 750,
          transport: Number(data[i][10]) || 450,
          food: Number(data[i][11]) || 1250,
          // ✅ ALSO provide combined value for backward compatibility
          medicalTransport: (Number(data[i][9]) || 750) + (Number(data[i][10]) || 450) + (Number(data[i][11]) || 1250),
          otRate: Number(data[i][12]) || 0,
          presentBonus: Number(data[i][13]) || 0,
          nightAllowance: Number(data[i][14]) || 0,
          tiffinBill: Number(data[i][15]) || 0,
          profileImage: data[i][16] || '',
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let profilesSheet = ss.getSheetByName(SHEETS.PROFILES);

  if (!profilesSheet) {
    profilesSheet = ss.insertSheet(SHEETS.PROFILES);
    profilesSheet.appendRow([
        'ID', 'Name', 'Company', 'CardNo', 'Section', 'Designation', 'Grade',
        'BasicSalary', 'HouseRent', 'Medical', 'Transport', 'Food', 'OTRate',
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
        Number(params.medical) || 750,
        Number(params.transport) || 450,
        Number(params.food) || 1250,
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

  // ✅ Calculate daily salary from gross components
  const dailySalary = (profile.basicSalary + profile.houseRent + profile.medical + profile.transport + profile.food) / 30;

  let earned = 0;

  if (isFri) {
    // ✅ Friday: ONLY OT earnings (no base salary on Friday)
    earned = (ot * profile.otRate);
  } else {
    // ✅ Regular day: Daily Salary + OT (NO BONUS ADDED HERE)
    earned = dailySalary + (ot * profile.otRate);
  }

  // ✅ Add tiffin allowance if OT >= 5 hours
  if (ot >= 5) {
    earned += profile.tiffinBill;
  }

  // ✅ Add night allowance if OT >= 7 hours
  if (ot >= 7) {
    earned += profile.nightAllowance;
  }

  // ✅ IMPORTANT: Present bonus is NOT added here
  // It's calculated monthly in handleGetStats() based on zero absents

  Logger.log('💰 Daily Calculation Breakdown:');
  Logger.log('  - Daily Salary: ৳' + dailySalary.toFixed(2));
  Logger.log('  - OT Amount: ৳' + (ot * profile.otRate).toFixed(2));
  Logger.log('  - Tiffin: ৳' + (ot >= 5 ? profile.tiffinBill : 0));
  Logger.log('  - Night: ৳' + (ot >= 7 ? profile.nightAllowance : 0));
  Logger.log('  - TOTAL EARNED: ৳' + earned.toFixed(2));
  Logger.log('  - Present Bonus: NOT added (monthly calculation only)');

  saveAttendanceRecord({
    userId: user.id,
    date: date,
    status: 'present',
    workHours: work,
    otHours: ot,
    totalHours: work + ot,
    earned: earned, // ✅ Correct daily amount without bonus
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

  if (!date) {
    return jsonResponse({ ok: false, error: 'তারিখ প্রয়োজন' });
  }

  try {
    const cleanDate = normalizeDateToString(date);
    
    if (!cleanDate) {
      return jsonResponse({ ok: false, error: 'অবৈধ তারিখ ফরম্যাট' });
    }

    const month = getMonthFromDate(cleanDate);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = getAttendanceSheetName(month);
    const attendanceSheet = ss.getSheetByName(sheetName);

    if (!attendanceSheet) {
      return jsonResponse({ ok: false, error: 'এই মাসের কোন রেকর্ড নেই' });
    }

    const data = attendanceSheet.getDataRange().getValues();
    const rowsToDelete = [];
    const cleanUserId = String(user.id).trim().toLowerCase();

    for (let i = 1; i < data.length; i++) {
      const rowUserId = String(data[i][0]).trim().toLowerCase();
      const rowDateStr = normalizeDateToString(data[i][1]);

      if (rowUserId === cleanUserId && rowDateStr === cleanDate) {
        rowsToDelete.push(i + 1);
      }
    }

    if (rowsToDelete.length === 0) {
      return jsonResponse({ ok: false, error: 'রেকর্ড খুঁজে পাওয়া যায়নি' });
    }

    rowsToDelete.sort((a, b) => b - a);
    
    rowsToDelete.forEach(rowNum => {
      attendanceSheet.deleteRow(rowNum);
    });

    const message = rowsToDelete.length > 1 
      ? 'রেকর্ড মুছে ফেলা হয়েছে (' + rowsToDelete.length + 'টি)'
      : 'রেকর্ড মুছে ফেলা হয়েছে';

    return jsonResponse({ ok: true, message: message });

  } catch (error) {
    Logger.log('❌ Delete error: ' + error.toString());
    return jsonResponse({ 
      ok: false, 
      error: 'রেকর্ড মুছতে সমস্যা হয়েছে: ' + error.message 
    });
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

  // Calculate present bonus: Full amount if no absents, 0 if any absent
  const presentBonus = (absentDays === 0 && profile) ? profile.presentBonus : 0;

  return jsonResponse({
    ok: true,
    stats: {
      presentDays: presentDays,
      absentDays: absentDays,
      totalOTHours: totalOTHours,
      totalOTAmount: totalOTAmount,
      totalDeduction: totalDeduction,
      presentBonus: presentBonus  // NEW: Monthly bonus
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

  const inputDateStr = normalizeDateToString(record.date);
  
  if (!inputDateStr) {
    throw new Error('অবৈধ তারিখ ফরম্যাট');
  }
  
  const inputUserId = String(record.userId).trim().toLowerCase();
  const data = attendanceSheet.getDataRange().getValues();
  
  // Check for existing record
  for (let i = 1; i < data.length; i++) {
    const rowUserId = String(data[i][0]).trim().toLowerCase();
    const rowDateStr = normalizeDateToString(data[i][1]);
    
    if (rowUserId === inputUserId && rowDateStr === inputDateStr) {
      Logger.log('🔄 Updating existing record at row ' + (i + 1));
      
      attendanceSheet.getRange(i + 1, 2, 1, 9).setValues([[
        inputDateStr,
        record.status,
        record.workHours,
        record.otHours,
        record.totalHours,
        record.earned,
        record.deduction,
        record.details,
        new Date()
      ]]);
      
      return { action: 'updated', row: i + 1 };
    }
  }

  // Create new record
  attendanceSheet.appendRow([
    record.userId,
    inputDateStr,
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
  return { action: 'created', row: data.length };
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
  const cleanUserId = String(userId).trim().toLowerCase();

  for (let i = 1; i < data.length; i++) {
    const rowUserId = String(data[i][0]).trim().toLowerCase();
    
    if (rowUserId === cleanUserId) {
      let dateValue = data[i][1];
      
      // ✅ Use Asia/Dhaka timezone
      if (dateValue instanceof Date) {
        dateValue = Utilities.formatDate(dateValue, 'Asia/Dhaka', 'yyyy-MM-dd');
      } else if (typeof dateValue === 'string') {
        dateValue = String(dateValue).trim().split('T')[0].split(' ')[0];
      }
      
      if (dateValue) {
        records.push({
          date: dateValue,
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
  }

  records.sort((a, b) => b.date.localeCompare(a.date));
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
        medical: Number(data[i][9]) || 750,
        transport: Number(data[i][10]) || 450,
        food: Number(data[i][11]) || 1250,
        otRate: Number(data[i][12]) || 0,
        presentBonus: Number(data[i][13]) || 0,
        nightAllowance: Number(data[i][14]) || 0,
        tiffinBill: Number(data[i][15]) || 0
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
  const randomPart = Utilities.getUuid();
  const tokenData = userId + ':' + timestamp + ':' + randomPart;
  const token = Utilities.base64Encode(tokenData);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sessionsSheet = ss.getSheetByName(SHEETS.SESSIONS);

  if (!sessionsSheet) {
    sessionsSheet = ss.insertSheet(SHEETS.SESSIONS);
    sessionsSheet.appendRow(['Token', 'UserID', 'Created', 'Expires', 'LastUsed']);
  }

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
  return output;
}

// ============================================================================
// UTILITY FUNCTIONS - Run these manually when needed
// ============================================================================

/**
 * ✅ CLEANUP #1: Remove duplicate records
 * Run this ONCE to clean up existing duplicates
 */
function cleanupDuplicateRecords() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  
  let totalDuplicatesRemoved = 0;
  
  Logger.log('🧹 Starting cleanup of duplicate records...');
  
  sheets.forEach(sheet => {
    const sheetName = sheet.getName();
    
    if (!sheetName.startsWith('Attendance_')) {
      return;
    }
    
    Logger.log('🔍 Checking sheet: ' + sheetName);
    
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      Logger.log('  ℹ️ Sheet is empty or has only headers, skipping');
      return;
    }
    
    const seenRecords = new Map();
    const rowsToDelete = [];
    
    for (let i = 1; i < data.length; i++) {
      const userId = String(data[i][0]).trim().toLowerCase();
      const dateStr = normalizeDateToString(data[i][1]);
      
      if (!dateStr) continue;
      
      const key = userId + '|' + dateStr;
      
      if (seenRecords.has(key)) {
        Logger.log('  ⚠️ Duplicate: UserID=' + userId + ', Date=' + dateStr + ' at row ' + (i + 1));
        rowsToDelete.push(i + 1);
      } else {
        seenRecords.set(key, i + 1);
      }
    }
    
    if (rowsToDelete.length > 0) {
      Logger.log('  🗑️ Deleting ' + rowsToDelete.length + ' duplicate(s) from ' + sheetName);
      
      rowsToDelete.sort((a, b) => b - a);
      
      rowsToDelete.forEach(rowNum => {
        sheet.deleteRow(rowNum);
        totalDuplicatesRemoved++;
      });
      
      Logger.log('  ✅ Cleaned up ' + sheetName);
    } else {
      Logger.log('  ✅ No duplicates found in ' + sheetName);
    }
  });
  
  Logger.log('');
  Logger.log('════════════════════════════════════════');
  Logger.log('🎉 Cleanup Complete!');
  Logger.log('📊 Total duplicates removed: ' + totalDuplicatesRemoved);
  Logger.log('════════════════════════════════════════');
  
  if (totalDuplicatesRemoved > 0) {
    SpreadsheetApp.getUi().alert(
      '✅ Cleanup Successful!\n\n' +
      'Removed ' + totalDuplicatesRemoved + ' duplicate record(s).\n\n' +
      'Check the Execution log for details.'
    );
  } else {
    SpreadsheetApp.getUi().alert(
      '✅ No Duplicates Found!\n\n' +
      'Your attendance records are clean.'
    );
  }
  
  return {
    success: true,
    duplicatesRemoved: totalDuplicatesRemoved
  };
}

/**
 * ✅ CLEANUP #2: Fix timezone for all existing dates
 * Run this ONCE to normalize all dates to Asia/Dhaka timezone
 */
function fixTimezoneForAllDates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  
  let totalFixed = 0;
  
  Logger.log('🌍 Starting timezone fix for all attendance sheets...');
  
  sheets.forEach(sheet => {
    const sheetName = sheet.getName();
    
    if (!sheetName.startsWith('Attendance_')) {
      return;
    }
    
    Logger.log('🔍 Processing: ' + sheetName);
    
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const currentDate = data[i][1];
      
      if (currentDate instanceof Date) {
        const fixedDate = Utilities.formatDate(currentDate, 'Asia/Dhaka', 'yyyy-MM-dd');
        
        if (String(currentDate) !== fixedDate) {
          sheet.getRange(i + 1, 2).setValue(fixedDate);
          totalFixed++;
          Logger.log('  ✅ Fixed row ' + (i + 1) + ': ' + currentDate + ' -> ' + fixedDate);
        }
      } else if (typeof currentDate === 'string') {
        let cleanDate = String(currentDate).trim();
        if (cleanDate.includes('T')) {
          cleanDate = cleanDate.split('T')[0];
        }
        if (cleanDate.includes(' ')) {
          cleanDate = cleanDate.split(' ')[0];
        }
        
        if (cleanDate !== String(currentDate)) {
          sheet.getRange(i + 1, 2).setValue(cleanDate);
          totalFixed++;
          Logger.log('  ✅ Fixed row ' + (i + 1) + ': ' + currentDate + ' -> ' + cleanDate);
        }
      }
    }
  });
  
  Logger.log('');
  Logger.log('════════════════════════════════════════');
  Logger.log('✅ Timezone Fix Complete!');
  Logger.log('📊 Total dates fixed: ' + totalFixed);
  Logger.log('════════════════════════════════════════');
  
  SpreadsheetApp.getUi().alert(
    '✅ Timezone Fix Complete!\n\n' +
    'Fixed ' + totalFixed + ' date(s).\n\n' +
    'All dates now use Asia/Dhaka timezone.'
  );
  
  return {
    success: true,
    datesFixed: totalFixed
  };
}

/**
 * ✅ DIAGNOSTIC: Debug delete issues
 * Replace TEST_USER_ID and TEST_DATE with your actual values
 */
function diagnoseDeleteIssue() {
  const TEST_USER_ID = '627062';  // ⚠️ CHANGE THIS to your user ID
  const TEST_DATE = '2025-11-23';  // ⚠️ CHANGE THIS to the date you're testing
  
  Logger.log('🔍 Diagnosing delete issue for UserID: ' + TEST_USER_ID + ', Date: ' + TEST_DATE);
  
  const month = getMonthFromDate(TEST_DATE);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = getAttendanceSheetName(month);
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    Logger.log('❌ Sheet not found: ' + sheetName);
    return;
  }
  
  const data = sheet.getDataRange().getValues();
  Logger.log('📊 Total rows: ' + (data.length - 1));
  
  const cleanUserId = String(TEST_USER_ID).trim().toLowerCase();
  const cleanDate = normalizeDateToString(TEST_DATE);
  
  Logger.log('🔍 Looking for: UserID=' + cleanUserId + ', Date=' + cleanDate);
  Logger.log('');
  
  for (let i = 1; i < data.length; i++) {
    const rowUserId = String(data[i][0]).trim().toLowerCase();
    const rowDate = normalizeDateToString(data[i][1]);
    
    Logger.log('Row ' + (i + 1) + ':');
    Logger.log('  - UserID: ' + rowUserId + ' (match: ' + (rowUserId === cleanUserId) + ')');
    Logger.log('  - Date: ' + rowDate + ' (match: ' + (rowDate === cleanDate) + ')');
    Logger.log('  - Status: ' + data[i][2]);
    Logger.log('');
  }
  
  SpreadsheetApp.getUi().alert(
    'Diagnostic Complete!\n\n' +
    'Check the Execution log (View > Logs) for detailed results.'
  );
}

/**
 * ✅ TEST: Verify date normalization works correctly
 */
function testDateNormalization() {
  Logger.log('=== Testing Date Normalization ===');
  
  const testCases = [
    '2025-11-23',
    '2025-11-23T10:30:00',
    '2025-11-23 10:30:00',
    new Date(2025, 10, 23), // November 23, 2025
  ];
  
  testCases.forEach(testDate => {
    const normalized = normalizeDateToString(testDate);
    Logger.log('Input: ' + testDate + ' -> Output: ' + normalized);
  });
  
  Logger.log('=== Test Complete ===');
  
  SpreadsheetApp.getUi().alert(
    'Test Complete!\n\n' +
    'Check the Execution log (View > Logs) for results.'
  );
}

/**
 * ✅ VIEW ALL RECORDS: See all attendance records for debugging
 */
function viewAllAttendanceRecords() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  
  Logger.log('=== ALL ATTENDANCE RECORDS ===');
  
  sheets.forEach(sheet => {
    const sheetName = sheet.getName();
    
    if (!sheetName.startsWith('Attendance_')) {
      return;
    }
    
    Logger.log('');
    Logger.log('📋 Sheet: ' + sheetName);
    Logger.log('─'.repeat(50));
    
    const data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      Logger.log('  (empty)');
      return;
    }
    
    for (let i = 1; i < data.length; i++) {
      const userId = data[i][0];
      const rawDate = data[i][1];
      const normalizedDate = normalizeDateToString(rawDate);
      const status = data[i][2];
      
      Logger.log('Row ' + (i + 1) + ': UserID=' + userId + ', Date=' + normalizedDate + ' (' + typeof rawDate + '), Status=' + status);
    }
  });
  
  Logger.log('');
  Logger.log('=== END OF RECORDS ===');
  
  SpreadsheetApp.getUi().alert(
    'Records Listed!\n\n' +
    'Check the Execution log (View > Logs) to see all records.'
  );
}

function debugNov24Calculation() {
  const userId = '627062'; // Your user ID
  const profile = getProfile(userId);
  
  Logger.log('=== YOUR PROFILE ===');
  Logger.log('Basic Salary: ৳' + profile.basicSalary);
  Logger.log('House Rent: ৳' + profile.houseRent);
  Logger.log('Medical: ৳' + profile.medical);
  Logger.log('Transport: ৳' + profile.transport);
  Logger.log('Food: ৳' + profile.food);
  Logger.log('OT Rate: ৳' + profile.otRate);
  Logger.log('Present Bonus (MONTHLY): ৳' + profile.presentBonus);
  
  const totalGross = profile.basicSalary + profile.houseRent + profile.medical + profile.transport + profile.food;
  Logger.log('');
  Logger.log('Total Gross: ৳' + totalGross);
  
  const dailySalary = totalGross / 30;
  Logger.log('');
  Logger.log('=== NOV 24 CALCULATION (8 work + 3 OT) ===');
  Logger.log('Daily Salary: ৳' + dailySalary.toFixed(2));
  Logger.log('OT Amount (3 hours): ৳' + (3 * profile.otRate).toFixed(2));
  Logger.log('');
  Logger.log('TOTAL: ৳' + (dailySalary + (3 * profile.otRate)).toFixed(2));
  Logger.log('');
  Logger.log('Expected: ৳1,591.93');
  Logger.log('Actual: ৳' + (dailySalary + (3 * profile.otRate)).toFixed(2));
  
  // Now check what's actually stored in the sheet
  Logger.log('');
  Logger.log('=== CHECKING SHEET DATA ===');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Attendance_2025_11');
  
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowUserId = String(data[i][0]).trim();
      const rowDate = normalizeDateToString(data[i][1]);
      
      if (rowUserId === userId && rowDate === '2025-11-24') {
        Logger.log('Found Nov 24 record:');
        Logger.log('  - UserID: ' + data[i][0]);
        Logger.log('  - Date: ' + data[i][1]);
        Logger.log('  - Status: ' + data[i][2]);
        Logger.log('  - Work Hours: ' + data[i][3]);
        Logger.log('  - OT Hours: ' + data[i][4]);
        Logger.log('  - Total Hours: ' + data[i][5]);
        Logger.log('  - Earned: ৳' + data[i][6]); // 👈 THIS IS WHAT'S STORED
        Logger.log('  - Deduction: ৳' + data[i][7]);
        Logger.log('  - Details: ' + data[i][8]);
      }
    }
  } else {
    Logger.log('Sheet not found!');
  }
}
