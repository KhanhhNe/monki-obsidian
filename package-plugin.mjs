import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ZipArchive } from 'archiver';

const releaseFiles = [
	'main.js',
	'manifest.json',
	'styles.css',
	'assets/outline-dog.png',
];
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const outputDirectory = 'release';
const outputPath = path.join(
	outputDirectory,
	`${manifest.id}-${manifest.version}.zip`,
);

await mkdir(outputDirectory, { recursive: true });

const output = createWriteStream(outputPath);
const archive = new ZipArchive({ zlib: { level: 9 } });

const completed = new Promise((resolve, reject) => {
	output.on('close', resolve);
	output.on('error', reject);
	archive.on('error', reject);
});

archive.pipe(output);

for (const file of releaseFiles) {
	archive.file(file, { name: path.posix.join(manifest.id, file) });
}

await archive.finalize();
await completed;

console.log(`Created ${outputPath} (${archive.pointer()} bytes)`);
