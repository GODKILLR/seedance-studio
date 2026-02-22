require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, 'frontend')));

// Uploads directory
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL;
const uploadsDir = isVercel ? '/tmp' : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

// ─── Multer config ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.gif', '.avif',
      '.mp4', '.mov', '.mkv', '.mp3', '.wav'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// Upload a file, return its public URL
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const baseUrl = process.env.SERVER_BASE_URL || `http://localhost:${PORT}`;
  const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;
  res.json({
    success: true,
    url: fileUrl,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });
});

// Delete an uploaded file
app.delete('/api/upload/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// ─── GIF → MP4 Converter ─────────────────────────────────────────────────────
const gifUpload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ext === '.gif');
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.post('/api/convert', gifUpload.single('gif'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No GIF file uploaded' });

  const inputPath = path.join(uploadsDir, req.file.filename);
  const outputName = req.file.filename.replace(/\.gif$/i, '.mp4');
  const outputPath = path.join(uploadsDir, outputName);

  const args = [
    '-i', inputPath,
    '-movflags', 'faststart',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-an',
    '-y',
    outputPath,
  ];

  console.log('🔄 Converting GIF → MP4:', req.file.originalname);

  execFile(ffmpegPath, args, { timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('FFmpeg error:', stderr || err.message);
      return res.status(500).json({ error: 'Conversion failed: ' + (stderr || err.message) });
    }

    const baseUrl = process.env.SERVER_BASE_URL || `http://localhost:${PORT}`;
    const stats = fs.statSync(outputPath);

    console.log('✅ Converted:', outputName, `(${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    res.json({
      success: true,
      url: `${baseUrl}/uploads/${outputName}`,
      localUrl: `/uploads/${outputName}`,
      filename: outputName,
      originalName: req.file.originalname.replace(/\.gif$/i, '.mp4'),
      size: stats.size,
      mimetype: 'video/mp4',
    });
  });
});

// ─── API Key Helper ───────────────────────────────────────────────────────────
function getApiKey(req) {
  const envKey = process.env.XSKILL_API_KEY;
  if (envKey && envKey !== 'sk-your-key-here') return envKey;
  return req.headers['x-api-key'] || null;
}

// Create a generation task (proxy to Xskill AI)
app.post('/api/generate', async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) {
    return res.status(400).json({ error: 'API key not configured. Set it in Settings or in your .env file.' });
  }

  try {
    const { default: fetch } = await import('node-fetch');
    const response = await fetch('https://api.xskill.ai/api/v3/tasks/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    console.log('\n📤 GENERATE REQUEST:', JSON.stringify(req.body, null, 2));
    console.log('📥 GENERATE RESPONSE:', JSON.stringify(data, null, 2));
    res.json(data);
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Query task status (proxy to Xskill AI)
app.post('/api/status', async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) {
    return res.status(400).json({ error: 'API key not configured.' });
  }

  try {
    const { default: fetch } = await import('node-fetch');
    const response = await fetch('https://api.xskill.ai/api/v3/tasks/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ task_id: req.body.task_id }),
    });
    const data = await response.json();
    console.log('🔍 STATUS [' + req.body.task_id + ']:', JSON.stringify(data, null, 2));
    res.json(data);
  } catch (err) {
    console.error('Status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Catch-all: serve frontend index.html
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n🎬 Seedance Studio running at http://localhost:${PORT}`);
    console.log(`   API Key: ${process.env.XSKILL_API_KEY ? '✅ Configured' : '❌ Missing — set XSKILL_API_KEY in .env'}`);
    console.log(`   FFmpeg:  ✅ ${ffmpegPath}\n`);
  });
}

module.exports = app;
