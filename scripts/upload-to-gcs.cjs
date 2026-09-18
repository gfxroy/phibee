const fs = require('fs');
const path = require('path');
const https = require('https');

function getAccessToken(forceRefresh = false) {
  const { execSync } = require('child_process');
  const configPath = path.join(process.env.HOME, '.config/configstore/firebase-tools.json');
  let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const now = Date.now();
  if (forceRefresh || (config.tokens.expires_at && config.tokens.expires_at <= now + 60000)) {
    try {
      execSync('npx -y firebase-tools projects:list', { stdio: 'pipe' });
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {}
  }
  return config.tokens.access_token;
}

const BUCKET = 'xcoach-interview-2026.firebasestorage.app';

async function uploadFile(filePath, objectName, contentType, downloadFilename) {
  const token = getAccessToken();
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;
  console.log(`\n=== Starting upload for ${downloadFilename} (${(fileSize / (1024 * 1024)).toFixed(1)} MB) -> ${objectName} ===`);

  // Step 1: Initiate Resumable Upload
  const metadata = JSON.stringify({
    name: objectName,
    contentType: contentType,
    contentDisposition: `attachment; filename="${downloadFilename}"`,
    cacheControl: 'public, max-age=86400'
  });

  const sessionUri = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'storage.googleapis.com',
      path: `/upload/storage/v1/b/${BUCKET}/o?uploadType=resumable&name=${encodeURIComponent(objectName)}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'Content-Length': Buffer.byteLength(metadata),
        'X-Upload-Content-Type': contentType,
        'X-Upload-Content-Length': fileSize
      }
    }, res => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(res.headers.location);
      } else {
        let errData = '';
        res.on('data', d => errData += d);
        res.on('end', () => reject(new Error(`Failed to initiate upload (${res.statusCode}): ${errData}`)));
      }
    });
    req.on('error', reject);
    req.write(metadata);
    req.end();
  });

  console.log('Got upload session URI.');

  // Step 2: Stream file
  const urlObj = new URL(sessionUri);
  await new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(filePath);
    const putReq = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PUT',
      headers: {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log(`Upload completed with HTTP ${res.statusCode}`);
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`PUT failed (${res.statusCode}): ${data}`));
        }
      });
    });

    putReq.on('error', reject);

    let uploaded = 0;
    let lastLogged = 0;
    readStream.on('data', chunk => {
      uploaded += chunk.length;
      const pct = Math.floor((uploaded / fileSize) * 100);
      if (pct >= lastLogged + 10 || pct === 100) {
        lastLogged = pct;
        process.stdout.write(`Uploading: ${pct}% (${(uploaded / (1024 * 1024)).toFixed(1)} MB / ${(fileSize / (1024 * 1024)).toFixed(1)} MB)\r`);
      }
    });

    readStream.pipe(putReq);
  });

  console.log('\nSetting public read permission (allUsers: READER)...');
  // Step 3: Set ACL
  await new Promise((resolve, reject) => {
    const aclBody = JSON.stringify({ entity: 'allUsers', role: 'READER' });
    const aclReq = https.request({
      hostname: 'storage.googleapis.com',
      path: `/storage/v1/b/${BUCKET}/o/${encodeURIComponent(objectName)}/acl`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(aclBody)
      }
    }, res => {
      let aclData = '';
      res.on('data', d => aclData += d);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log('ACL set successfully.');
          resolve(JSON.parse(aclData));
        } else {
          reject(new Error(`Failed to set ACL (${res.statusCode}): ${aclData}`));
        }
      });
    });
    aclReq.on('error', reject);
    aclReq.write(aclBody);
    aclReq.end();
  });

  const publicUrl = `https://storage.googleapis.com/${BUCKET}/${objectName}`;
  console.log(`SUCCESS! Public Direct Download URL: ${publicUrl}\n`);
  return publicUrl;
}

module.exports = { uploadFile };

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node upload-to-gcs.cjs <windows|macArm|macIntel|linux|all>');
    process.exit(1);
  }

  const files = {
    windows: {
      path: fs.existsSync('release/downloads/Phibee-0.3.0-win-x64.exe') ? 'release/downloads/Phibee-0.3.0-win-x64.exe' : (fs.existsSync('release/downloads/Phibee-Windows.exe') ? 'release/downloads/Phibee-Windows.exe' : 'release/downloads/Phiby-0.3.0-win-x64.exe'),
      name: 'downloads/Phibee-Windows.exe',
      type: 'application/octet-stream',
      filename: 'Phibee-Windows.exe'
    },
    macArm: {
      path: fs.existsSync('release/downloads/Phibee-macos-ARM64.zip') ? 'release/downloads/Phibee-macos-ARM64.zip' : (fs.existsSync('release/downloads/Phibee-Mac-AppleSilicon.zip') ? 'release/downloads/Phibee-Mac-AppleSilicon.zip' : 'release/downloads/Phiby-macos-ARM64.zip'),
      name: 'downloads/Phibee-Mac-AppleSilicon.zip',
      type: 'application/zip',
      filename: 'Phibee-Mac-AppleSilicon.zip'
    },
    macIntel: {
      path: fs.existsSync('release/downloads/Phibee-macos-X64.zip') ? 'release/downloads/Phibee-macos-X64.zip' : (fs.existsSync('release/downloads/Phibee-Mac-Intel.zip') ? 'release/downloads/Phibee-Mac-Intel.zip' : 'release/downloads/Phiby-macos-X64.zip'),
      name: 'downloads/Phibee-Mac-Intel.zip',
      type: 'application/zip',
      filename: 'Phibee-Mac-Intel.zip'
    },
    macDmgArm: {
      path: fs.existsSync('release/installers/Phibee-Mac-AppleSilicon.dmg') ? 'release/installers/Phibee-Mac-AppleSilicon.dmg' : 'release/installers/Phiby-Mac-AppleSilicon.dmg',
      name: 'downloads/Phibee-Mac-AppleSilicon.dmg',
      type: 'application/x-apple-diskimage',
      filename: 'Phibee-Mac-AppleSilicon.dmg'
    },
    macDmgIntel: {
      path: fs.existsSync('release/installers/Phibee-Mac-Intel.dmg') ? 'release/installers/Phibee-Mac-Intel.dmg' : 'release/installers/Phiby-Mac-Intel.dmg',
      name: 'downloads/Phibee-Mac-Intel.dmg',
      type: 'application/x-apple-diskimage',
      filename: 'Phibee-Mac-Intel.dmg'
    },
    linux: {
      path: fs.existsSync('release/downloads/Phibee-0.3.0-linux-x86_64.AppImage') ? 'release/downloads/Phibee-0.3.0-linux-x86_64.AppImage' : (fs.existsSync('release/downloads/Phibee-Linux.AppImage') ? 'release/downloads/Phibee-Linux.AppImage' : 'release/downloads/Phiby-0.3.0-linux-x86_64.AppImage'),
      name: 'downloads/Phibee-Linux.AppImage',
      type: 'application/x-executable',
      filename: 'Phibee-Linux.AppImage'
    }
  };

  async function uploadWithRetry(filePath, objectName, contentType, downloadFilename, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await uploadFile(filePath, objectName, contentType, downloadFilename);
        return;
      } catch (err) {
        console.warn(`\nUpload attempt ${attempt} failed: ${err.message}`);
        if (attempt === maxRetries) throw err;
        console.log('Retrying upload in 3 seconds...');
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  (async () => {
    if (target === 'all') {
      for (const key of Object.keys(files)) {
        await uploadWithRetry(files[key].path, files[key].name, files[key].type, files[key].filename);
      }
      process.exit(0);
    } else if (files[target]) {
      await uploadWithRetry(files[target].path, files[target].name, files[target].type, files[target].filename);
      process.exit(0);
    } else {
      console.error('Unknown target:', target);
      process.exit(1);
    }
  })().catch(err => {
    console.error('Fatal upload error:', err);
    process.exit(1);
  });
}
