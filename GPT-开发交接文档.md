# AETHER 三维官网 · GPT 开发交接文档

> 用途：把这份文档整份丢给 GPT，它就能在已经跑通的原型基础上继续开发。
> 前提：原型代码在你本机 `E:\WebProjects\aether-3d-world\`，GPT 读不到本地文件，所以本文档必须自带全部关键信息。

---

## 0. 怎么用这份文档

1. **先发第 1 节 + 第 2 节**给 GPT，让它建立上下文。
2. 再发 **第 4、5、6 节**（设计规范），让它知道现有世界的参数。
3. 然后**按第 9 节的任务清单，一次只发一步**。不要一次让它干完六步——它会把代码写崩。
4. 每一步做完，让它**只输出完整的单个文件内容**，不要输出 diff 片段（diff 容易出错）。
5. 拿到代码后替换本地对应文件，刷新页面验证，再进入下一步。

第 10 节有两段现成的 prompt，可以直接复制。

---

## 1. 项目是什么

一个**整站沉浸式三维世界**类型的品牌官网（参考 Igloo Inc、Lusion、Apple 产品页）。

核心特征：

- 打开网站先有一段**电影感开场**：摄像机从远处飞入，视场角从 89° 收束到 55°
- **滚动条即时间轴**。页面被切成 6 个"镜头"（章节），用户滚动时摄像机沿着一条预设曲线在三维空间中飞行，依次经过 6 组物体
- 文字层浮在画布之上，随滚动进度淡入淡出，交叉溶解
- 整站是**近黑底色 + 单一冷色强调**，靠菲涅尔边缘光和辉光制造"发光体"质感
- 鼠标移动带来轻微视差；点击任意位置触发一次能量脉冲（辉光增强 + 摄像机轻微后撤）
- 纯程序化生成几何体，**不依赖任何三维素材文件**

商业目标：让人愿意多停留 40 秒，并在最后一段完成留资转化。

---

## 2. 技术栈与依赖

### 2.1 运行环境

| 项 | 值 |
|---|---|
| 语言 | 原生 ES Module（不用构建工具、不用打包器） |
| three.js | **0.160.0**（本地文件，不走 CDN） |
| 样式 | 原生 CSS，CSS 变量 + 媒体查询 |
| 字体 | 系统字体栈，不引入网络字体 |
| 构建 | 无。直接静态托管即可 |

### 2.2 本地文件清单（已存在，不要重新下载）

```
vendor/three.module.js                              (1,272,972 字节)
vendor/jsm/postprocessing/EffectComposer.js
vendor/jsm/postprocessing/Pass.js
vendor/jsm/postprocessing/RenderPass.js
vendor/jsm/postprocessing/ShaderPass.js
vendor/jsm/postprocessing/MaskPass.js
vendor/jsm/postprocessing/UnrealBloomPass.js
vendor/jsm/postprocessing/OutputPass.js
vendor/jsm/shaders/CopyShader.js
vendor/jsm/shaders/LuminosityHighPassShader.js
vendor/jsm/shaders/OutputShader.js
```

### 2.3 模块引用方式

`index.html` 里用 importmap 把裸标识符 `three` 指到本地文件。**这一行不能删**：

```html
<script type="importmap">
{
  "imports": {
    "three": "./vendor/three.module.js"
  }
}
</script>
```

`world.js` 的导入头部：

```js
import * as THREE from 'three';
import { EffectComposer }   from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass }       from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass }       from './vendor/jsm/postprocessing/OutputPass.js';
```

### 2.4 硬约束（违反会直接白屏）

- 必须通过 **http 服务**打开，不能双击本地文件（`file://` 下 ES Module 会被浏览器拦截）
- 不要引入 GSAP、Lenis、React、Vue 等额外依赖。滚动平滑、缓动、文字调度都已在 `world.js` 内部手写实现
- 不要升级 three.js 版本。postprocessing 那批文件是按 0.160.0 的接口写的

### 2.5 已知踩过的坑（不要再犯）

**坑一：世界对象的作用域**

`world.js` 里所有场景对象（`gCore`、`gShards`、`swarm`、`portalRing` 等 22 个）都声明在**模块顶层**，
因为渲染循环 `tick()` 也在模块顶层，需要访问它们。

