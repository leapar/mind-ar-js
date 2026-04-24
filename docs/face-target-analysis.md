# MindAR.js 人脸检测模块 (face-target) 深度分析

## 一、整体架构

### 1.1 模块文件结构

```
src/face-target/
├── index.js                          # 入口文件，导出 Controller 和 UI
├── controller.js                     # 核心控制器：视频流处理、人脸检测循环、滤波
├── face-mesh-helper.js               # MediaPipe FaceLandmarker 封装
├── three.js                          # Three.js 集成层：场景、相机、渲染、锚点
└── face-geometry/
    ├── canonical-face-model.obj       # Google MediaPipe 标准人脸模型（468个3D关键点）
    ├── face-data-generator.js         # 从 .obj 生成 face-data.js 的工具脚本
    ├── face-data.js                   # 生成的数据：positions、uvs、faces、landmarkBasis
    ├── face-geometry.js              # Three.js BufferGeometry 封装，动态更新顶点
    └── estimator.js                  # ★ 核心：2D关键点 → 3D位姿估计
```

### 1.2 数据流总览

```
摄像头视频流
    │
    ▼
┌──────────────┐
│  FaceMesh     │  MediaPipe FaceLandmarker (GPU delegate)
│  Helper       │  输出: 468个 2D/3D 归一化关键点 (0~1)
└──────┬───────┘
       │ landmarks: [[x,y,z], ...]
       ▼
┌──────────────┐
│  Estimator    │  坐标转换 + 两阶段尺度估计 + 正交Procrustes + solvePnP
│  (核心)       │  输出: metricLandmarks, faceMatrix (4x4), faceScale
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Controller   │  OneEuroFilter 滤波平滑 → 回调 onUpdate
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Three.js     │  更新 Anchor Group 的 matrix, 渲染 AR 内容
│  集成层       │  FaceMesh 动态 geometry 更新
└──────────────┘
```

---

## 二、各模块详细解析

### 2.1 index.js — 入口

极简入口文件，将 `Controller` 和 `UI` 挂载到 `window.MINDAR.FACE` 命名空间。

### 2.2 FaceMeshHelper — MediaPipe 人脸检测封装

**文件**: [src/face-target/face-mesh-helper.js](src/face-target/face-mesh-helper.js)

**原理**:
- 使用 `@mediapipe/tasks-vision` 的 `FaceLandmarker` 模型
- WASM + GPU delegate 加速
- 模型文件: `face_landmarker.task`，部署在 `https://f.3dman.cn/meta/facedetector/`
- `runningMode: "IMAGE"` — 逐帧检测模式（非视频流模式）
- `outputFaceBlendshapes: true` — 输出表情混合变形（52个ARKit风格表情系数）
- `numFaces: 1` — 只检测单张人脸

**输出结构** (`results`):
```js
{
  faceLandmarks: [[{x, y, z}, ...]],   // 468个3D关键点（归一化 0~1）
  faceBlendshapes: [{categoryName, score}, ...], // 52个表情系数
}
```

**关键设计**: `detect()` 方法是同步调用（非异步），但外层 controller 用 async/await 包装在 requestAnimationFrame 循环中。

### 2.3 Controller — 核心控制器

**文件**: [src/face-target/controller.js](src/face-target/controller.js)

#### 初始化参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `onUpdate` | 每帧检测结果回调 | null |
| `filterMinCF` | OneEuroFilter 最小截止频率 (Hz) | 0.001 |
| `filterBeta` | OneEuroFilter 速度系数 | 1 |

#### 滤波器系统

使用 **OneEuroFilter**（一欧元滤波器），这是一种自适应低通滤波器：
- **原理**: 根据信号变化速度动态调整截止频率。静止时用低截止频率（强平滑），快速运动时提高截止频率（降低延迟）
- **应用**:
  - `landmarkFilters[468]` — 每个关键点各一个滤波器（过滤 metricLandmarks 的 x,y,z）
  - `faceMatrixFilter` — 过滤整体人脸变换矩阵
  - `faceScaleFilter` — 过滤人脸尺寸

#### 视频处理流程 (`processVideo`)

