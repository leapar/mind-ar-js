# Estimator 深度解析

> 参考来源: Google MediaPipe geometry_pipeline.cc
> https://github.com/google/mediapipe/blob/master/mediapipe/modules/face_geometry/libs/geometry_pipeline.cc

---

## 一、Estimator 在管线中的位置

```
MediaPipe FaceLandmarker          Estimator                    Three.js
┌──────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│ 468个归一化关键点 │ ──→ │ 2D归一化 → 3D度量坐标 │ ──→ │ 锚点矩阵更新     │
│ [x,y,z] ∈ [0,1]  │     │ + 4x4位姿矩阵       │     │ + 动态Geometry    │
│                  │     │ + faceScale         │     │                  │
└──────────────────┘     └─────────────────────┘     └──────────────────┘
```

**Estimator 的三大职责**:
1. 坐标转换: 归一化 2D 屏幕坐标 → 虚拟相机 3D 空间坐标
2. 尺度恢复: 从无尺度的 2D 投影中恢复真实世界度量（毫米）
3. 位姿估计: 计算人脸相对于相机的旋转和平移（4×4 矩阵）

---

## 二、坐标系转换详解

### 2.1 涉及的坐标系

```
归一化坐标系 (MediaPipe输出)
    │  x,y,z ∈ [0,1], 原点左上角, Y向下
    │
    │ _projectToScreen()
    ▼
屏幕坐标系 (虚拟近裁剪面)
    │  单位: 虚拟单位, 原点图像中心
    │  Y轴翻转后向上
    │
    │ _moveAndRescaleZ() + _unprojectScreen()
    ▼
3D 相机坐标系 (估计的度量空间)
    │  单位: 近似毫米
    │  右手坐标系 (之后会翻转手性)
    │
    │ solvePnP → faceMatrix
    ▼
Three.js 坐标系
    │  左手坐标系, 相机看向 -Z
    │  Y向上, X向右
```

### 2.2 `_projectToScreen` 详解

```
输入: landmarks[i] = [x_norm, y_norm, z_norm]  归一化坐标

x_screen = x_norm * (right - left) + left
         = x_norm * nearWidth + (-nearWidth/2)
         = (x_norm - 0.5) * nearWidth

y_screen = (1 - y_norm) * (top - bottom) + bottom
         = (1 - y_norm) * nearHeight + (-nearHeight/2)
         = (0.5 - y_norm) * nearHeight
         // 注意: (1 - y_norm) 翻转了Y轴方向

z_screen = z_norm * (right - left)
         = z_norm * nearWidth
```

**物理意义**: 将归一化坐标映射到虚拟相机近裁剪面上的屏幕位置。近裁剪面的尺寸为 `nearWidth × nearHeight`。

### 2.3 `_unprojectScreen` 详解

```
输入: screen landmark = [x_s, y_s, z_s]

x_3d = x_s * z_s / near
y_3d = y_s * z_s / near

由于 near = 1, 简化为:
x_3d = x_s * z_s
y_3d = y_s * z_s
```

**物理意义**: 透视投影的逆运算。屏幕上 (x_s, y_s) 的点乘以深度 z_s，还原到从相机光心出发的 3D 射线上。

---

## 三、两阶段尺度估计

### 3.1 为什么需要两阶段?

从 2D 图像恢复 3D 信息是一个**病态问题**（ill-posed）:
- 同一张 2D 照片，可能是近处的小脸，也可能是远处的大脸
- MediaPipe 的 z 值是相对深度，没有真实尺度

两阶段估计的策略:
1. **第一阶段**: 在屏幕空间做粗略尺度估计，得到一个初始尺度
2. **第二阶段**: 用初始尺度将 2D 点反投影到 3D，在 3D 空间中精化尺度

### 3.2 `_estimateScale` 原理

```js
_estimateScale(landmarks) {
  transformMat = _solveWeightedOrthogonal(
    canonicalMetricLandmarks,  // 已知的标准模型（毫米级真实尺寸）
    landmarks,                  // 当前帧估计的点
    sqrtWeights
  );
  scale = sqrt(R[0][0]² + R[0][1]² + R[0][2]²);
  return scale;
}
```

**核心思想**: Procrustes 求解出的 3×3 子矩阵包含了旋转+缩放的信息。旋转矩阵的每一行是单位向量，如果包含了缩放，其模长就不再是 1。因此缩放因子 = 该行向量的模长。

```
如果最优变换是: target ≈ s * R * source + t
那么 3×3 矩阵 M = s * R
所以 s = ||M的第0行|| = sqrt(M[0][0]² + M[0][1]² + M[0][2]²)
```

### 3.3 两阶段的完整流程

