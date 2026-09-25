require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'].filter(Boolean);

// Middleware
app.use(helmet());
app.use(morgan('combined'));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));
app.use(express.json());

const isMongoConfigured = () => {
  return typeof process.env.MONGODB_URI === 'string' && process.env.MONGODB_URI.trim() !== '' && !process.env.MONGODB_URI.includes('<');
};

const ensureDatabase = (res) => {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      success: false,
      error: 'Database is not configured or unavailable. Add a valid MONGODB_URI to enable user data operations.',
    });
    return false;
  }

  return true;
};

// MongoDB Atlas Connection
const connectDB = async () => {
  if (!isMongoConfigured()) {
    console.warn('Warning: MONGODB_URI is not configured. Starting the API without a database connection.');
    return;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Success: MongoDB Atlas Connected Successfully');
  } catch (error) {
    console.error('Error: MongoDB Connection Error:', error.message);
  }
};

// User Model
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  role: { type: String, default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Reject malformed ids with 400 instead of a 500 cast error
app.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ success: false, error: 'Invalid user id' });
  }
  next();
});

// Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Backend API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.get('/api/users', async (req, res) => {
  if (!ensureDatabase(res)) return;

  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({ success: true, data: users, count: users.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/users', async (req, res) => {
  if (!ensureDatabase(res)) return;

  try {
    const { name, email, role } = req.body;
    const user = new User({ name, email, role });
    await user.save();
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, error: 'A user with this email already exists' });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/users/:id', async (req, res) => {
  if (!ensureDatabase(res)) return;

  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  if (!ensureDatabase(res)) return;

  try {
    const { name, email, role } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, role },
      { new: true, runValidators: true }
    );

    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: user });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, error: 'A user with this email already exists' });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  if (!ensureDatabase(res)) return;

  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Central error handler (must have 4 arguments)
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, error: 'Origin not allowed by CORS' });
  }

  console.error(err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start Server
const PORT = process.env.PORT || 5000;

connectDB();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown so PM2 reloads don't drop requests
const shutdown = (signal) => {
  console.log(`${signal} received. Shutting down...`);
  server.close(async () => {
    try {
      await mongoose.connection.close();
    } finally {
      process.exit(0);
    }
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));