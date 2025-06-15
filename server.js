const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const path = require('path');

const app = express();

// ======================= CONFIG =======================
const MONGODB_URI = 'mongodb+srv://user1:malafiki@leodb.5mf7q.mongodb.net/?retryWrites=true&w=majority&appName=leodb';
const EMAIL_USER = 'zumalipas@gmail.com';
const EMAIL_PASS = 'xsds bimk ndlb vmrr';
const CLOUDINARY_CLOUD_NAME = 'drxvftof4';
const CLOUDINARY_API_KEY = '872961783425164';
const CLOUDINARY_API_SECRET = 'KWEJ6SbPybty7YefACspZ-j-ym0';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ======================= CLOUDINARY =======================
cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

// ======================= MONGOOSE MODELS =======================
mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true },
  fullname: String,
  email: { type: String, unique: true },
  passwordHash: String,
  role: { type: String, enum: ['surveyor', 'officer', 'manager'], default: 'surveyor' },
  profilePhotoUrl: String
});
const User = mongoose.model('User', userSchema);

const photoSchema = new mongoose.Schema({
  userId: String,
  fullname: String,
  email: String,
  imageId: String,
  photoUrl: String,
  location: {
    street: String, city: String, region: String, country: String,
    latitude: Number, longitude: Number
  },
  roadName: String,
  damageClass: String,
  comment: String,
  localTime: String,
  dateCreated: { type: Date, default: Date.now },

  approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
  officerComment: String,
  contractor: String,
  validatedByOfficerId: String,
  validationDate: Date,

  budget: Number
});
const Photo = mongoose.model('Photo', photoSchema);

const damageClassSchema = new mongoose.Schema({
  damageClass: { type: String, enum: ['A', 'B', 'C'], required: true },
  description: String,
  repairCost: Number,
  userId: String,
  registerDate: { type: Date, default: Date.now }
});
const DamageClass = mongoose.model('DamageClass', damageClassSchema);

// ======================= MULTER =======================
const upload = multer({ storage: multer.memoryStorage() });

// ======================= JWT MIDDLEWARE =======================
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ message: 'No token' });
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ message: 'Invalid token' });
  }
}

// ======================= ROUTES =======================

// ----- AUTH -----
app.post('/register', async (req, res) => {
  try {
    const { fullname, email, password, confirmPassword, role } = req.body;
    if (!fullname || !email || !password || password !== confirmPassword)
      return res.status(400).json({ message: 'Invalid input.' });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'Email already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = 'U' + Date.now();

    const newUser = new User({ userId, fullname, email, passwordHash, role });
    await newUser.save();
    res.json({ message: 'Registered successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ message: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(400).json({ message: 'Invalid credentials' });

  const token = jwt.sign({ userId: user.userId, role: user.role }, JWT_SECRET, { expiresIn: '12h' });

  res.json({
    token,
    userId: user.userId,
    fullname: user.fullname,
    email: user.email,
    role: user.role,
    profilePhotoUrl: user.profilePhotoUrl || ''
  });
});

// ----- PHOTOS -----
app.post('/upload-photo', async (req, res) => {
  const { userId, fullname, email, imageData, location, roadName, damageClass, comment, localTime } = req.body;
  const uploaded = await cloudinary.uploader.upload(imageData, {
    folder: 'road_damage',
    public_id: 'photo_' + Date.now()
  });

  const newPhoto = new Photo({
    userId, fullname, email, roadName, damageClass, comment, localTime,
    location,
    photoUrl: uploaded.secure_url,
    imageId: uploaded.public_id
  });
  await newPhoto.save();
  res.json({ message: 'Photo uploaded successfully' });
});

app.get('/get-all-photos', async (req, res) => {
  const photos = await Photo.find().sort({ dateCreated: -1 });
  res.json({ photos });
});

app.delete('/delete-photo/:id', async (req, res) => {
  const photo = await Photo.findById(req.params.id);
  if (!photo) return res.status(404).json({ message: 'Not found' });

  await cloudinary.uploader.destroy(photo.imageId);
  await Photo.findByIdAndDelete(req.params.id);
  res.json({ message: 'Deleted' });
});

// ----- DAMAGE CLASS (Officer) -----
app.post('/damage-class', authMiddleware, async (req, res) => {
  const { damageClass, description, repairCost, userId } = req.body;
  if (!damageClass || !description || !repairCost) {
    return res.status(400).json({ message: 'All fields required' });
  }

  const entry = new DamageClass({ damageClass, description, repairCost, userId });
  await entry.save();
  res.json({ message: 'Saved' });
});

app.get('/damage-class', async (req, res) => {
  const list = await DamageClass.find().sort({ registerDate: -1 });
  res.json(list);
});

// ----- OFFICER REVIEW -----
app.patch('/officer-review/:id', authMiddleware, async (req, res) => {
  const { approvalStatus, officerComment, contractor, validatedByOfficerId } = req.body;
  if (!approvalStatus || !officerComment || !contractor) {
    return res.status(400).json({ message: 'Missing fields' });
  }

  await Photo.findByIdAndUpdate(req.params.id, {
    approvalStatus,
    officerComment,
    contractor,
    validatedByOfficerId,
    validationDate: new Date()
  });

  res.json({ message: 'Review updated' });
});

// ----- MANAGER ADD BUDGET -----
app.patch('/update-budget/:id', authMiddleware, async (req, res) => {
  try {
    const { budget } = req.body;
    await Photo.findByIdAndUpdate(req.params.id, { budget });
    res.json({ message: 'Budget saved' });
  } catch {
    res.status(500).json({ message: 'Failed to update budget' });
  }
});

// ======================= START SERVER =======================
const PORT = 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
