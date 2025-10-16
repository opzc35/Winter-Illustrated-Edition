// 用于批量绘制图片到画板左下角，支持多token轮流绘制，png输入
import sharp from 'sharp';
import { paint } from './index.js';
import fs from 'fs';

/**
 * 批量绘制图片到画板左下角
 * @param {string} imagePath png图片路径
 * @param {Array<{uid:number, access_key:string}>} tokens token列表
 * @param {number} startX 左下角x坐标，默认0
 * @param {number} startY 左下角y坐标，默认599
 */

// 获取画板当前像素数据（arraybuffer）
async function getBoard() {
    const res = await fetch('https://paintboard.luogu.me/api/paintboard/getboard');
    if (!res.ok) throw new Error('获取画板失败: ' + res.status);
    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
}
async function paintImage(imagePath, tokens, startX = 0, startY = 599, options = {}, painter = paint) {
    const { loop = true, maxRounds = Infinity } = options;
    let round = 0;
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    const { width, height, channels } = metadata;
    if (channels < 3) throw new Error('图片通道数不足3(RGB)');
    const pixels = await image.raw().toBuffer();

    // 准备点队列：每个元素 {x,y,r,g,b}
    const points = [];
    for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
            const i = (dy * width + dx) * channels;
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const x = startX + dx;
            const y = startY - (height - 1 - dy);
            if (x < 0 || x >= 1000 || y < 0 || y >= 600) continue;
            points.push({ x, y, r, g, b });
        }
    }

    const waitTime = Math.max(1, options.waitTime ?? Math.ceil(30000 / tokens.length)); // allow override for dry-run

    while (round < maxRounds) {
        round++;
        console.log(`开始第 ${round} 轮绘制，共 ${points.length} 个像素`);
        // 在每轮开始时获取画板快照
        let board = null;
        if (!options.skipBoard) {
            try {
                board = await getBoard();
            } catch (e) {
                console.warn('无法获取画板快照，继续绘制但无法检测覆盖：', e.message);
            }
        }

        let tokenIdx = 0;
        const redo = [];

        for (const p of points) {
            const { x, y, r, g, b } = p;
            let needPaint = true;
            if (board) {
                const idx = (y * 1000 + x) * 3;
                const br = board[idx], bg = board[idx + 1], bb = board[idx + 2];
                if (br === r && bg === g && bb === b) {
                    needPaint = false;
                }
            }
            if (!needPaint) continue;

            const { uid, access_key } = tokens[tokenIdx];
            const res = await painter(uid, access_key, r, g, b, x, y);
            tokenIdx = (tokenIdx + 1) % tokens.length;
            // 本地更新board缓存
            if (board) {
                const idx = (y * 1000 + x) * 3;
                board[idx] = r; board[idx + 1] = g; board[idx + 2] = b;
            }
            // 如果服务器可能会被覆盖（或返回冷却），将该点加入重绘队列
            // 这里我们简单地把所有点都放入重绘队列，下一轮会再次检测是否需要绘制
            redo.push(p);
            await new Promise(res => setTimeout(res, waitTime));
        }   

        console.log(`第 ${round} 轮绘制完成，待重绘点 ${redo.length}`);

        if (!loop) break;
        // 如果没有点需要重绘，则停止
        if (redo.length === 0) break;
        // 下一轮以 redo 为 points
        points.length = 0;
        points.push(...redo);
        // 小间隔，避免立即刷新导致问题
        await new Promise(res => setTimeout(res, 1000));
    }
    console.log('绘制过程结束');
}

async function paintPoint(tokens, sx, sy, painter = paint) {
    let tokenIdx = 0;

    while ( true ) {
        const r = 0;
        const g = 0;
        const b = 255;
        const x = sx;
        const y = sy;
        const { uid, access_key } = tokens[tokenIdx];
        await painter(uid, access_key, r, g, b, x, y);
        tokenIdx = (tokenIdx + 1) % tokens.length;
        await new Promise(res => setTimeout(res, 50) );
    }
}

// 示例用法：
// const tokens = [
//   { uid: 123, access_key: 'xxx' },
//   { uid: 456, access_key: 'yyy' },
//   { uid: 789, access_key: 'zzz' }
// ];
// paintImage('test.png', tokens);

// library export only; example usage commented out
// const tokens = [ { uid: 123, access_key: 'xxx' }, ... ];
// paintImage('test.png', tokens, 0, 599);

export { paintImage, paintPoint };
