const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
const contentDir = path.join(__dirname, 'content', 'products');
const tmpDir = path.join(__dirname, 'tmp-uploads');
fs.mkdirSync(contentDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

// Multer configuration for temporary file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tmpDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static admin page
app.use(express.static(path.join(__dirname, 'views')));
// Serve product content folder statically for thumbnails
app.use('/content/products', express.static(path.join(__dirname, 'content', 'products')));

// Helper to slugify titles
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

// Parse Markdown Front Matter (very simple YAML parser for our specific use case)
function parseFrontMatter(content) {
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { attributes: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2];
  const attributes = {};

  yamlBlock.split('\n').forEach(line => {
    const parts = line.split(':');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join(':').trim();
      attributes[key] = parseYamlScalar(val);
    }
  });

  return { attributes, body };
}

function parseYamlScalar(value) {
  const trimmed = (value || '').trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return trimmed.slice(1, -1);
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  return trimmed;
}

function formatYamlString(value) {
  return JSON.stringify(String(value || '').replace(/\\"/g, '"'));
}

function normalizeReferenceUrl(url) {
  const value = (url || '').trim();
  if (!value) return '';

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch (error) {
    // Invalid URLs are treated as empty optional fields.
  }

  return '';
}

function normalizeAvailableFrom(date) {
  const value = (date || '').trim();
  if (!value) return '';

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function parseBoolean(value) {
  return value === true || value === 'true';
}

function parseCategories(value) {
  if (Array.isArray(value)) {
    return value.map(String).map(item => item.trim()).filter(Boolean);
  }

  const raw = (value || '').trim();
  if (!raw) return [];

  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(String).map(item => item.trim()).filter(Boolean);
      }
    } catch (error) {
      // Fall back to comma parsing below.
    }
  }

  return raw
    .split(',')
    .map(item => item.replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
}

function formatCategories(value) {
  const categories = [...new Set(parseCategories(value))];
  const quoted = categories.map(formatYamlString);
  return `[${quoted.join(', ')}]`;
}

// API: Get all products
app.get('/api/products', (req, res) => {
  try {
    if (!fs.existsSync(contentDir)) {
      return res.json([]);
    }

    const folders = fs.readdirSync(contentDir);
    const productos = [];

    folders.forEach(folder => {
      const folderPath = path.join(contentDir, folder);
      if (fs.statSync(folderPath).isDirectory()) {
        const mdPath = path.join(folderPath, 'index.md');
        if (fs.existsSync(mdPath)) {
          const content = fs.readFileSync(mdPath, 'utf-8');
          const { attributes, body } = parseFrontMatter(content);
          
          // Get images in the same folder
          const files = fs.readdirSync(folderPath);
          const images = files.filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));

          const categories = parseCategories(attributes.categories);

          productos.push({
            slug: folder,
            title: attributes.title || folder,
            price: parseFloat(attributes.price) || 0,
            date: attributes.date || '',
            description: body.trim(),
            category: categories.join(', '),
            categories: categories,
            referenceUrl: attributes.referenceUrl || '',
            availableFrom: normalizeAvailableFrom(attributes.availableFrom),
            weight: parseInt(attributes.weight) || 100,
            images: images,
            sold: parseBoolean(attributes.sold),
            onHold: parseBoolean(attributes.onHold)
          });
        }
      }
    });

    // Sort by date descending
    productos.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(productos);
  } catch (error) {
    console.error('Error reading products:', error);
    res.status(500).json({ error: 'Error getting products' });
  }
});

// API: Create new product
app.post('/api/products', upload.array('photos', 10), (req, res) => {
  try {
    const { title, price, description, category, referenceUrl, availableFrom, weight } = req.body;
    if (!title || !price) {
      return res.status(400).json({ error: 'Title and price are required.' });
    }

    const slug = slugify(title);
    const productDir = path.join(contentDir, slug);

    if (fs.existsSync(productDir)) {
      return res.status(400).json({ error: 'A product with a similar title already exists.' });
    }

    // Create product directory
    fs.mkdirSync(productDir, { recursive: true });

    // Move uploaded files to the product directory
    const movedImages = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach((file, index) => {
        const ext = path.extname(file.originalname).toLowerCase();
        // Give clean, sequential filenames: foto-1.jpg, foto-2.jpg
        const newFileName = `foto-${index + 1}${ext}`;
        const newPath = path.join(productDir, newFileName);
        fs.renameSync(file.path, newPath);
        movedImages.push(newFileName);
      });
    }

    // Clean up any remaining temp files just in case
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    // Generate Markdown file content
    const dateStr = new Date().toISOString();
    const weightNum = parseInt(weight) || 100;
    const catStr = formatCategories(category);
    const refUrl = normalizeReferenceUrl(referenceUrl);
    const availableFromDate = normalizeAvailableFrom(availableFrom);
    const markdownContent = `---
title: ${formatYamlString(title)}
price: ${parseFloat(price)}
date: ${dateStr}
draft: false
categories: ${catStr}
referenceUrl: ${formatYamlString(refUrl)}
availableFrom: ${formatYamlString(availableFromDate)}
weight: ${weightNum}
sold: false
onHold: false
---
${description || ''}
`;

    fs.writeFileSync(path.join(productDir, 'index.md'), markdownContent, 'utf-8');

    res.status(201).json({ success: true, slug: slug });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Internal server error while creating product' });
  }
});