初始化代码**不能**用 `if (renderer) { ... }` 或 `{ ... }` 之类的块包起来 ——
那样这些 `const` 会变成块级作用域，`tick()` 一跑就抛 `Uncaught ReferenceError: gCore is not defined`，
整个页面直接停摆。

WebGL 不可用的处理方式是在顶层提前中断：

```js
if (!renderer) throw new Error('WebGL 不可用，已停止三维世界初始化');
```

后续如果新增场景对象，**直接写在模块顶层并 push 进 `MATERIALS` 数组**，不要包进任何新的块里。

**坑二：摄像机采样必须用 `getPoint()`**

见 4.1 节。用 `getPointAt()` 会让镜头和文字窗口错位。

**坑三：点击脉冲会拉变形方块**

`uPulse` 会让顶点沿法线外推。方块群集（第 5 章）靠 `scale.y` 做波，再叠加脉冲位移会明显变形。
所以 `aetherMaterial()` 提供了一个 `pulseScale` 参数，群集材质传 `0` 关掉脉冲响应。
新增用 scale 做形变的物体时，记得同样传 `pulseScale: 0`。

**坑四：菲涅尔公式必须用 `abs()`（这条最容易漏）**

第一版的片元着色器写的是：

```glsl
float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uRimPower);   // 错的
```

看起来没问题，但**所有加色外壳（大气壳、线框壳）都是 `side: THREE.BackSide` 渲染的**。
背面的几何法线依然朝外，而视线方向是从表面指向摄像机，所以背面上 `dot(N, V)` **恒为负数**，
被 `clamp` 压成 `0`，于是 `fres` 永远等于 `1` —— 整层壳以最大亮度均匀发光，
在屏幕上就是一团直径占半屏的白色巨球。

改成：

```glsl
float fres = pow(1.0 - abs(dot(N, V)), uRimPower);              // 对的
```

`abs()` 对正面渲染没有影响（正面 `dot(N,V)` 本就是正的），但让背面渲染也能得到正确的
"轮廓亮、中间暗"的菲涅尔渐变。

**通用规律**：只要材质用了 `side: THREE.BackSide` 或 `THREE.DoubleSide`，
着色器里一切基于 `dot(法线, 视线)` 的计算都必须用 `abs()`。

---

## 3. 目录结构

```
aether-3d-world/
├── index.html                     约 4.9 KB   界面层：加载页、顶栏、6 段文字、章节指示器、页脚
├── style.css                      约 10 KB   全部样式，含移动端与减少动效适配
├── world.js                       约 34 KB   三维世界全部逻辑
└── vendor/                                    三维引擎与后期处理（见 2.2）
```

### world.js 内部分区

```
1) 环境与工具函数          REDUCED / MOBILE 检测、clamp / smoothstep / easeOutExpo
2) 着色器                  NOISE_GLSL / AETHER_VERT / AETHER_FRAG / POINTS_VERT / POINTS_FRAG
3) 材质与贴图工厂          aetherMaterial() / makeGlowTexture() / makeBgTexture()
4) 场景构建                星尘、地面网格、六个章节物体
5) 摄像机路径与滚动         ANCHORS / WINDOWS / 滚动与鼠标输入
6) 章节文字调度             updateChapters()
7) 交互                    开场、点击脉冲、章节跳转、表单、光标光晕
8) 尺寸与性能               onResize() / perfGuard()
9) 渲染循环                 tick()
```

---

## 4. 场景设计规范

### 4.1 摄像机锚点表（最关键的一张表）

进度 `p` 取 `0 / 0.2 / 0.4 / 0.6 / 0.8 / 1.0` 时，摄像机**正好**落在对应锚点。
这是因为曲线用 `CatmullRomCurve3.getPoint(p)` 采样，6 个控制点在参数空间均匀分布 —— **不要改成 `getPointAt()`**，那会按弧长重参数化，导致镜头与文字错位。

