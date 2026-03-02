const { execSync } = require('child_process');
const fs = require('fs');
const prettier = require('prettier');

async function fixAll() {
  try {
    // Get all files that fail the check (gives paths separated by newlines)
    const output = execSync('npx prettier --list-different .', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const files = output
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f);

    console.log(`Found ${files.length} files to format.`);

    for (const file of files) {
      if (!fs.existsSync(file)) continue;

      const content = fs.readFileSync(file, 'utf8');
      const options = await prettier.resolveConfig(file);
      const formatted = await prettier.format(content, { ...options, filepath: file });

      // Enforce LF
      fs.writeFileSync(file, formatted.replace(/\r\n/g, '\n'), 'utf8');
      console.log(`OK: ${file}`);
    }
  } catch (e) {
    if (e.stdout) {
      // prettier --list-different exits with code 1 if there are differences.
      const files = e.stdout
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f);
      console.log(`Found ${files.length} files to format from error stdout.`);
      for (const file of files) {
        if (!fs.existsSync(file)) continue;

        try {
          const content = fs.readFileSync(file, 'utf8');
          const options = await prettier.resolveConfig(file);
          const formatted = await prettier.format(content, { ...options, filepath: file });

          // Enforce LF
          fs.writeFileSync(file, formatted.replace(/\r\n/g, '\n'), 'utf8');
          console.log(`OK: ${file}`);
        } catch (innerE) {
          console.error(`FAIL processing ${file}:`, innerE.message);
        }
      }
    } else {
      console.error('Error:', e.message);
    }
  }
}

fixAll();