// API: Update product
app.post('/api/products/:oldSlug', upload.array('photos', 10), (req, res) => {
  try {
    const oldSlug = req.params.oldSlug;
    const oldProductDir = path.join(contentDir, oldSlug);

    if (!fs.existsSync(oldProductDir)) {
      return res.status(404).json({ error: 'Product does not exist.' });
    }

    const { title, price, description, category, referenceUrl, availableFrom, weight, deletePhotos, photoOrder } = req.body;
    if (!title || !price) {
      return res.status(400).json({ error: 'Title and price are required.' });
    }

    const newSlug = slugify(title);
    let productDir = oldProductDir;

    // 1. Handle directory rename if title changes
    if (newSlug !== oldSlug) {
      const newProductDir = path.join(contentDir, newSlug);
      if (fs.existsSync(newProductDir)) {
        return res.status(400).json({ error: 'A product with a similar title already exists.' });
      }
      fs.renameSync(oldProductDir, newProductDir);
      productDir = newProductDir;
    }

    // 2. Handle photo deletions
    if (deletePhotos) {
      let photosToDelete = [];
      try {
        photosToDelete = JSON.parse(deletePhotos);
      } catch (e) {
        photosToDelete = Array.isArray(deletePhotos) ? deletePhotos : [deletePhotos];
      }

      photosToDelete.forEach(photoName => {
        const photoPath = path.join(productDir, photoName);
        if (fs.existsSync(photoPath)) {
          fs.unlinkSync(photoPath);
        }
      });
    }

    // 3. Handle photo reordering & renaming
    let files = fs.readdirSync(productDir);
    let remainingImages = files.filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));

    let orderList = [];
    if (photoOrder) {
      try {
        orderList = JSON.parse(photoOrder);
      } catch (e) {
        orderList = Array.isArray(photoOrder) ? photoOrder : [photoOrder];
      }
    }

    // Sort remaining images based on photoOrder, then append others
    let sortedRemaining = [];
    orderList.forEach(photoName => {
      if (remainingImages.includes(photoName)) {
        sortedRemaining.push(photoName);
      }
    });
    remainingImages.forEach(photoName => {
      if (!sortedRemaining.includes(photoName)) {
        sortedRemaining.push(photoName);
      }
    });

    const tempPrefix = 'temp_reorder_' + Date.now() + '_';
    const tempRenamed = [];
    
    sortedRemaining.forEach((image, index) => {
      const ext = path.extname(image);
      const tempName = `${tempPrefix}${index + 1}${ext}`;
      fs.renameSync(path.join(productDir, image), path.join(productDir, tempName));
      tempRenamed.push({ tempName, ext });
    });

    tempRenamed.forEach((item, index) => {
      const finalName = `foto-${index + 1}${item.ext}`;
      fs.renameSync(path.join(productDir, item.tempName), path.join(productDir, finalName));
    });

    // 4. Move new uploaded photos sequentially
    let finalImageCount = tempRenamed.length;
    if (req.files && req.files.length > 0) {
      req.files.forEach((file, index) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const newFileName = `foto-${finalImageCount + index + 1}${ext}`;
        const newPath = path.join(productDir, newFileName);
        fs.renameSync(file.path, newPath);
      });
    }

    // Clean up temp files in upload folder
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    // 5. Read original creation date and status if possible
    let dateStr = new Date().toISOString();
    let originalSold = false;
    let originalOnHold = false;
    const mdPath = path.join(productDir, 'index.md');
    if (fs.existsSync(mdPath)) {
      const originalContent = fs.readFileSync(mdPath, 'utf-8');
      const { attributes } = parseFrontMatter(originalContent);
      if (attributes.date) {
        dateStr = attributes.date;
      }
      originalSold = parseBoolean(attributes.sold);
      originalOnHold = parseBoolean(attributes.onHold);
    }

    // 6. Write updated Markdown
    const weightNum = parseInt(weight) || 100;
    const catStr = formatCategories(category);
    const refUrl = normalizeReferenceUrl(referenceUrl);
    const availableFromDate = normalizeAvailableFrom(availableFrom);
    const markdownContent = `---
title: ${formatYamlString(title)}
price: ${parseFloat(price)}
date: ${dateStr}
draft: false
categories: ${catStr}
referenceUrl: ${formatYamlString(refUrl)}
availableFrom: ${formatYamlString(availableFromDate)}
weight: ${weightNum}
sold: ${originalSold}
onHold: ${originalOnHold}
---
${description || ''}
`;

    fs.writeFileSync(mdPath, markdownContent, 'utf-8');

    res.json({ success: true, slug: newSlug });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Internal server error while updating product' });
  }
});