```
1. 如果 flipFace = true (前置摄像头且未禁用镜像):
   - 将输入图像水平翻转后送入 MediaPipe 检测
2. MediaPipe 检测
3. 如果未检测到人脸:
   - 清空 lastEstimateResult
   - 重置所有滤波器状态
   - 回调 onUpdate({ hasFace: false })
4. 如果检测到人脸:
   - 提取 landmarks [[x,y,z], ...]
   - estimator.estimate(landmarks) → 得到 metricLandmarks, faceMatrix, faceScale
   - 如果首次检测: 直接存储结果
   - 否则: 用 OneEuroFilter 平滑所有输出
   - 回调 onUpdate({ hasFace: true, estimateResult })
   - 更新所有自定义 FaceGeometry 的顶点位置
5. requestAnimationFrame(doProcess) → 循环
```

#### 关键方法

| 方法 | 作用 |
|------|------|
| `setup(flipFace, path)` | 初始化 MediaPipe FaceLandmarker |
| `onInputResized(input)` | 视频尺寸变化时重新创建 Estimator |
| `getCameraParams()` | 返回 Three.js 相机参数 (fov, aspect, near, far) |
| `processVideo(input)` | 启动视频帧检测循环 |
| `getLandmarkMatrix(index)` | 计算某个关键点的完整世界变换矩阵 (4x4) |
| `createThreeFaceGeometry(THREE)` | 创建 Three.js 人脸几何体 |

#### `getLandmarkMatrix` 矩阵计算

```
最终矩阵 = faceMatrix × landmarkMatrix

其中 landmarkMatrix 是:
┌                                   ┐
│  s    0    0    tx                │
│  0    s    0    ty                │
│  0    0    s    tz                │
│  0    0    0    1                 │
└                                   ┘

s = faceScale (人脸左右边界距离)
tx/ty/tz = metricLandmarks[landmarkIndex] (该关键点3D坐标)
faceMatrix = solvePnP 求得的 4x4 变换矩阵
```

### 2.4 Three.js 集成层

**文件**: [src/face-target/three.js](src/face-target/three.js)

#### MindARThree 类

封装了完整的 Three.js AR 场景管理:

**双渲染器架构**:
- `WebGLRenderer` — 渲染 3D 内容（Mesh、材质等）
- `CSS3DRenderer` — 渲染 CSS3D 元素（HTML DOM 元素作为 3D 对象）

**场景结构**:
```
container
├── video (z-index: -2, 背景视频)
├── renderer.domElement (WebGL 3D 渲染层)
└── cssRenderer.domElement (CSS3D DOM 渲染层)
```

#### 锚点系统

- `addAnchor(landmarkIndex)` — 在指定关键点位置创建 3D 锚点
- `addCSSAnchor(landmarkIndex)` — 在指定关键点位置创建 CSS3D 锚点（HTML元素）
- 锚点的 matrix 每帧通过 `controller.getLandmarkMatrix(landmarkIndex)` 更新
- CSS 锚点会额外应用 `cssScale = 0.001` 缩放（将 Three.js 单位转换为 CSS 像素）

#### 相机同步

视频尺寸变化时，通过 `controller.getCameraParams()` 同步 Three.js PerspectiveCamera:
```js
fov = estimator.fov * 180 / Math.PI     // 视场角
aspect = frameWidth / frameHeight        // 宽高比
near = 1                                  // 近裁剪面
far = 10000                               // 远裁剪面
```

---

## 三、★ Estimator 详细解析

**文件**: [src/face-target/face-geometry/estimator.js](src/face-target/face-geometry/estimator.js)

