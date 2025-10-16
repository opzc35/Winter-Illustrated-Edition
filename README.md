# Winter-Illustrated-Edition 绘图脚本

说明：此仓库实现了把本地 PNG 图片绘制到 LGS Paintboard 的脚本，支持多 token 轮流绘制并检测覆盖。

使用方式：

1. 准备一个 `tokens.json` 文件，内容为数组，例如：

```
[
  { "uid": 123456, "access_key": "yourkey1" },
  { "uid": 234567, "access_key": "yourkey2" },
  { "uid": 345678, "access_key": "yourkey3" }
]
```

2. 运行：

```bash
node run_paint.js image.png tokens.json 0 599
```

0 599可以替换为你要画的位置，坐标是整个图片左下角的点坐标

可选参数：
- `--no-loop`：只运行一次，不循环重绘。
- `--maxRounds=N`：最多重绘 N 轮。

注意事项：
- 脚本会尝试连接 https://paintboard.luogu.me，确保网络可达。
- 服务器可能在国内可以直连，不需要代理。
- 本脚本仅供学习和实验用途，请遵守服务器规则与速率限制。
- 请勿用此软件绘画反国家，反社会的相关图片，违者上报LGS Paintboard管理组
洛谷保存站的冬日绘版Python脚本，需要提供uid和accesskey

## 鸣谢

感谢Github Copilot提供的免费AI劳动力。~~比隔壁家CodeX好用多了~~