| 章节 | 名称 | 摄像机位置 cam | 注视目标 tgt | 该章物体位置 |
|---|---|---|---|---|
| 01 | Genesis | `0, 1.2, 20` | `0, 0, 0` | `0, 0, 0` |
| 02 | Shards | `14, 2.2, 4` | `12.5, 4.5, -9` | `12.5, 4.5, -9` |
| 03 | Flow | `23, -1.2, -15` | `23, -1.2, -30` | `23, -1.2, -30` |
| 04 | Orbit | `35, 5, -33` | `35, 5, -46` | `35, 5, -46` |
| 05 | Swarm | `45, 1, -52` | `45, 3, -62` | `45, 3, -62` |
| 06 | Portal | `56, 0.6, -73` | `58, 0, -88` | `58, 0, -88` |

摄像机到对应物体的距离都控制在 12～21 之间，保证主体占据画面合适比例。相邻锚点间距约 21～24，飞行的速度感因此比较均匀。

### 4.2 章节物体构成

**01 Genesis — 核心**
- 实体主球：`IcosahedronGeometry(3.4, 5)`，深蓝到亮蓝，噪声位移幅度 0.16
- 内核：`IcosahedronGeometry(1.55, 3)`，加色混合，高速反向自转
- 大气壳：`IcosahedronGeometry(5.0, 4)`，加色混合、背面渲染，菲涅尔指数 3.6，不透明度 0.16
- 线框壳：`IcosahedronGeometry(5.6, 1)`，线框 + 双面 + 加色，不透明度 0.15
- 一张尺寸 12、不透明度 0.20 的辉光贴片

**02 Shards — 碎晶**
- 14 块晶体（八面体 / 四面体 / 小八面体三种几何体循环），绕中心半径 2.1～4.4 球面散布
- 每块有独立自转速度，并在原地做小幅漂浮

**03 Flow — 流动**
- `TorusKnotGeometry(2.9, 0.82, 260, 36, 2, 3)`，噪声位移幅度 **0.30**（全场最大），制造"液态"形变
- 外层 1.12 倍线框壳，加色混合

**04 Orbit — 轨道**
- 4 道圆环 `TorusGeometry(3.5 + i*0.42, 0.035, 6, 190)`，各自倾角随机 ±0.45 rad，转速递增 0.10~0.235
- 6 颗卫星在环平面内公转，半径 3.9~5.5
- 整组有 0.24 rad 的 Z 轴倾斜

**05 Swarm — 群集**
- 11 × 11 = 121 个小立方体，间距 1.02，铺在 XZ 平面上
- 每个方块的 `position.y` 和 `scale.y` 由 `sin(time * 1.05 + (ix + iz) * 0.42)` 驱动 —— **相位只由 (ix+iz) 决定**，这是"看起来复杂、算起来很便宜"的关键
- 移动端降到 8 × 8

**06 Portal — 门户**
- 主环 `TorusGeometry(6, 0.30, 20, 168)`，加色混合
- 外圈细环 `TorusGeometry(6.9, 0.06, 8, 168)`，反向旋转
- 内部圆盘：独立着色器，径向渐变 + 旋转波纹
- 260 个粒子组成的星环 + 一张尺寸 34 的辉光贴片

### 4.3 环境元素

- **星尘**：桌面 4200 点 / 移动 1500 点，分布在 `320 × 198 × 320` 的盒子里，缓慢整体旋转
- **近景浮尘**：桌面 1100 点 / 移动 420 点，集中在 `(28, 2, -44)` 附近
- **地面网格**：`GridHelper(520, 86)` 放在 `(28, -22, -34)`，透明度 0.34，给空间一个地平线参照
- **雾**：`FogExp2(0x080c18, 0.0100)`。自定义着色器里的雾是**手写实现**的，不依赖 three 的雾代码块

### 4.4 章节文字窗口（进度区间）

| 章节 | 窗口 `[起, 止]` | 淡入 | 淡出 |
|---|---|---|---|
| 01 | `-0.125 ~ 0.125` | 开场直接可见 | 0.55 → 1.0 淡出 |
| 02 | `0.075 ~ 0.325` | 0 → 0.30 升起 | 0.70 → 1.0 淡出 |
| 03 | `0.275 ~ 0.525` | 同上 | 同上 |
| 04 | `0.475 ~ 0.725` | 同上 | 同上 |
| 05 | `0.675 ~ 0.925` | 同上 | 同上 |
| 06 | `0.875 ~ 1.125` | 同上 | 不淡出（停在页尾） |