```
第一迭代:
  screenLandmarks (2D屏幕坐标)
  → changeHandedness (翻转Z)
  → _estimateScale → firstIterationScale

第二迭代:
  screenLandmarks
  → _moveAndRescaleZ(depthOffset, firstIterationScale)  // 调整Z深度
  → _unprojectScreen                                      // 2D → 3D
  → changeHandedness
  → _estimateScale → secondIterationScale

最终:
  totalScale = firstIterationScale * secondIterationScale
```

**为什么是相乘而不是相加?**
- 第一阶段的尺度是在"屏幕空间"中的缩放比例
- 第二阶段是在已经按第一阶段缩放后的 3D 空间中再次缩放
- 两次缩放是串联（级联）的，所以相乘

---

## 四、加权正交 Procrustes — 完整数学推导

### 4.1 问题定义

给定:
- 源点集: `S = {s_1, s_2, ..., s_n}` (标准模型关键点)
- 目标点集: `T = {t_1, t_2, ..., t_n}` (当前帧估计的关键点)
- 权重: `W = {w_1, w_2, ..., w_n}`

求最优变换 `(R, s, t)` 使得:

```
E = Σ w_i * ||t_i - (s * R * s_i + t)||²   最小化
```

约束条件:
- `R` 是旋转矩阵: `R^T * R = I`, `det(R) = 1`
- `s > 0` 是均匀缩放
- `t` 是平移向量

### 4.2 步骤 1: 加权

```
s'_i = s_i * sqrt(w_i)
t'_i = t_i * sqrt(w_i)
```

### 4.3 步骤 2: 去中心化

```
总权重: W_total = Σ w_i

加权质心: c_S = (1/W_total) * Σ (w_i * s_i)
          = (1/W_total) * Σ (s'_i * sqrt(w_i))

去中心化的加权源点: s''_i = s'_i - c_S * sqrt(w_i)
```

**为什么要加权去中心化?**
普通 Procrustes 直接减去几何中心。加权版本中，高权重点对质心的贡献更大，确保变换主要由稳定的关键点驱动。

### 4.4 步骤 3: 设计矩阵

```
H = Σ (t'_i * s''_i^T)   // 3×3 矩阵

展开:
H[0][0] = Σ t'_i[0] * s''_i[0]
H[0][1] = Σ t'_i[0] * s''_i[1]
...
```

设计矩阵 `H` 本质上是两组点之间的**加权交叉协方差矩阵**。

### 4.5 步骤 4: SVD 求旋转 (Kabsch Algorithm)

```
H = U * Σ * V^T    (SVD 分解)

R = U * V^T
```

**为什么有效?**
- SVD 将协方差矩阵分解为正交基
- `U * V^T` 给出了使两组点最对齐的旋转
- 这是最小二乘意义下的最优解

**修正反射问题** (本代码中未显式处理):
标准 Kabsch 算法需要检查 `det(R)`:
- 如果 `det(R) = -1`，说明解是反射而非纯旋转
- 需要将 `V` 的最后一列取反: `R = U * diag(1, 1, -1) * V^T`

### 4.6 步骤 5: 求最优缩放

```
旋转后的源点: s'''_i = R * s''_i

s = Σ(s'''_i · t'_i) / Σ(s''_i · s'_i)

分子: 旋转后源点与目标点的内积和（对齐程度）
分母: 去中心化源点与原始源点的内积和（源的"能量"）
```

### 4.7 步骤 6: 求最优平移

```
逐点残差: d_i = t'_i - R * s * s'_i
加权残差: d'_i = d_i * sqrt(w_i)

t = (1/W_total) * Σ d'_i
```

### 4.8 步骤 7: 组装 4×4 变换矩阵

```
T = ┌                      ┐
    │ sR  sR  sR  t[0]     │
    │ sR  sR  sR  t[1]     │
    │ sR  sR  sR  t[2]     │
    │  0   0   0    1      │
    └                      ┘

对于齐次坐标点 [x, y, z, 1]:
T * [x, y, z, 1]^T = [sR*p + t, 1]^T
```

---

## 五、solvePnP 详解

### 5.1 为什么需要 solvePnP?

Procrustes 已经给出了 3D→3D 的最优对齐，为什么还要 solvePnP?

| Procrustes | solvePnP |
|------------|----------|
| 3D 到 3D 的对齐 | 3D 到 2D 投影的对齐 |
| 不依赖相机模型 | 使用完整相机内参矩阵 |
| 在"估计的度量空间"中工作 | 直接匹配原始 2D 观测 |
| 受深度估计误差影响 | 对投影误差更鲁棒 |

