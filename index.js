const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ফায়ারবেস অ্যাডমিন SDK ইনিশিয়ালাইজেশন (অটো-ফরম্যাট করা ইঞ্জিনিয়ারিং কোড)
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID || "pushserver-ff2b4",
    privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    clientEmail: "firebase-adminsdk-8g4s1@pushserver-ff2b4.iam.gserviceaccount.com"
  })
});

console.log("SmartBite Push Server & Firebase Initialized Successfully!");

// ডিভাইস টোকেন সেভ করার জন্য স্টোরেজ
let registeredTokens = new Set();

// টোকেন রেজিস্টার এন্ডপয়েন্ট
app.post('/register-token', (req, res) => {
  const { token } = req.body;
  if (token) {
    registeredTokens.add(token);
    console.log('Token Registered:', token);
    return res.status(200).json({ success: true, message: 'Token registered successfully.' });
  }
  return res.status(400).json({ success: false, message: 'Token is missing.' });
});

// নির্দিষ্ট বা সকল ডিভাইসে নোটিফিকেশন পাঠানোর এন্ডপয়েন্ট
app.post('/send-notification', async (req, res) => {
  const { title, body, token } = req.body;

  if (!title || !body) {
    return res.status(400).json({ success: false, message: 'Title and body are required.' });
  }

  try {
    let response;
    if (token) {
      const message = {
        notification: { title, body },
        token: token
      };
      response = await admin.messaging().send(message);
    } else {
      const tokensArray = Array.from(registeredTokens);
      if (tokensArray.length === 0) {
        return res.status(400).json({ success: false, message: 'No registered devices found.' });
      }
      const message = {
        notification: { title, body },
        tokens: tokensArray
      };
      response = await admin.messaging().sendEachForMulticast(message);
    }

    res.status(200).json({ success: true, response });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`SmartBite Push Server is running on port ${PORT}`);
});

  if (!token)               return res.status(400).json({ success: false, error: 'token required' });
  if (!isValidAppId(appId)) return res.status(400).json({ success: false, error: 'valid appId required' });

  try {
    await devicesRef(appId).doc(tokenDocId(token)).set({
      token,
      appId,
      userAgent:    userAgent || '',
      registeredAt: Date.now(),
      updatedAt:    Date.now()
    }, { merge: true });

    console.log(`[${appId}] Token registered: ${token.substring(0, 20)}...`);
    res.json({ success: true });
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Get tokens by appId (password required) ──
// GET /tokens?appId=com.myapp.xyz&password=xxx
app.get('/tokens', async (req, res) => {
  const { appId } = req.query;
  if (!isValidAppId(appId)) return res.status(400).json({ success: false, error: 'valid appId required' });

  // Password check disabled — সব request password ছাড়াই allow

  try {
    const snap   = await devicesRef(appId).get();
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