窗口宽度 0.25、间隔 0.20，相邻章节有 0.05 的重叠 —— 这段重叠是**故意的**，用来做电影式的交叉溶解。窗口全宽是 0.25。

---

## 5. 视觉规范

### 5.1 配色

```
页面底色        #05060a    近黑，略带蓝
雾 / 背景色      #080c18
强调色 1        #7ad1ff    冷蓝（章节序号、进度条、指示器）
强调色 2        #a78bfa    紫（渐变末端、Flow 章节）
正文白          #f5f5f7
次级文字        rgba(245,245,247,.64)
三级文字        rgba(245,245,247,.42)
分割线          rgba(255,255,255,.12)
```

各章节物体的配色（`colorA` 主体暗色 → `colorB` 亮色，`rim` 边缘光色）：

| 章节 | colorA | colorB | rim |
|---|---|---|---|
| 01 核心 | `#070f22` | `#1b4a9c` | `#5fb8e8` |
| 02 碎晶 | `#101640` | `#4fa8d8` | `#9fe4ff` |
| 03 流动 | `#260d45` | `#8f5fd8` | `#d8a8f5` |
| 04 轨道 | `#2e0a2a` | `#d15f9f` | `#f0a8cc` |
| 05 群集 | `#171142` | `#6f5fd8` | `#a89cf0` |
| 06 门户 | `#073040` | `#4fa8d8` | `#9fe4ff` |

**注意这些值偏暗，是故意的。** 第一版配色比这亮一倍，实测整个画面过曝成一片白。
配色规律：`colorA` 亮度控制在 `colorB` 的 1/3 左右，靠 `rim` 出彩；不要提高 `colorB` 的亮度来"加对比"，
那样只会让主体变成白色一团。

### 5.2 字体与排版

```
字体栈  -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI",
        "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
```

| 元素 | 字号 | 字重 | 字距 | 行高 |
|---|---|---|---|---|
| 章节主标题 h2 | `clamp(30px, 5.4vw, 64px)` | 700 | `-0.035em` | 1.06 |
| 章节正文 p | `clamp(14.5px, 1.35vw, 16.5px)` | 400 | 0 | 1.78 |
| 章节序号 eyebrow | 11.5px | 500 | `0.22em` | 1.5 |
| 顶栏品牌 | 14px | 650 | `0.24em` | 1.5 |
| 标签 pill | 11.5px | 400 | `0.03em` | 1.5 |

排版原则：**每屏只讲一件事**，正文最大宽度 470px。所有文字都有 `text-shadow: 0 2px 24px rgba(0,0,0,.6)`，保证压在亮色物体上仍可读 —— 不要用半透明黑遮罩去解决可读性。

### 5.3 缓动曲线

```css
--ease:     cubic-bezier(.22,.61,.36,1)    /* 通用 */
--ease-out: cubic-bezier(.16,1,.3,1)       /* 文字升起 */
```
```js
easeOutExpo = x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x))   /* 开场镜头 */
滚动平滑系数 = 0.085        /* 鼠标视差 0.055 */
```

### 5.4 曝光与辉光参数（关键，别乱调）

```
渲染器 toneMappingExposure    0.82        （three 默认是 1.0）

UnrealBloomPass(分辨率, strength, radius, threshold)
桌面:  strength 0.46, radius 0.58, threshold 0.46
移动:  strength 0.34, radius 0.58, threshold 0.46
点击脉冲时:  strength 临时 +0.55（按 0.94/帧 衰减回基线）

> 2026-10-16 调优记录：初版修完过曝后偏暗，整体上调一档——exposure 0.62→0.82、
> bloom strength 0.36→0.46、threshold 0.58→0.46、各材质 glow 上调约 25%、
> 加色外壳不透明度上调约 40%、星点尺寸 320→400、雾密度 0.0112→0.0100 且雾色与背景对齐。
> 这套数值是当前基线，改亮度**优先动 exposure**（单点、线性），其次才动 threshold。
```

**threshold 是这张表里最重要的数字。** 第一版用的是 `0.20`，等于"几乎所有像素都参与辉光"，
结果整个画面糊成一片白，背景从近黑被抬成了浅蓝。**threshold 建议保持在 0.42 ~ 0.60 之间**（当前 0.46）。

