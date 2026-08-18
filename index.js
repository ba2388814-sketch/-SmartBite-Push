import express from 'express';
import admin from 'firebase-admin';
import bodyParser from 'body-parser';
import cors from 'cors';

const app = express();

// ================================
// Middleware
// ================================
app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ================================
// Firebase Admin Initialization
// ================================
const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;

const projectId =
  process.env.FIREBASE_PROJECT_ID || 'pushserver-ff2b4';

const clientEmail =
  process.env.FIREBASE_CLIENT_EMAIL ||
  'firebase-adminsdk-8g4s1@pushserver-ff2b4.iam.gserviceaccount.com';

if (!privateKey) {
  console.error('FIREBASE_PRIVATE_KEY is missing.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId,
    privateKey,
    clientEmail
  })
});

const db = admin.firestore();

console.log(
  'SmartBite Push Server & Firebase Initialized Successfully!'
);

// ================================
// Helper Functions
// ================================
function isValidAppId(appId) {
  return (
    typeof appId === 'string' &&
    appId.trim().length > 0
  );
}

function devicesRef(appId) {
  return db
    .collection('apps')
    .doc(appId)
    .collection('devices');
}

function tokenDocId(token) {
  return Buffer.from(token)
    .toString('base64')
    .replace(/[/+=]/g, '_');
}

// ==================================================
// Health Check
// ==================================================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SmartBite Push Server is running',
    firebase: 'connected'
  });
});

// ==================================================
// Register FCM Token
// POST /register-token
// ==================================================
app.post('/register-token', async (req, res) => {
  const {
    token,
    appId,
    userAgent
  } = req.body;

  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'token required'
    });
  }

  const targetAppId = isValidAppId(appId)
    ? appId
    : 'com.push.test';

  try {
    await devicesRef(targetAppId)
      .doc(tokenDocId(token))
      .set(
        {
          token,
          appId: targetAppId,
          userAgent: userAgent || '',
          registeredAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          merge: true
        }
      );

    res.json({
      success: true,
      message: 'Token registered successfully.',
      appId: targetAppId
    });
  } catch (e) {
    console.error(
      'Register token error:',
      e.message
    );

    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

// ==================================================
// Get Tokens
// GET /tokens?appId=com.myapp
// ==================================================
app.get('/tokens', async (req, res) => {
  const { appId } = req.query;

  const targetAppId = isValidAppId(appId)
    ? appId
    : 'com.push.test';

  try {
    const snap = await devicesRef(targetAppId).get();

    const tokens = snap.docs.map(doc => ({
      token: doc.data().token,
      registeredAt: doc.data().registeredAt,
      userAgent: doc.data().userAgent || ''
    }));

    res.json({
      success: true,
      appId: targetAppId,
      count: tokens.length,
      tokens
    });
  } catch (e) {
    console.error(
      'Get tokens error:',
      e.message
    );

    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

// ==================================================
// Send Notification To One Token
// POST /send-notification
// ==================================================
app.post('/send-notification', async (req, res) => {
  const {
    token,
    title,
    body,
    imageUrl
  } = req.body;

  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'token required'
    });
  }

  try {
    const t = title || 'Notification';
    const b = body || '';

    const message = {
      token,

      data: {
        title: t,
        body: b,
        ...(imageUrl
          ? { imageUrl }
          : {})
      },

      android: {
        priority: 'high'
      }
    };

    const msgId =
      await admin.messaging().send(message);

    console.log(
      `Notification sent successfully: ${msgId}`
    );

    res.json({
      success: true,
      messageId: msgId
    });
  } catch (e) {
    console.error(
      'Send notification error:',
      e.message
    );

    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

// ==================================================
// Send Notification To All Tokens
// POST /send-all
// ==================================================
app.post('/send-all', async (req, res) => {
  const {
    appId,
    title,
    body,
    imageUrl
  } = req.body;

  if (!isValidAppId(appId)) {
    return res.status(400).json({
      success: false,
      error: 'valid appId required'
    });
  }

  try {
    const snap =
      await devicesRef(appId).get();

    if (snap.empty) {
      return res.json({
        success: false,
        error: 'No tokens found for this app'
      });
    }

    const docs = snap.docs;

    const tokens = docs
      .map(doc => doc.data().token)
      .filter(Boolean);

    if (tokens.length === 0) {
      return res.json({
        success: false,
        error: 'No valid tokens found'
      });
    }

    const t = title || 'Notification';
    const b = body || '';

    /*
     * Firebase sendEach supports up to 500 messages
     * in one request.
     */
    const chunkSize = 500;

    let totalSuccess = 0;
    let totalFailure = 0;
    let removed = 0;

    for (
      let start = 0;
      start < tokens.length;
      start += chunkSize
    ) {
      const tokenChunk =
        tokens.slice(start, start + chunkSize);

      const docChunk =
        docs.slice(start, start + chunkSize);

      const messages = tokenChunk.map(token => ({
        token,

        data: {
          title: t,
          body: b,
          ...(imageUrl
            ? { imageUrl }
            : {})
        },

        android: {
          priority: 'high'
        }
      }));

      const result =
        await admin.messaging().sendEach(messages);

      totalSuccess += result.successCount;
      totalFailure += result.failureCount;

      console.log(
        `[${appId}] Chunk sent: ` +
        `${result.successCount} success, ` +
        `${result.failureCount} failed`
      );

      /*
       * Failed tokens delete করা হচ্ছে।
       */
      const batch = db.batch();
      let batchDeleteCount = 0;

      result.responses.forEach((response, index) => {
        if (!response.success) {
          batch.delete(docChunk[index].ref);
          batchDeleteCount++;
        }
      });

      if (batchDeleteCount > 0) {
        await batch.commit();
        removed += batchDeleteCount;
      }
    }

    console.log(
      `[${appId}] Total: ${tokens.length}, ` +
      `Success: ${totalSuccess}, ` +
      `Failed: ${totalFailure}, ` +
      `Removed: ${removed}`
    );

    res.json({
      success: true,
      appId,
      total: tokens.length,
      successCount: totalSuccess,
      failureCount: totalFailure,
      removedTokens: removed
    });

  } catch (e) {
    console.error(
      'Send-all error:',
      e.message
    );

    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

// ==================================================
// Delete Token
// DELETE /token?appId=com.myapp&token=xxx
// ==================================================
app.delete('/token', async (req, res) => {
  const {
    appId,
    token
  } = req.query;

  if (!isValidAppId(appId)) {
    return res.status(400).json({
      success: false,
      error: 'valid appId required'
    });
  }

  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'token required'
    });
  }

  try {
    await devicesRef(appId)
      .doc(tokenDocId(token))
      .delete();

    res.json({
      success: true,
      message: 'Token deleted successfully'
    });

  } catch (e) {
    console.error(
      'Delete token error:',
      e.message
    );

    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

// ==================================================
// 404 Handler
// ==================================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// ==================================================
// Start Server
// ==================================================
const PORT =
  process.env.PORT || 7860;

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `SmartBite Push Server running on port ${PORT}`
  );
});