**组合优势**:
- Procrustes 将 canonical 模型变换到接近真实度量的空间
- solvePnP 在此基础上用相机投影模型精化，得到最终的精确位姿

### 5.2 solvePnP 输入

```
modelPoints:  newMetricLandmarks[majorIndexes]   // 3D 坐标（变换后的度量点）
imagePoints:  landmarks[majorIndexes]            // 2D 原始像素坐标
cameraMatrix: 内参矩阵 [[f, 0, cx], [0, f, cy], [0, 0, 1]]
distCoeffs:   [0, 0, 0, 0]  (假设无畸变)
```

### 5.3 solvePnP 输出

```
rvecs: [rx, ry, rz]  — 旋转向量（轴角表示）
tvecs: [tx, ty, tz]  — 平移向量

通过 Rodrigues 公式:
rvecs → rotationMatrix (3×3)
```

### 5.4 Rodrigues 旋转公式

```
旋转向量: v = [rx, ry, rz]
旋转角:   θ = ||v|| = sqrt(rx² + ry² + rz²)
旋转轴:   n = v / ||v||

旋转矩阵:
R = I + sin(θ)*K + (1-cos(θ))*K²

其中 K 是 n 的叉积矩阵:
K = ┌  0   -nz   ny  ┐
    │  nz    0   -nx  │
    │ -ny    nx    0  │
```

### 5.5 最终 faceMatrix 构建

```js
m = [
  r00,  r01,  r02,  tx,     // 第一行
  -r10, -r11, -r12, -ty,    // 第二行取反
  -r20, -r21, -r22, -tz,    // 第三行取反
   0,    0,    0,    1
]
```

**为什么 Y 和 Z 行取反?**

这是坐标系适配:
- OpenCV 的相机坐标系: X右, Y下, Z前
- Three.js 的相机坐标系: X右, Y上, Z后 (看向 -Z)
- Y 和 Z 取反完成手性转换

---

## 六、逆变换矩阵

```js
// 4×4 变换矩阵的逆
poseTransformMatCV = matFromArray(4, 4, ..., poseTransformMat)
invPoseTransformMatCV = poseTransformMatCV.inv(0)

// 将变换应用到 metricLandmarks
newMetricLandmark[i] = invTransform * metricLandmark[i]
```

**为什么要逆变换?**
- `poseTransformMat` 是从 canonical 空间到当前帧度量空间的变换
- 它的逆变换是从当前帧度量空间回到 canonical 空间
- `newMetricLandmarks` = 将当前帧点投影到 canonical 空间，再经过 solvePnP 精化后的结果

---

## 七、流程图总结

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    ESTIMATE 完整流程                      │
                    └─────────────────────────────────────────────────────────┘

landmarks (归一化 [0,1])
    │
    │ 1. 截断到468点
    ▼
landmarks_468
    │
    │ 2. _projectToScreen
    ▼
screenLandmarks (虚拟屏幕坐标)
    │
    │ 3. 克隆 + 翻转手性
    ▼
intermediateLandmarks
    │
    │ 4. _estimateScale (第一次)
    ▼
firstIterationScale
    │
    │ 5. 克隆 + _moveAndRescaleZ + _unprojectScreen + 翻转手性
    ▼
intermediateLandmarks_3D
    │
    │ 6. _estimateScale (第二次)
    ▼
secondIterationScale
    │
    │ 7. totalScale = first * second
    │    克隆 + _moveAndRescaleZ + _unprojectScreen + 翻转手性
    ▼
metricLandmarks (估计的度量坐标)
    │
    │ 8. _solveWeightedOrthogonal(canonical, metric, weights)
    ▼
poseTransformMat (canonical → metric 的变换)
    │
    │ 9. 求逆 + 应用到 metricLandmarks
    ▼
newMetricLandmarks (校准后的度量坐标)
    │
    │ 10. 选取主要关键点 → solvePnP
    ▼
rvecs, tvecs (旋转 + 平移)
    │
    │ 11. Rodrigues + 手性转换
    ▼
faceMatrix (4×4)
faceScale (左右边界距离)

最终返回: { metricLandmarks: newMetricLandmarks, faceMatrix, faceScale }
```

---

## 八、关键参数速查

| 参数 | 值 | 说明 |
|------|-----|------|
| `near` | 1 | 近裁剪面距离 |
| `far` | 10000 | 远裁剪面距离 |
| `focalLength` | `frameWidth` | 焦距（像素） |
| `numLandmarks` | 468 | 面部关键点数量 |
| `numWeightedLandmarks` | 33 | 加权Procrustes使用的关键点 |
| `maxWeight` | 0.1206 | 眼中心关键点权重 |
| `majorLandmarks` | ~38 | solvePnP使用的关键点 |