辉光贴片（`addGlow`）的尺寸和不透明度：

| 章节 | 尺寸 | 不透明度 |
|---|---|---|
| 01 核心 | 12 | 0.20 |
| 02 碎晶 | 8 | 0.16 |
| 03 流动 | 9 | 0.18 |
| 04 轨道 | 9 | 0.15 |
| 05 群集 | 8 | 0.14 |
| 06 门户 | 16 | 0.20 |

第一版核心那张贴片是 **尺寸 26、不透明度 0.55**，直接在画面左侧糊出一个直径占半个屏的白球。
**辉光贴片尺寸超过 20 就已经很危险了。**

### 5.5 自定义着色器材质参数

`aetherMaterial({ colorA, colorB, rim, amp, freq, rimPower, glow, shade, additive, opacity, wireframe, side })`

| 参数 | 含义 |
|---|---|
| `amp` | 噪声位移幅度。0 = 完全静止，0.30 = 液态流动 |
| `freq` | 噪声频率。越大越碎 |
| `rimPower` | 菲涅尔指数。越大边缘光越细越锐 |
| `glow` | 边缘光强度倍数 |
| `shade` | 漫反射明暗强度。0 附近 = 纯发光体 |
| `additive` | 是否加色混合。加色材质自动设成背面渲染 + 关闭深度写入 |
| `opacity` | 不透明度 |

片元着色器输出公式：

```
fres  = pow(1 - abs(dot(N, V)), rimPower)      ← 必须是 abs()，见 2.5 坑四
lam   = clamp(dot(N, uLightDir) * 0.5 + 0.5, 0, 1)
base  = mix(uColorA, uColorB, clamp(vDisp * 1.6 + 0.5, 0, 1))
col   = base * (shade * 0.25 + lam * shade) + uRimColor * fres * glow
```
加色材质额外做 `col *= (1 - fogFactor)`，普通材质做 `col = mix(col, fogColor, fogFactor)`。

各章节材质参数的合理区间（第一版全都取上限，导致过曝，现已下调）：

| 参数 | 合理区间 | 说明 |
|---|---|---|
| `glow` | `0.5 ~ 1.6` | 超过 1.6 边缘会直接烧成白色 |
| `shade` | `0.1 ~ 0.6` | 实体物体取 0.4~0.6；发光壳取 0.05~0.2 |
| `additive` 材质的 `opacity` | `0.10 ~ 0.45` | 加色混合下 0.9 就是纯白 |
| `amp` | `0 ~ 0.30` | 顶点位移幅度 |

---

## 6. 交互清单

| 交互 | 触发 | 表现 |
|---|---|---|
| 开场 | 加载进度到 100% 后 | 摄像机从 `锚点 + (0, 9, 72)` 处飞入，FOV 89° → 55°，历时 2.2 秒，easeOutExpo |
| 滚动 | 页面滚动 | 平滑跟随系数 0.085；摄像机沿锚点曲线飞行；文字按窗口淡入淡出 |
| 鼠标视差 | pointermove | 摄像机位移 `(mx*1.1, -my*0.75)`，注视点位移 `(mx*1.9, -my*1.3)`，缓动 0.055；摄像机额外 Z 轴翻滚 `-mx*0.022` |
| 点击脉冲 | 在画布上 pointerdown | 脉冲值 +0.85（上限 1），辉光 +1.1，摄像机小幅后撤，材质位移 +0.55 |
| 章节跳转 | 右侧指示器 / 顶栏按钮 | 平滑滚动到 `(i / 5) * 可滚动高度` |
| 重播开场 | 顶栏按钮 | 回到顶部 + 重跑入场动画 |
| 光标光晕 | pointermove | 一个 340px 的径向光晕，`mix-blend-mode: screen`，缓动 0.12 |
| 表单提交 | 第 6 章邮箱表单 | 前端校验邮箱格式 → 提交 → 按钮变绿显示"已收到" |

**指示器样式**：右侧竖排 6 条 26×2px 的横线，激活态 40px 宽 + 强调色 + 发光；hover 时左侧浮出英文名。

---

## 7. 后端需求（待 GPT 实现）

### 7.1 目的

