const fs = require('fs');

const filePath = 'apps/web-admin/app/admin/leagues/league-utils.ts';
const content = fs.readFileSync(filePath, 'utf8');

// Use String.fromCharCode to match the actual bytes
// U+0300 (̀) in UTF-8 is CC 80
// U+036F (ͯ) in UTF-8 is CD AF
const combining300 = String.fromCharCode(0x0300); // ̀
const combining36f = String.fromCharCode(0x036f); // ͯ
const pattern = new RegExp(`\[${combining300}-${combining36f}\]`, 'g');

const newContent = content.replace(pattern, '[\u0300-\u036f]');

fs.writeFileSync(filePath, newContent, 'utf8');
console.log('Replaced combining characters with Unicode escape sequences');
