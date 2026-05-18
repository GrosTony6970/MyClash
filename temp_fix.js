const fs = require('fs');
const path = require('path');

const filePath = 'apps/web-admin/app/admin/leagues/league-utils.ts';
let content = fs.readFileSync(filePath, 'utf8');

// The combining character range U+0300 to U+036F
// In UTF-8: U+0300 = CC 80, U+036F = CD AF
// We need to replace the actual bytes with the text literal "̀-ͯ"

// Split by lines and process
const lines = content.split('\n');
const newLines = [];

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  // Check if line contains the combining character pattern
  if (line.includes('̀') && line.includes('ͯ')) {
    // Replace it with the escape sequence
    line = line.replace(/\[̀-ͯ\]/g, '[\u0300-\u036f]');
  }
  newLines.push(line);
}

fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
console.log('File updated with Unicode escape sequences');