只用两件事：**接收表单留资** + **让运营能改文案**。

### 7.2 数据表

```sql
-- 留资线索
CREATE TABLE leads (
  id            BIGSERIAL PRIMARY KEY,
  email         VARCHAR(254) NOT NULL,
  source        VARCHAR(64)  NOT NULL DEFAULT 'aether-landing',
  -- 用户提交时停留的滚动进度（0~1），用来判断是哪一段打动了人
  scroll_depth  REAL,
  chapter       VARCHAR(32),
  referrer      TEXT,
  ua            TEXT,
  ip_hash       CHAR(64),      -- 只存哈希，不存原始 IP
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON leads (created_at DESC);
CREATE UNIQUE INDEX ON leads (email, source);   -- 同一来源下邮箱唯一，防重复提交

-- 页面文案（CMS）
CREATE TABLE site_content (
  id          BIGSERIAL PRIMARY KEY,
  chapter_no  SMALLINT NOT NULL,      -- 1~6
  field       VARCHAR(32) NOT NULL,   -- eyebrow | title | body | tags
  locale      VARCHAR(8)  NOT NULL DEFAULT 'zh-CN',
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chapter_no, field, locale)
);
```

### 7.3 API 契约

```
POST /api/leads
Content-Type: application/json

请求体：
{ "email": "a@b.com", "source": "aether-landing",
  "scrollDepth": 0.87, "chapter": "Portal", "referrer": "https://..." }

成功 201：
{ "ok": true, "id": 123 }

邮箱格式错误 422：
{ "ok": false, "error": "INVALID_EMAIL" }

同一邮箱重复提交 200：
{ "ok": true, "duplicate": true }

频率超限 429：
{ "ok": false, "error": "RATE_LIMITED", "retryAfter": 60 }
```

```
GET /api/content?locale=zh-CN
→ { "chapters": [ { "no": 1, "eyebrow": "...", "title": "...",
                    "body": "...", "tags": ["...","..."] }, ... ] }
```

### 7.4 必须做到的

- 邮箱服务端**再校验一次**（前端校验只是体验，不是安全）
- 同 IP 限流：每分钟最多 5 次
- IP 只存 SHA-256 哈希，不存明文（合规）
- 提交成功/失败都要有明确反馈，失败时按钮恢复可点
- 前端第 6 章表单里已留好接入位置，搜 `接入后端的位置` 就能找到

### 7.5 推荐实现

- 静态前端直接托管（任意静态托管平台）
- 后端用 Serverless 函数 + Postgres（如 Supabase / Vercel Postgres / 腾讯云开发）
- 若用 Supabase：建表 SQL 直接用上面两份，`/api/leads` 换成 `supabase.from('leads').insert()`
- **注意**：不要在前端暴露数据库密钥，写操作必须走后端函数或行级安全策略

---

## 8. 性能与可访问性硬性要求

### 8.1 性能

- 像素比上限：桌面 1.75，移动 1.5
- 移动端自动降配：关闭抗锯齿、粒子数减到 1/3、群集从 11×11 降到 8×8、辉光强度 0.34
- **帧率守护**：连续 90 帧平均超过 27ms 时，自动把像素比降到 1 并标记已降档，页脚显示"已自动降档"
- 切换标签页时丢弃累积时间，回来不跳帧
- 目标：中端安卓机上稳定 30 FPS 以上

### 8.2 可访问性

- `prefers-reduced-motion: reduce` 时：跳过开场镜头动画、关闭光标光晕、滚动不平滑（直接跟手）、所有 CSS 过渡压缩到 0.01ms
- 文字必须是**真实 HTML 文本**，不能画在 canvas 里（SEO 与屏幕阅读器）
- 章节指示器按钮要有 `aria-label`
- 表单 input 要有 placeholder 和有意义的提示文案
- 所有文字压在三维画面上都要保证对比度（用 text-shadow，不用遮罩）

### 8.3 错误兜底

- WebGL 不可用时显示中文提示，不能让用户看白屏
- 运行时报错显示在左下角固定错误框（`#errbox`）
- 后期处理初始化失败时**降级为直接渲染**，世界照常显示

---

## 9. 交给 GPT 的任务清单（按顺序，一次一步）

