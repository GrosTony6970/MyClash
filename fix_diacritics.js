const fs = require('fs');

const filePath = 'apps/web-admin/app/admin/leagues/league-utils.ts';
const content = fs.readFileSync(filePath, 'utf8');

// Create the combining diacritical characters
const combining300 = String.fromCharCode(0x0300); // ̀
const combining36f = String.fromCharCode(0x036f); // ͯ

const lines = content.split('\n');
let foundCount = 0;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes(combining300) && lines[i].includes(combining36f)) {
    console.log(`Found on line ${i + 1}`);
    foundCount++;
    // Replace the pattern /[combining300-combining36f]/g with /[̀-ͯ]/g
    lines[i] = lines[i].replace(
      new RegExp('\[' + combining300 + '-' + combining36f + '\]', 'g'),
      '[\u0300-\u036f]',
    );
  }
}

console.log(`Found and fixed ${foundCount} occurrences`);
fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
