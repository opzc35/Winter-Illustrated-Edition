#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { paintImage } from './paint_image.js';

function usage() {
    console.log('用法: node run_paint.js <image.png> <tokens.json> <StartX> <StartY> [--no-loop] [--maxRounds=N]');
}

const argv = process.argv.slice(2);
if (argv.length < 4) {
    usage();
    process.exit(1);
}

const imagePath = path.resolve(argv[0]);
const tokensPath = path.resolve(argv[1]);
const opts = { loop: true, maxRounds: Infinity };
for (let i = 4; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-loop') opts.loop = false;
    else if (a.startsWith('--maxRounds=')) opts.maxRounds = parseInt(a.split('=')[1], 10) || Infinity;
}

if (!fs.existsSync(imagePath)) {
    console.error('找不到图片:', imagePath);
    process.exit(2);
}
if (!fs.existsSync(tokensPath)) {
    console.error('找不到 tokens 文件:', tokensPath);
    process.exit(2);
}

let tokensRaw;
try {
    tokensRaw = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
} catch (e) {
    console.error('解析 tokens.json 失败:', e.message);
    process.exit(3);
}

if (!Array.isArray(tokensRaw) || tokensRaw.length === 0) {
    console.error('tokens.json 应该是包含至少一个 {uid, access_key} 的数组');
    process.exit(4);
}

(async () => {
    try {
        await paintImage(imagePath, tokensRaw, argv[2], argv[3], { loop: opts.loop, maxRounds: opts.maxRounds });
    } catch (e) {
        console.error('运行出错:', e.message);
        process.exit(5);
    }
})();