### 第 1 步 · 替换占位文案
把 6 个章节的标题、正文、标签、品牌名、顶栏按钮文案，全部换成用户的真实品牌内容。
**产出**：完整的新 `index.html`。

### 第 2 步 · 增加第 7 个章节
在第 6 章之前插入一个"产品展示"章节：物体用 3 个可旋转的产品几何体（用基础几何体拼），摄像机锚点按第 4.1 节的间距规范外推。
**必须同步修改**：`ANCHORS`、`AT`、`CHAPTER_LABELS`、`WINDOWS`、`index.html` 里的章节块和指示器。
**注意**：`WINDOWS` 必须重新按"窗口宽 0.25、中心为 i/(N-1)"重算。

### 第 3 步 · 接入后端
按第 7 节的表结构和 API 契约实现留资接口，并把第 6 章表单接上去。
**产出**：后端函数代码 + `world.js` 表单部分的完整替换。

### 第 4 步 · 文案动态化
把 6 个章节文案改成从 `GET /api/content` 拉取，保留写死的默认值作为兜底（接口挂了也能显示）。
**注意**：不能因为等接口而阻塞三维世界的开场动画。

### 第 5 步 · 移动端体验优化
手机上的重点：文字改为底部对齐、指示器换成底部小圆点、粒子再减、把第 6 章表单做成全宽。
**必须实际在 375px 宽度下检查**。

### 第 6 步 · 真实素材接入
如果用户提供了视频或图片：在第 1 章前插入一个全屏视频开场，滚动进度驱动视频播放时间（video scrubbing），播完再进入三维世界。
**关键**：视频必须静音 + `playsinline`，并且滚动停止时视频也要暂停。

---

## 10. 可直接复制的 Prompt

### 10.1 短版（先建立上下文用）

```
我要做一个整站沉浸式三维世界的品牌官网，参考 Igloo Inc、Lusion 的风格。

主站点已经有一个跑通的原型，技术栈是：原生 ES Module + three.js 0.160.0（本地 vendor 目录，
不走 CDN）+ 原生 CSS，不用任何构建工具，不引入 GSAP / React 等额外依赖。

核心结构：一个全屏 WebGL 画布固定不动，页面高度 640vh 撑出滚动距离，滚动进度 p（0~1）
驱动摄像机沿一条 CatmullRomCurve3 曲线飞行，依次经过 6 组漂浮的几何体。文字层浮在画布上方，
按进度区间淡入淡出，交叉溶解。

视觉：近黑底 #05060a，冷蓝强调色 #7ad1ff，自定义着色器做菲涅尔边缘光 + 三维噪声顶点位移，
后期用 UnrealBloomPass 做辉光。

我接下来会分步请你写代码。每次请只输出**完整的单个文件内容**，不要输出 diff 片段，
不要引入新依赖，不要改动我给你的既有约定参数（摄像机锚点、配色、缓动曲线）。

明白的话回复"明白"，我发第一步。
```

### 10.2 长版（把整份第 4、5、6 节内容一起发）

把本文件**第 2 节到第 8 节整段复制**，前面加下面这段：

```
下面是这个项目的完整设计规范，请通读并把它当作不可随意改动的约定。

规范里的所有数值（摄像机锚点、章节物体参数、文字窗口区间、配色、缓动曲线、
辉光参数）都是已经调好的，你写代码时必须沿用，不要"优化"成你觉得更好的值。
如果需要新增章节或物体，按规范里给出的间距规律和参数区间外推。

读完请用一段话总结你对这个项目的理解，然后等我发具体任务。
```

### 10.3 每次派任务时的固定后缀（建议每次都加）

```
要求：
1. 只输出完整的文件内容，不要 diff、不要省略号、不要"其余部分保持不变"
2. 不要引入任何新的第三方依赖
3. 不要修改本文档规定之外的既有参数
4. 改完后列出你改动过的文件清单和每一处的用意
5. 如果有任何你无法确定的地方，先问我，不要自己假设
```

---

## 附：本地怎么预览

```
cd /d E:\WebProjects\aether-3d-world
python -m http.server 8777
```
然后浏览器打开 `http://127.0.0.1:8777/`。
**不要直接双击 index.html**，`file://` 下 ES Module 会被浏览器拦掉。
