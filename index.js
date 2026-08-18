import express from 'express';
import admin from 'firebase-admin';
import bodyParser from 'body-parser';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ফায়ারবেস অ্যাডমিন SDK ইনিশিয়ালাইজেশন
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID || "pushserver-ff2b4",
    privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    clientEmail: "firebase-adminsdk-8g4s1@pushserver-ff2b4.iam.gserviceaccount.com"
  })
});

const db = admin.firestore();

console.log("SmartBite Push Server & Firebase Initialized Successfully!");

// হেল্পার ফাংশনসমূহ
function isValidAppId(appId) {
  return appId && typeof appId === 'string' && appId.trim().length > 0;
}

function devicesRef(appId) {
  return db.collection('apps').doc(appId).collection('devices');
}

function tokenDocId(token) {
  return Buffer.from(token).toString('base64').replace(/[/+=]/g, '_');
}

// ── টোকেন রেজিস্টার এন্ডপয়েন্ট ──
app.post('/register-token', async (req, res) => {
  const { token, appId, userAgent } = req.body;
  
  if (!token) return res.status(400).json({ success: false, error: 'token required' });
  const targetAppId = isValidAppId(appId) ? appId : 'com.push.test';

  try {
    await devicesRef(targetAppId).doc(tokenDocId(token)).set({
      token,
      appId: targetAppId,
      userAgent: userAgent || '',
      registeredAt: Date.now(),
      updatedAt: Date.now()
    }, { merge: true });

    console.log(`[${targetAppId}] Token registered successfully`);
    res.json({ success: true, message: 'Token registered successfully.' });
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── টোকেন লিস্ট দেখার এন্ডপয়েন্ট ──
app.get('/tokens', async (req, res) => {
  const { appId } = req.query;
  const targetAppId = isValidAppId(appId) ? appId : 'com.push.test';

  try {
    const snap = await devicesRef(targetAppId).get();
    const tokens = snap.docs.map(d => ({
      token: d.data().token,
      registeredAt: d.data().registeredAt,
      userAgent: d.data().userAgent || ''
    }));
    res.json({ success: true, appId: targetAppId, count: tokens.length, tokens });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── নির্দিষ্ট টোকেনে নোটিফিকেশন পাঠানোর এন্ডপয়েন্ট ──
app.post('/send-notification', async (req, res) => {
  const { token, title, body, imageUrl } = req.body;
  if (!token) return res.status(400).json({ success: false, error: 'token required' });

  try {
    const t = title || 'Notification';
    const b = body || '';

    const message = {
      token,
      data: { title: t, body: b, ...(imageUrl ? { imageUrl } : {}) },
      android: { priority: 'high' }
    };

    const msgId = await admin.messaging().send(message);
    res.json({ success: true, messageId: msgId });
  } catch (e) {
    console.error('Send error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── সকল টোকেনে ব্রডকাস্ট করার এন্ডপয়েন্ট ──
app.post('/send-all', async (req, res) => {
  const { appId, title, body, imageUrl } = req.body;
  const targetAppId = isValidAppId(appId) ? appId : 'com.push.test';

  try {
    const snap = await devicesRef(targetAppId).get();
    if (snap.empty) {
      return res.json({ success: false, error: 'No tokens found for this app' });
    }

    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    const t = title || 'Notification';
    const b = body || '';
    
    const messages = tokens.map(token => ({
      token,
      data: { title: t, body: b, ...(imageUrl ? { imageUrl } : {}) },
      android: { priority: 'high' }
    }));

    const result = await admin.messaging().sendEach(messages);
    console.log(`[${targetAppId}] Sent: ${result.successCount} ok, ${result.failureCount} failed`);

    const batch = db.batch();
    let removed = 0;
    result.responses.forEach((r, i) => {
      if (!r.success) { 
        batch.delete(snap.docs[i].ref); 
        removed++; 
      }
    });
    if (removed > 0) await batch.commit();

    res.json({
      success: true,
      appId: targetAppId,
      total: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount
    });
  } catch (e) {
    console.error('Send-all error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── টোকেন ডিলিট করার এন্ডপয়েন্ট ──
app.delete('/token', async (req, res) => {
  const { appId, token } = req.query;
  const targetAppId = isValidAppId(appId) ? appId : 'com.push.test';
  
  if (!token) return res.status(400).json({ success: false, error: 'token required' });

  try {
    await devicesRef(targetAppId).doc(tokenDocId(token)).delete();
    res.json({ success: true });
  } catch (e) {
    console.error('Delete error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// সার্ভার পোর্ট সেটআপ
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`SmartBite Push Server is running on port ${PORT}`);
});

  try {
    const snap = await devicesRef(targetAppId).get();
    if (snap.empty) return res.json({ success: false, error: 'No tokens found for this app' });

    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    const t = title || 'Notification';
    const b = body || '';
    
    const messages = tokens.map(token => ({
      token,
      data: { title: t, body: b, ...(imageUrl ? { imageUrl } : {}) },
      android: { priority: 'high' }
    }));

    const result = await admin.messaging().sendEach(messages);
    console.log(`[${targetAppId}] Sent: ${result.successCount} ok, ${result.failureCount} failed`);

    // ইনভ্যালিড টোকেনগুলো ডিলিট করা
    const batch = db.batch();
    let removed = 0;
    result.responses.forEach((r, i) => {
      if (!r.success) { 
        batch.delete(snap.docs[i].ref); 
        removed++; 
      }
    });
    if (removed > 0) await batch.commit();

    res.json({
      success: true,
      appId: targetAppId,
      total: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount
    });
  } catch (e) {
    console.error('Send-all error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── টোকেন ডিলিট করার এন্ডপয়েন্ট ──
app.delete('/token', async (req, res) => {
  const { appId, token } = req.query;
  const targetAppId = isValidAppId(appId) ? appId : 'com.push.test';
  
  if (!token) return res.status(400).json({ success: false, error: 'token required' });

  try {
    await devicesRef(targetAppId).doc(tokenDocId(token)).delete();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// সার্ভার পোর্ট সেটআপ
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`Wevlo Push Server is running on port ${PORT}`);
});

  try {
    const snap = await devicesRef(targetAppId).get();
    if (snap.empty) return res.json({ success: false, error: 'No tokens found for this app' });

    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    const t = title || 'Notification';
    const b = body || '';
    
    const messages = tokens.map(token => ({
      token,
      data: { title: t, body: b, ...(imageUrl ? { imageUrl } : {}) },
      android: { priority: 'high' }
    }));

    const result = await admin.messaging().sendEach(messages);
    console.log(`[${targetAppId}] Sent: ${result.successCount} ok, ${result.failureCount} failed`);

    // ইনভ্যালিড টোকেনগুলো ডিলিট করা
    const batch = db.batch();
    let removed = 0;
    result.responses.forEach((r, i) => {
      if (!r.success) { 
        batch.delete(snap.docs[i].ref); 
        removed++; 
      }
    });
    if (removed > 0) await batch.commit();

    res.json({
      success: true,
      appId: targetAppId,
      total: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount
    });
  } catch (e) {
    console.error('Send-all error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── টোকেন ডিলিট করার এন্ডপয়েন্ট ──
app.delete('/token', async (req, res) => {
  const { appId, token } = req.query;
  const targetAppId = isValidAppId(appId) ? appId : 'com.push.test';
  
  if (!token) return res.status(400).json({ success: false, error: 'token required' });

  try {
    await devicesRef(targetAppId).doc(tokenDocId(token)).delete();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// সার্ভার পোর্ট সেটআপ
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`Wevlo Push Server is running on port ${PORT}`);
});

  try {
    const snap = await devicesRef(targetAppId).get();
    if (snap.empty) return res.json({ success: false, error: 'No tokens found for this app' });

    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    const t = title || 'Notification';
    const b = body || '';
    
    const messages = tokens.map(token => ({
      token,
      data: { title: t, body: b, ...(imageUrl ? { imageUrl } : {}) },
      android: { priority: 'high' }
    }));

    const result = await admin.messaging().sendEach(messages);
    console.log(`[${targetAppId}] Sent: ${result.successCount} ok, ${result.failureCount} failed`);

    // ইনভ্যালিড টোকেনগুলো ডিলিট করা
    const batch = db.batch();
    let removed = 0;
    result.responses.forEach((r, i) => {
      if (!r.success) { 
        batch.delete(snap.docs[i].ref); 
        removed++; 
      }
    });
    if (removed > 0) await batch.commit();

    res.json({
      success: true,
      appId: targetAppId,
      total: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount
    });
  } catch (e) {
    console.error('Send-all error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── টোকেন ডিলিট করার এন্ডপয়েন্ট ──
app.delete('/token', async (req, res) => {
  const { appId, token } = req.query;
  const targetAppId = isValidAppId(appId) ? appId : 'com.push.test';
  
  if (!token) return res.status(400).json({ success: false, error: 'token required' });

  try {
    await devicesRef(targetAppId).doc(tokenDocId(token)).delete();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// সার্ভার পোর্ট সেটআপ
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`Wevlo Push Server is running on port ${PORT}`);
});

  try {
    const snap = await devicesRef(targetAppId).get();
    if (snap.empty) return res.json({ success: false, error: 'No tokens found for this app' });

    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    const t = title || 'Notification';
    const b = body || '';
    
    const messages = tokens.map(token => ({
      token,
      data: { title: t, body: b, ...(imageUrl ? { imageUrl } : {}) },
      android: { priority: 'high' }
    }));

    const result = await admin.messaging().sendEach(messages);
    console.log(`[${targetAppId}] Sent: ${result.successCount} ok, ${result.failureCount} failed`);

    // ইনভ্যালিড টোকেনগুলো ডিলিট করা
    const batch = db.batch();
    let removed = 0;
    result.responses.forEach((r, i) => {
      if (!r.success) { 
        batch.delete(snap.docs[i].ref); 
        removed++; 
      }
    });
    if (removed > 0) await batch.commit();

    res.json({
      success: true,
      appId: targetAppId,
      total: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount
    });
  } catch (e) {
    console.error('Send-all error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── টোকেন ডিলিট করার এন্ডপয়েন্ট ──
app.delete('/token', async (req, res) => {
  const { appId, token } = req.query;
  const targetAppId = isValidAppId(appId) ? appId : 'com.push.test';
  
  if (!token) return res.status(400).json({ success: false, error: 'token required' });

  try {
    await devicesRef(targetAppId).doc(tokenDocId(token)).delete();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// সার্ভার পোর্ট সেটআপ
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`Wevlo Push Server is running on port ${PORT}`);
});
  const targetAppId = isValidAppId(appId) ? appId : 'com.push.test';

  try {
    const snap = await devicesRef(targetAppId).get();
    if (snap.empty) return res.json({ success: false, error: 'No tokens found for this app' });

    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    const t = title || 'Notification';
    const b = body || '';
    
    const messages = tokens.map(token => ({
      token,
      data: { title: t, body: b, ...(imageUrl ? { imageUrl } : {}) },
      android: { priority: 'high' }
    }));

    const result = await admin.messaging().sendEach(messages);
    console.log(`[${targetAppId}] Sent: ${result.successCount} ok, ${result.failureCount} failed`);

    // ইনভ্যালিড টোকেনগুলো ডিলিট করা
    const batch = db.batch();
    let removed = 0;
    result.responses.forEach((r, i) => {
      if (!r.success) { 
        batch.delete(snap.docs[i].ref); 
        removed++; 
      }
    });
    if (removed > 0) await batch.commit();

    res.json({
      success: true,
      appId: targetAppId,
      total: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount
    });
  } catch (e) {
    console.error('Send-all error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── টোকেন ডিলিট করার এন্ডপয়েন্ট ──
app.delete('/token', async (req, res) => {
  const { appId, token } = req.query;
  const targetAppId = isValidAppId(appId) ? appId : 'com.push.test';
  
  if (!token) return res.status(400).json({ success: false, error: 'token required' });

  try {
    await devicesRef(targetAppId).doc(tokenDocId(token)).delete();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// সার্ভার পোর্ট সেটআপ
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`Wevlo Push Server is running on port ${PORT}`);
});
  const targetAppId = isValidAppId(appId) ? appId : 'com.push.test';

  try {
    const snap = await devicesRef(targetAppId).get();
    if (snap.empty) return res.json({ success: false, error: 'No tokens found for this app' });

    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    const t = title || 'Notification';
    const b = body || '';
    
    const messages = tokens.map(token => ({
      token,
      data: { title: t, body: b, ...(imageUrl ? { imageUrl } : {}) },
      android: { priority: 'high' }
    }));

    const result = await admin.messaging().sendEach(messages);
    console.log(`[${targetAppId}] Sent: ${result.successCount} ok, ${result.failureCount} failed`);

    // ইনভ্যালিড টোকেনগুলো ডিলিট করা
    const batch = db.batch();
    let removed = 0;
    result.responses.forEach((r, i) => {
      if (!r.success) { 
        batch.delete(snap.docs[i].ref); 
        removed++; 
      }
    });
    if (removed > 0) await batch.commit();

    res.json({
      success: true,
      appId: targetAppId,
      total: tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount
    });
  } catch (e) {
    console.error('Send-all error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── টোকেন ডিলিট করার এন্ডপয়েন্ট ──
app.delete('/token', async (req, res) => {
  const { appId, token } = req.query;
  const targetAppId = isValidAppId(appId) ? appId : 'com.push.test';
  
  if (!token) return res.status(400).json({ success: false, error: 'token required' });

  try {
    await devicesRef(targetAppId).doc(tokenDocId(token)).delete();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// সার্ভার পোর্ট সেটআপ
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`SmartBite Push Server is running on port ${PORT}`);
});
    const tokens = snap.docs.map(d => ({
      token:        d.data().token,
      registeredAt: d.data().registeredAt,
      userAgent:    d.data().userAgent || ''
    }));
    res.json({ success: true, appId, count: tokens.length, tokens });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Send to one token (password required) ──
// POST /send-notification  { token, title, body, password, appId }
app.post('/send-notification', async (req, res) => {
  const { token, title, body, imageUrl } = req.body;
  if (!token) return res.status(400).json({ success: false, error: 'token required' });

  // Password check disabled — password ছাড়াই allow

  try {
    const t = title || 'Notification';
    const b = body  || '';

    const message = {
      token,
      data: { title: t, body: b, ...(imageUrl ? { imageUrl } : {}) },
      android: { priority: 'high' }
    };

    const msgId = await admin.messaging().send(message);
    res.json({ success: true, messageId: msgId });
  } catch (e) {
    console.error('Send error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Send to ALL tokens of an appId (password required) ──
// POST /send-all  { appId, title, body, password }
app.post('/send-all', async (req, res) => {
  const { appId, title, body, imageUrl } = req.body;
  if (!isValidAppId(appId)) return res.status(400).json({ success: false, error: 'valid appId required' });

  // Password check disabled — password ছাড়াই allow

  try {
    const snap = await devicesRef(appId).get();
    if (snap.empty) return res.json({ success: false, error: 'No tokens found for this app' });

    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    const t = title || 'Notification';
    const b = body  || '';
    const messages = tokens.map(token => ({
      token,
      data: { title: t, body: b, ...(imageUrl ? { imageUrl } : {}) },
      android: { priority: 'high' }
    }));

    const result = await admin.messaging().sendEach(messages);
    console.log(`[${appId}] Sent: ${result.successCount} ok, ${result.failureCount} failed`);

    // invalid token গুলো Firestore থেকে delete করো
    const batch = db.batch();
    let removed = 0;
    result.responses.forEach((r, i) => {
      if (!r.success) { batch.delete(snap.docs[i].ref); removed++; }
    });
    if (removed > 0) await batch.commit();

    res.json({
      success:      true,
      appId,
      total:        tokens.length,
      successCount: result.successCount,
      failureCount: result.failureCount
    });
  } catch (e) {
    console.error('Send-all error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Delete a token (password required) ──
// DELETE /token?appId=com.myapp&token=xxx&password=yyy
app.delete('/token', async (req, res) => {
  const { appId, token } = req.query;
  if (!isValidAppId(appId) || !token) return res.status(400).json({ success: false, error: 'appId and token required' });

  // Password check disabled — password ছাড়াই allow

  try {
    await devicesRef(appId).doc(tokenDocId(token)).delete();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => console.log(`Wevlo Push Server running on port ${PORT}`));