// API: Update product status (available/sold/on hold)
app.post('/api/products/:slug/status', (req, res) => {
  try {
    const slug = req.params.slug;
    const { status, sold, onHold } = req.body;
    const productDir = path.join(contentDir, slug);
    const mdPath = path.join(productDir, 'index.md');

    if (!fs.existsSync(mdPath)) {
      return res.status(404).json({ error: 'Product does not exist.' });
    }

    const content = fs.readFileSync(mdPath, 'utf-8');
    const { attributes, body } = parseFrontMatter(content);

    let soldStatus = parseBoolean(attributes.sold);
    let onHoldStatus = parseBoolean(attributes.onHold);

    if (status === 'sold') {
      soldStatus = true;
      onHoldStatus = false;
    } else if (status === 'onHold') {
      soldStatus = false;
      onHoldStatus = true;
    } else if (status === 'available') {
      soldStatus = false;
      onHoldStatus = false;
    } else if (sold !== undefined) {
      soldStatus = parseBoolean(sold);
      onHoldStatus = false;
    } else if (onHold !== undefined) {
      onHoldStatus = parseBoolean(onHold);
      if (onHoldStatus) {
        soldStatus = false;
      }
    }

    const categoriesStr = formatCategories(attributes.categories);
    const availableFrom = normalizeAvailableFrom(attributes.availableFrom);

    // Write updated Markdown
    const markdownContent = `---
title: ${formatYamlString(attributes.title || slug)}
price: ${parseFloat(attributes.price) || 0}
date: ${attributes.date || new Date().toISOString()}
draft: false
categories: ${categoriesStr}
weight: ${parseInt(attributes.weight) || 100}
referenceUrl: ${formatYamlString(normalizeReferenceUrl(attributes.referenceUrl))}
availableFrom: ${formatYamlString(availableFrom)}
sold: ${soldStatus}
onHold: ${onHoldStatus}
---
${body.trim()}
`;

    fs.writeFileSync(mdPath, markdownContent, 'utf-8');
    res.json({ success: true, sold: soldStatus, onHold: onHoldStatus });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ error: 'Error updating product status' });
  }
});

// API: Reorder all products
app.post('/api/reorder-products', (req, res) => {
  try {
    const { slugs } = req.body;
    if (!slugs || !Array.isArray(slugs)) {
      return res.status(400).json({ error: 'Slugs array is required.' });
    }

    slugs.forEach((slug, index) => {
      const productDir = path.join(contentDir, slug);
      const mdPath = path.join(productDir, 'index.md');
      if (fs.existsSync(mdPath)) {
        const content = fs.readFileSync(mdPath, 'utf-8');
        const { attributes, body } = parseFrontMatter(content);
        
        const weightNum = index + 1;
        const titleVal = attributes.title || slug;
        const priceVal = parseFloat(attributes.price) || 0;
        const dateVal = attributes.date || new Date().toISOString();
        const referenceUrlVal = normalizeReferenceUrl(attributes.referenceUrl);
        const availableFromVal = normalizeAvailableFrom(attributes.availableFrom);
        
        const category = formatCategories(attributes.categories);
        
        const soldVal = parseBoolean(attributes.sold);
        const onHoldVal = parseBoolean(attributes.onHold);
        
        const markdownContent = `---
title: ${formatYamlString(titleVal)}
price: ${priceVal}
date: ${dateVal}
draft: false
categories: ${category}
referenceUrl: ${formatYamlString(referenceUrlVal)}
availableFrom: ${formatYamlString(availableFromVal)}
weight: ${weightNum}
sold: ${soldVal}
onHold: ${onHoldVal}
---
${body.trim()}
`;

        fs.writeFileSync(mdPath, markdownContent, 'utf-8');
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error reordering products:', error);
    res.status(500).json({ error: 'Internal server error while reordering products.' });
  }
});

// API: Delete product
app.delete('/api/products/:slug', (req, res) => {
  try {
    const slug = req.params.slug;
    const productDir = path.join(contentDir, slug);

    if (!fs.existsSync(productDir)) {
      return res.status(404).json({ error: 'Product does not exist.' });
    }

    // Remove recursively
    fs.rmSync(productDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Error deleting product' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Admin server running on http://localhost:${PORT}`);
});