这是整个模块最核心、最复杂的部分。它参考了 Google MediaPipe 的 [geometry_pipeline.cc](https://github.com/google/mediapipe/blob/master/mediapipe/modules/face_geometry/libs/geometry_pipeline.cc)。

### 3.1 目标

将 MediaPipe 输出的 **归一化 2D/3D 关键点** (0~1 范围) 转换为:
1. **metricLandmarks** — 真实世界度量单位（毫米）的 3D 关键点坐标
2. **faceMatrix** — 4x4 变换矩阵，描述人脸在相机空间中的位姿
3. **faceScale** — 人脸尺寸（左右边界距离）

### 3.2 构造函数 — 虚拟相机参数设置

```js
constructor(input) {
  this.near = 1;                  // 近裁剪面
  this.far = 10000;               // 远裁剪面
  this.frameHeight = input.height;
  this.frameWidth = input.width;
  this.focalLength = frameWidth;  // 焦距 = 帧宽（像素单位）
  this.fov = 2 * Math.atan(frameHeight / (2 * focalLength));
  // ... 视锥体参数
}
```

**为什么 `focalLength = frameWidth`?**
- 这是一种简化的相机模型假设
- 当焦距等于图像宽度时，水平 FOV 约为 53 度，接近大多数手机前置摄像头的视角
- 实际上这是 MediaPipe 的约定，与模型训练时使用的相机参数一致

### 3.3 `estimate()` 主流程

```
输入: landmarks [[x,y,z], ...]  归一化坐标, x,y,z ∈ [0,1]
```

#### Step 1: 截断到 468 个关键点

```js
landmarks = landmarks.slice(0, canonicalMetricLandmarks.length);
```
新版本的 MediaPipe 会额外输出 10 个虹膜关键点，这里截断掉，只保留 468 个面部关键点。

#### Step 2: 投影到屏幕坐标系

```js
screenLandmarks = this._projectToScreen(landmarks);
```

`_projectToScreen` 将归一化坐标转换为虚拟相机的屏幕坐标:
```js
x_screen = x_normalized * (right - left) + left
y_screen = (1 - y_normalized) * (top - bottom) + bottom   // Y轴翻转
z_screen = z_normalized * (right - left)                   // Z 也用相同缩放
```

这里 `(left, right, top, bottom)` 是虚拟相机在近裁剪面上的视锥体边界。

#### Step 3: 第一次迭代 — 估计初始尺度

```js
intermediateLandmarks = clone(screenLandmarks);
changeHandedness(intermediateLandmarks);  // Z轴翻转（坐标系手性转换）
depthOffset = average(z_values);           // 深度偏移量
firstIterationScale = _estimateScale(intermediateLandmarks);
```

#### Step 4: 第二次迭代 — 精化尺度

```js
intermediateLandmarks = clone(screenLandmarks);
_moveAndRescaleZ(depthOffset, firstIterationScale, intermediateLandmarks);
_unprojectScreen(intermediateLandmarks);    // 从屏幕坐标反投影到3D空间
changeHandedness(intermediateLandmarks);
secondIterationScale = _estimateScale(intermediateLandmarks);
```

**两阶段尺度估计的原因**:
- 第一次粗略估计深度方向的尺度
- 用这个尺度将 2D 屏幕坐标反投影到 3D 空间
- 第二次在 3D 空间中精确估计尺度
- 最终 `totalScale = firstIterationScale * secondIterationScale`

#### Step 5: 生成度量制关键点

```js
metricLandmarks = clone(screenLandmarks);
totalScale = firstIterationScale * secondIterationScale;
_moveAndRescaleZ(depthOffset, totalScale, metricLandmarks);
_unprojectScreen(metricLandmarks);
changeHandedness(metricLandmarks);
```

#### Step 6: 正交 Procrustes 对齐

```js
poseTransformMat = _solveWeightedOrthogonal(
  canonicalMetricLandmarks,  // 标准模型（已知真实世界尺寸）
  metricLandmarks,           // 当前帧估计的度量关键点
  sqrtWeights                // 关键点权重
);
```

#### Step 7: solvePnP 求精确位姿

使用加权关键点对再次运行 Procrustes 求解，然后通过 OpenCV `solvePnP` 获取精确的相机位姿。

### 3.4 核心算法详解

#### 3.4.1 `_solveWeightedOrthogonal` — 加权正交 Procrustes

**问题**: 给定两组 3D 点集 `sources` (标准模型) 和 `targets` (当前帧)，寻找最优的 **旋转 R + 缩放 s + 平移 t** 使得变换后的误差最小:

```
min Σ w_i * ||target_i - (s * R * source_i + t)||²
```

**算法步骤**:

1. **加权**: 对每个点乘以权重 `sqrt(w_i)`
   ```
   weighted_source_i = source_i * sqrt(w_i)
   weighted_target_i = target_i * sqrt(w_i)
   ```

2. **去中心化**: 计算加权质心，将点集平移到原点
   ```
   source_center = Σ (weighted_source_i * sqrt(w_i)) / total_weight
   centered_weighted_source_i = weighted_source_i - source_center * sqrt(w_i)
   ```

3. **构建 3×3 设计矩阵 (Design Matrix)**:
   ```
   H = Σ (weighted_target_i × centered_weighted_source_iᵀ)
   ```
   这是一个 3×3 矩阵，描述了两组点之间的相关性。

4. **SVD 分解求最优旋转**:
   ```
   H = U × Σ × Vᵀ
   R = U × Vᵀ
   ```
   这就是经典的 **Kabsch Algorithm**，通过 SVD 求解最优正交旋转矩阵。

5. **求最优缩放**:
   ```
   s = Σ(rotated_centered_source · weighted_target) / Σ(centered_source · weighted_source)
   ```

6. **求最优平移**:
   ```
   t = Σ(weighted_target - R×s×weighted_source) * sqrt(w) / total_weight
   ```

7. **组装 4×4 变换矩阵**:
   ```
   ┌                               ┐
   │  sR    sR    sR    tx         │
   │  sR    sR    sR    ty         │
   │  sR    sR    sR    tz         │
   │   0     0     0     1         │
   └                               ┘
   ```

#### 3.4.2 `_computeOptimalRotation` — SVD 求旋转

```js
// 设计矩阵 → OpenCV SVD
SVD(H) → U, Σ, Vᵀ
R = U × Vᵀ
```

**数学原理**: Kabsch Algorithm
- H 的设计矩阵捕获了 source 和 target 之间的协方差结构
- SVD 分解后，U×Vᵀ 给出了最小二乘意义下的最优正交旋转
- 这保证了 R 是纯旋转（正交矩阵，det(R) = 1）

#### 3.4.3 `solvePnP` — 相机位姿估计

```js
// 选取加权权重高的关键点作为主要关键点
majorLandmarkIndexes = [33, 263, 61, 291, 199, ...landmarkBasis索引]

// modelPoints: 变换后的 3D 关键点（真实世界度量）
// imagePoints: 原始 2D 关键点（像素坐标）
// cameraMatrix: 相机内参矩阵
// distCoeffs: 畸变系数（假设为零）

cv.solvePnP(modelPoints, imagePoints, cameraMatrix, distCoeffs, rvecs, tvecs)
cv.Rodrigues(rvecs, rotationMatrix)
```

**solvePnP 原理**:
- **PnP** = Perspective-n-Point: 已知 n 个 3D 点及其对应的 2D 投影，求解相机位姿
- **输入**: 3D 模型点 + 对应的 2D 图像点 + 相机内参
- **输出**:
  - `rvecs` — 旋转向量 (3×1)，通过 Rodrigues 公式转换为 3×3 旋转矩阵
  - `tvecs` — 平移向量 (3×1)

**相机内参矩阵**:
```
┌                         ┐
│  f   0   cx             │
│  0   f   cy             │
│  0   0    1             │
└                         ┘
其中:
  f = focalLength = frameWidth
  cx = frameWidth / 2
  cy = frameHeight / 2
```

**为什么在 Procrustes 之后还要 solvePnP?**
- Procrustes 给出了 3D→3D 的最优对齐（刚性变换）
- 但 solvePnP 考虑了相机投影模型，能得到更精确的位姿
- Procrustes 的变换用于将 canonical 模型变换到"估计的度量空间"
- solvePnP 在此基础上进一步精化，直接匹配原始 2D 观测

### 3.5 辅助函数

#### `_projectToScreen`
归一化坐标 → 虚拟相机屏幕坐标
- Y 轴翻转 (`1 - y`) 因为图像坐标系原点在左上角
- Z 轴用与 X 相同的缩放因子

#### `_changeHandedness`
翻转 Z 轴 — MediaPipe 使用右手坐标系，而 Three.js/OpenCV 使用左手坐标系

#### `_moveAndRescaleZ`
重新调整 Z 深度: `(z - depthOffset + near) / scale`
- 减去平均深度偏移
- 加上近裁剪面距离
- 除以缩放因子

#### `_unprojectScreen`
屏幕坐标 → 3D 空间坐标
```
x_3d = x_screen * z / near
y_3d = y_screen * z / near
```
这利用了透视投影的几何关系: 屏幕上的点乘以深度得到 3D 射线上的点。

### 3.6 关键点权重系统 (`landmarkBasis`)

```js
// 每个 [索引, 权重] 对
const landmarkBasis = [
  [4,  0.0709],  // 额头中心
  [129, 0.1206], // 左眼中心 - 最高权重
  [136, 0.0669], // 左眼内角
  [133, 0.0533], // 左眼上眼睑
  [358, 0.1206], // 右眼中心 - 最高权重
  [365, 0.0669], // 右眼内角
  [362, 0.0533], // 右眼上眼睑
  [33,  0.0587], // 左眼角
  [263, 0.0587], // 右眼角
  // ... 共 33 个加权关键点
];
```

**设计原理**:
- 眼部和眼角关键点权重最高 (0.12) — 因为眼睛位置最稳定、最容易精确检测
- 嘴角、鼻子等关键点也有较高权重
- 脸颊边缘等容易受表情影响的关键点权重较低
- 在 Procrustes 求解中，高权重关键点对变换矩阵的贡献更大

### 3.7 输出

```js
return {
  metricLandmarks: newMetricLandmarks,  // 468个关键点在真实世界度量下的3D坐标
  faceMatrix: m,                         // 4x4 变换矩阵（行主序排列）
  faceScale: faceScale                   // 人脸宽度（左右边界距离）
};
```

**faceMatrix 的结构**:
```js
m = [
  r00,  r01,  r02,  tx,    // 第一行: 旋转 + X平移
  -r10, -r11, -r12, -ty,   // 第二行: 取反（Y轴手性转换）
  -r20, -r21, -r22, -tz,   // 第三行: 取反（Z轴手性转换）
   0,    0,    0,    1     // 齐次坐标
];
```
Y 和 Z 行的取反是为了适配 Three.js 的左手坐标系（相机看向 -Z）。

---

## 四、FaceGeometry — 动态 3D 网格

**文件**: [src/face-target/face-geometry/face-geometry.js](src/face-target/face-geometry/face-geometry.js)

```js
class FaceGeometry extends THREE.BufferGeometry {
  // 初始化:
  // - positions: Float32Array(468 * 3) — 顶点位置
  // - uvs: Float32Array(468 * 2) — 纹理坐标
  // - faces: 从 face-data.js 加载的三角面索引

  updatePositions(landmarks) {
    // 每帧更新 468 个顶点位置
    // 然后调用 computeVertexNormals() 重新计算法线
  }
}
```

**工作原理**:
1. 从 `canonical-face-model.obj` 预计算了 468 个顶点的 UV 坐标和三角面索引
2. 运行时，`updatePositions(metricLandmarks)` 将估计的 3D 坐标填入 BufferGeometry
3. 调用 `computeVertexNormals()` 自动计算每个顶点的法线（用于光照）
4. 由于 `matrixAutoUpdate = false`，父级 (Anchor) 通过设置 matrix 来控制位置

---

## 五、face-data 数据

**文件**: [src/face-target/face-geometry/face-data.js](src/face-target/face-geometry/face-data.js)

由 `face-data-generator.js` 从 `canonical-face-model.obj` 解析生成:

| 数据 | 说明 | 数量 |
|------|------|------|
| `positions` | 标准人脸模型的 3D 坐标 | 468 个顶点 |
| `uvs` | 每个顶点的纹理坐标 | 468 个 |
| `faces` | 三角面索引 (flat array) | N 个三角面 |
| `landmarkBasis` | 加权关键点 [索引, 权重] | 33 个 |

数据来源: Google MediaPipe 的 [canonical-face-model.obj](https://github.com/google/mediapipe/tree/master/mediapipe/modules/face_geometry/data)

---

## 六、关键设计决策总结

| 设计 | 原因 |
|------|------|
| 两阶段尺度估计 | 从 2D 投影中恢复 3D 深度信息需要迭代的尺度估计 |
| 加权 Procrustes | 不同关键点的稳定性不同，需要加权减少不可靠点的影响 |
| Procrustes + solvePnP | Procrustes 做 3D→3D 对齐，solvePnP 考虑相机投影做精确位姿估计 |
| OneEuroFilter | 比简单低通滤波更好地平衡平滑性和响应延迟 |
| focalLength = frameWidth | 与 MediaPipe 模型训练时的相机假设一致 |
| 双渲染器 (WebGL + CSS3D) | 支持 3D 模型和 HTML 元素两种 AR 内容 |
| matrixAutoUpdate = false | 每帧手动设置 matrix，避免 Three.js 自动分解计算 |

---

## 七、依赖关系

```
face-target/
├── MediaPipe tasks-vision (FaceLandmarker)  → 关键点检测
├── OpenCV.js (WASM)                         → SVD, solvePnP, Rodrigues, 矩阵运算
├── Three.js                                  → 3D 渲染
└── OneEuroFilter (内置)                      → 时序滤波
```
